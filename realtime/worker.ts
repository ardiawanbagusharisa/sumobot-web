import { createCompletionProof, verifyBootstrap, verifyRealtimeTicket } from "../lib/online/realtime-auth";
import {
  REALTIME_DISCONNECT_GRACE_MS,
  REALTIME_PHYSICS_HZ,
  REALTIME_SNAPSHOT_HZ,
  type OnlineRoomBootstrap,
  type RealtimeClientMessage,
  type RealtimeControlState,
  type RealtimeServerMessage,
  type RealtimeTicketClaims,
} from "../lib/online/realtime-protocol";
import { advanceOnlineMatch, forfeitOnlineMatch, performOnlineActionDetailed } from "../lib/online/simulation";
import type { OnlineMatchState, RoomSide } from "../lib/online/types";

interface RealtimeDurableObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

interface RealtimeDurableObjectState {
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
  };
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
  acceptWebSocket(socket: RealtimeSocket): void;
  getWebSockets(): RealtimeSocket[];
}

interface RealtimeSocket extends WebSocket {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

declare const WebSocketPair: new () => { 0: RealtimeSocket; 1: RealtimeSocket };

interface Env {
  MATCHES: RealtimeDurableObjectNamespace;
  REALTIME_SHARED_SECRET: string;
  RESULTS_URL?: string;
}

interface SocketAttachment {
  claims: RealtimeTicketClaims;
  authenticated: boolean;
}

interface StoredRoom {
  bootstrap: OnlineRoomBootstrap;
  match: OnlineMatchState;
  serverTick: number;
  acknowledged: Record<RoomSide, number>;
}

const emptyControl = (): RealtimeControlState => ({ sequence: 0, forward: false, turn: 0 });

const realtimeWorker = {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true, protocol: 1 });
    const match = url.pathname.match(/^\/room\/([A-Z0-9]+)$/i);
    if (!match) return new Response("Not found", { status: 404 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket upgrade required", { status: 426 });
    const token = url.searchParams.get("ticket") ?? "";
    const claims = await verifyRealtimeTicket(token, env.REALTIME_SHARED_SECRET);
    if (!claims || claims.roomId !== match[1].toUpperCase()) return new Response("Invalid or expired room ticket", { status: 401 });
    const headers = new Headers(request.headers);
    headers.set("x-sumobot-claims", JSON.stringify(claims));
    return env.MATCHES.get(env.MATCHES.idFromName(claims.roomId)).fetch(new Request(request, { headers }));
  },
};

export default realtimeWorker;

export class MatchRoom {
  private stored: StoredRoom | null = null;
  private controls: Record<RoomSide, RealtimeControlState> = { host: emptyControl(), guest: emptyControl() };
  private disconnectedAt: Record<RoomSide, number | null> = { host: null, guest: null };
  private loop: ReturnType<typeof setInterval> | null = null;
  private lastSnapshotAt = 0;
  private lastCheckpointAt = 0;
  private completionSent = false;

  constructor(private readonly ctx: RealtimeDurableObjectState, private readonly env: Env) {
    ctx.blockConcurrencyWhile(async () => {
      this.stored = await ctx.storage.get<StoredRoom>("room") ?? null;
    });
  }

  async fetch(request: Request) {
    const claimsValue = request.headers.get("x-sumobot-claims");
    if (!claimsValue) return new Response("Missing claims", { status: 401 });
    const claims = JSON.parse(claimsValue) as RealtimeTicketClaims;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [RealtimeSocket, RealtimeSocket];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ claims, authenticated: false } satisfies SocketAttachment);
    this.disconnectedAt[claims.side] = null;
    this.startLoop();
    return new Response(null, { status: 101, webSocket: client } as ResponseInit);
  }

  async webSocketMessage(socket: RealtimeSocket, data: string | ArrayBuffer) {
    const attachment = socket.deserializeAttachment() as SocketAttachment;
    let message: RealtimeClientMessage;
    try { message = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data)) as RealtimeClientMessage; }
    catch { return this.send(socket, { type: "error", message: "Invalid realtime message." }); }

    if (!attachment.authenticated) {
      if (message.type !== "authenticate" || !await verifyBootstrap(message.bootstrap, attachment.claims)) {
        this.send(socket, { type: "error", message: "Room authentication failed." });
        socket.close(4001, "Authentication failed");
        return;
      }
      const expectedPlayer = attachment.claims.side === "host" ? message.bootstrap.host : message.bootstrap.guest;
      if (expectedPlayer.id !== attachment.claims.playerId) {
        socket.close(4001, "Player mismatch");
        return;
      }
      if (!this.stored) {
        this.stored = {
          bootstrap: message.bootstrap,
          match: structuredClone(message.bootstrap.match),
          serverTick: 0,
          acknowledged: { host: 0, guest: 0 },
        };
        this.stored.match.replay ??= [];
        await this.ctx.storage.put("room", this.stored);
      }
      attachment.authenticated = true;
      socket.serializeAttachment(attachment);
      this.disconnectedAt[attachment.claims.side] = null;
      this.send(socket, { type: "ready", side: attachment.claims.side, serverTime: Date.now() });
      this.broadcastSnapshot(true);
      return;
    }

    if (!this.stored || this.stored.match.phase === "complete") return;
    const side = attachment.claims.side;
    if (message.type === "input" && this.stored.bootstrap.controlMode === "buttons") {
      const sequence = Math.max(0, Math.round(message.input.sequence));
      if (sequence > this.stored.acknowledged[side]) {
        this.controls[side] = { sequence, forward: Boolean(message.input.forward), turn: message.input.turn === -1 ? -1 : message.input.turn === 1 ? 1 : 0 };
        this.stored.acknowledged[side] = sequence;
      }
    } else if (message.type === "action" && this.stored.bootstrap.controlMode !== "script") {
      const result = performOnlineActionDetailed(this.stored.match, side, message.name, message.duration, this.stored.bootstrap.actionIntervalMs, { queueIfThrottled: true, sequence: message.sequence });
      this.stored.acknowledged[side] = Math.max(this.stored.acknowledged[side], message.sequence);
      this.send(socket, { type: "action-result", result });
    } else if (message.type === "ping") {
      this.send(socket, { type: "pong", sentAt: message.sentAt, serverTime: Date.now() });
    } else if (message.type === "leave") {
      forfeitOnlineMatch(this.stored.match, side === "host" ? "guest" : "host");
      await this.finish();
    }
  }

  webSocketClose(socket: RealtimeSocket) {
    const attachment = socket.deserializeAttachment() as SocketAttachment;
    const replacementIsOpen = this.ctx.getWebSockets().some((candidate) => {
      if (candidate === socket) return false;
      const other = candidate.deserializeAttachment() as SocketAttachment | null;
      return other?.authenticated && other.claims.side === attachment.claims.side;
    });
    if (!replacementIsOpen) this.disconnectedAt[attachment.claims.side] = Date.now();
  }

  webSocketError(socket: RealtimeSocket) {
    this.webSocketClose(socket);
  }

  private startLoop() {
    if (this.loop) return;
    this.loop = setInterval(() => void this.tick(), 1000 / REALTIME_PHYSICS_HZ);
  }

  private async tick() {
    if (!this.stored || this.stored.match.phase === "complete") return;
    const now = Date.now();
    const hostGone = this.disconnectedAt.host && now - this.disconnectedAt.host >= REALTIME_DISCONNECT_GRACE_MS;
    const guestGone = this.disconnectedAt.guest && now - this.disconnectedAt.guest >= REALTIME_DISCONNECT_GRACE_MS;
    if (hostGone || guestGone) {
      if (hostGone && guestGone) {
        this.stored.match.phase = "complete";
        this.stored.match.winnerSide = "draw";
        this.stored.match.reason = "disconnect";
      } else forfeitOnlineMatch(this.stored.match, hostGone ? "guest" : "host");
    } else {
      advanceOnlineMatch(this.stored.match, now, this.stored.bootstrap.controlMode, this.stored.bootstrap.roundSeconds, this.stored.bootstrap.actionIntervalMs, this.controls);
      this.stored.serverTick += 1;
    }
    if (this.stored.match.phase === "complete") return void await this.finish();
    if (now - this.lastSnapshotAt >= 1000 / REALTIME_SNAPSHOT_HZ) this.broadcastSnapshot();
    if (now - this.lastCheckpointAt >= 2_000) {
      this.lastCheckpointAt = now;
      await this.ctx.storage.put("room", this.stored);
    }
  }

  private broadcastSnapshot(force = false) {
    if (!this.stored || (!force && this.stored.match.phase === "complete")) return;
    this.lastSnapshotAt = Date.now();
    const state = { ...this.stored.match, replay: [] };
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment;
      if (attachment.authenticated) this.send(socket, { type: "snapshot", serverTick: this.stored.serverTick, acknowledgedSequence: this.stored.acknowledged[attachment.claims.side], state });
    }
  }

  private async finish() {
    if (!this.stored || this.completionSent) return;
    this.completionSent = true;
    if (this.loop) { clearInterval(this.loop); this.loop = null; }
    await this.ctx.storage.put("room", this.stored);
    const proof = await createCompletionProof(this.stored.bootstrap.roomId, this.stored.match, this.env.REALTIME_SHARED_SECRET);
    const message: RealtimeServerMessage = { type: "complete", state: this.stored.match, proof };
    for (const socket of this.ctx.getWebSockets()) this.send(socket, message);
    if (this.env.RESULTS_URL) {
      await fetch(this.env.RESULTS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: this.stored.bootstrap.roomId, state: this.stored.match, proof }),
      });
    }
  }

  private send(socket: RealtimeSocket, message: RealtimeServerMessage) {
    try { socket.send(JSON.stringify(message)); } catch { /* disconnected socket */ }
  }
}
