import { getDatabase } from "@/lib/db/server";
import { ensureAuthSchema, type AuthUser } from "@/lib/auth/server";
import { ensureProfileSchema, getOnlineProfile } from "@/lib/profile/server";
import { ensureMatchSchema } from "@/lib/matches/server";
import { MATCH_OUTCOME_RULES, type ControlMode, type MatchResult } from "@/lib/game/rules";
import { parseBotScript } from "@/lib/game/script-runtime";
import { advanceOnlineMatch, createOnlineMatch, forfeitOnlineMatch, ONLINE_ARENA, performOnlineActionDetailed } from "@/lib/online/simulation";
import { hashRealtimePayload, signRealtimeTicket, verifyCompletionProof } from "@/lib/online/realtime-auth";
import { REALTIME_PROTOCOL_VERSION, type OnlineRoomBootstrap, type RealtimeCompletionProof, type RealtimeConnectionTicket } from "@/lib/online/realtime-protocol";
import type { OnlineActionName, OnlineActionResult, OnlineBotSelection, OnlineMatchState, OnlineRoomPlayer, OnlineRoomSummary, OnlineRoomView, RoomSide, RoomStatus } from "@/lib/online/types";

interface RoomRow {
  id: string;
  isPrivate: number;
  accessCodeHash: string | null;
  status: RoomStatus;
  controlMode: ControlMode;
  roundSeconds: number;
  actionIntervalMs: number;
  hostPlayerId: string;
  guestPlayerId: string | null;
  hostPlayer: string;
  guestPlayer: string | null;
  hostReady: number;
  guestReady: number;
  hostSetupDeadline: number | null;
  guestSetupDeadline: number | null;
  countdownStartedAt: number | null;
  realtimeStartedAt: number | null;
  matchState: string | null;
  winnerPlayerId: string | null;
  completionReason: "arena_exit" | "draw_timeout" | "disconnect" | null;
  lastHostSeenAt: number;
  lastGuestSeenAt: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

let schemaReady = false;

export async function ensureOnlineRoomSchema() {
  if (schemaReady) return;
  await ensureAuthSchema();
  await ensureProfileSchema();
  await ensureMatchSchema();
  const d1 = await getDatabase();
  await d1.batch([
    d1.prepare(`CREATE TABLE IF NOT EXISTS online_rooms (
      id TEXT PRIMARY KEY NOT NULL,
      is_private INTEGER NOT NULL DEFAULT 0,
      access_code_hash TEXT,
      status TEXT NOT NULL DEFAULT 'waiting',
      control_mode TEXT NOT NULL,
      round_seconds INTEGER NOT NULL,
      action_interval_ms INTEGER NOT NULL,
      host_player_id TEXT NOT NULL REFERENCES players(id),
      guest_player_id TEXT REFERENCES players(id),
      host_player TEXT NOT NULL,
      guest_player TEXT,
      host_ready INTEGER NOT NULL DEFAULT 0,
      guest_ready INTEGER NOT NULL DEFAULT 0,
      host_setup_deadline INTEGER,
      guest_setup_deadline INTEGER,
      countdown_started_at INTEGER,
      realtime_started_at INTEGER,
      match_state TEXT,
      winner_player_id TEXT REFERENCES players(id),
      completion_reason TEXT,
      last_host_seen_at INTEGER NOT NULL,
      last_guest_seen_at INTEGER,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS idx_online_rooms_status_updated ON online_rooms(status, updated_at)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS idx_online_rooms_access_code ON online_rooms(access_code_hash)"),
    d1.prepare(`CREATE TABLE IF NOT EXISTS online_reward_claims (
      id TEXT PRIMARY KEY NOT NULL,
      room_id TEXT NOT NULL REFERENCES online_rooms(id),
      player_id TEXT NOT NULL REFERENCES players(id),
      result TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_online_reward_room_player ON online_reward_claims(room_id, player_id)"),
  ]);
  schemaReady = true;
}

function parsePlayer(value: string | null): OnlineRoomPlayer | null {
  return value ? JSON.parse(value) as OnlineRoomPlayer : null;
}

function parseMatch(value: string | null): OnlineMatchState | null {
  return value ? JSON.parse(value) as OnlineMatchState : null;
}

function roomSide(row: RoomRow, playerId: string): RoomSide | null {
  return row.hostPlayerId === playerId ? "host" : row.guestPlayerId === playerId ? "guest" : null;
}

function summarize(row: RoomRow): OnlineRoomSummary {
  const host = parsePlayer(row.hostPlayer)!;
  const guest = parsePlayer(row.guestPlayer);
  return {
    id: row.id,
    isPrivate: Boolean(row.isPrivate),
    status: row.status,
    controlMode: row.controlMode,
    roundSeconds: Number(row.roundSeconds),
    actionIntervalMs: Number(row.actionIntervalMs),
    hostName: host.displayName,
    guestName: guest?.displayName ?? null,
    playerCount: guest ? 2 : 1,
    createdAt: row.createdAt,
  };
}

function viewRoom(row: RoomRow, playerId: string): OnlineRoomView {
  const side = roomSide(row, playerId);
  if (!side) throw new Error("You are not a player in this room.");
  const winnerSide = row.winnerPlayerId ? (row.winnerPlayerId === row.hostPlayerId ? "host" : "guest") : null;
  const result: MatchResult | null = row.status !== "completed" ? null : !winnerSide ? "draw" : winnerSide === side ? "win" : "loss";
  const match = parseMatch(row.matchState);
  return {
    ...summarize(row),
    currentSide: side,
    host: parsePlayer(row.hostPlayer)!,
    guest: parsePlayer(row.guestPlayer),
    countdownEndsAt: row.countdownStartedAt ? row.countdownStartedAt + 5000 : null,
    // Live replay frames remain authoritative on the server; omitting them from
    // frequent room snapshots keeps the realtime response bounded.
    match: match ? { ...match, replay: [] } : null,
    winnerPlayerId: row.winnerPlayerId,
    result,
    completionReason: row.completionReason,
  };
}

function resultChanges(result: unknown) {
  return Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.trim().toLowerCase()));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function generateRoomId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function validateBot(value: unknown, controlMode: ControlMode): OnlineBotSelection | null {
  if (!value || typeof value !== "object") return null;
  const bot = value as Partial<OnlineBotSelection>;
  if (typeof bot.id !== "string" || !bot.id || bot.id.length > 80 || typeof bot.name !== "string" || !bot.name || bot.name.length > 24) return null;
  if (bot.skill !== "boost" && bot.skill !== "stone") return null;
  if (!bot.appearance || typeof bot.appearance !== "object") return null;
  const appearance = bot.appearance as OnlineBotSelection["appearance"];
  if ([appearance.wheel, appearance.body, appearance.face, appearance.accessory].some((item) => typeof item !== "string" || item.length > 40)) return null;
  const scriptSource = typeof bot.scriptSource === "string" ? bot.scriptSource.slice(0, 40_000) : "";
  if (controlMode === "script") {
    try { parseBotScript(scriptSource); } catch { return null; }
  }
  return { id: bot.id, name: bot.name, skill: bot.skill, scriptSource, appearance };
}

function makePlayer(user: AuthUser, bot: OnlineBotSelection, deadline: number | null): OnlineRoomPlayer {
  return { id: user.id, handle: user.handle, displayName: user.displayName, ready: false, setupDeadline: deadline, bot };
}

async function loadRoom(id: string) {
  const d1 = await getDatabase();
  return d1.prepare(`SELECT
    id, is_private AS isPrivate, access_code_hash AS accessCodeHash, status,
    control_mode AS controlMode, round_seconds AS roundSeconds, action_interval_ms AS actionIntervalMs,
    host_player_id AS hostPlayerId, guest_player_id AS guestPlayerId,
    host_player AS hostPlayer, guest_player AS guestPlayer,
    host_ready AS hostReady, guest_ready AS guestReady,
    host_setup_deadline AS hostSetupDeadline, guest_setup_deadline AS guestSetupDeadline,
    countdown_started_at AS countdownStartedAt, realtime_started_at AS realtimeStartedAt, match_state AS matchState,
    winner_player_id AS winnerPlayerId, completion_reason AS completionReason,
    last_host_seen_at AS lastHostSeenAt, last_guest_seen_at AS lastGuestSeenAt,
    version, created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt
    FROM online_rooms WHERE id = ? LIMIT 1`).bind(id.toUpperCase()).first<RoomRow>();
}

export async function listOnlineRooms(query?: string) {
  await ensureOnlineRoomSchema();
  const d1 = await getDatabase();
  const normalized = query?.trim() ?? "";
  const codeHash = normalized ? await sha256(normalized) : null;
  const rows = await d1.prepare(`SELECT
    id, is_private AS isPrivate, access_code_hash AS accessCodeHash, status,
    control_mode AS controlMode, round_seconds AS roundSeconds, action_interval_ms AS actionIntervalMs,
    host_player_id AS hostPlayerId, guest_player_id AS guestPlayerId,
    host_player AS hostPlayer, guest_player AS guestPlayer,
    host_ready AS hostReady, guest_ready AS guestReady,
    host_setup_deadline AS hostSetupDeadline, guest_setup_deadline AS guestSetupDeadline,
    countdown_started_at AS countdownStartedAt, realtime_started_at AS realtimeStartedAt, match_state AS matchState,
    winner_player_id AS winnerPlayerId, completion_reason AS completionReason,
    last_host_seen_at AS lastHostSeenAt, last_guest_seen_at AS lastGuestSeenAt,
    version, created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt
    FROM online_rooms
    WHERE status IN ('waiting', 'countdown', 'live')
      AND (? = '' OR id = ? OR access_code_hash = ? OR (is_private = 0 AND host_player LIKE ?))
    ORDER BY CASE status WHEN 'waiting' THEN 0 WHEN 'countdown' THEN 1 ELSE 2 END, created_at DESC
    LIMIT 50`)
    .bind(normalized, normalized.toUpperCase(), codeHash, `%${normalized}%`).all<RoomRow>();
  return rows.results.map(summarize);
}

export async function createOnlineRoom(user: AuthUser, input: { isPrivate: boolean; accessCode?: string; controlMode: ControlMode; roundSeconds: number; actionIntervalMs: number; bot: unknown }) {
  await ensureOnlineRoomSchema();
  const bot = validateBot(input.bot, input.controlMode);
  if (!bot) return { error: "Select a valid bot and script before creating the room.", status: 400 as const };
  const roundSeconds = Math.max(15, Math.min(120, Math.round(input.roundSeconds)));
  const actionIntervalMs = Math.max(50, Math.min(3000, Math.round(input.actionIntervalMs)));
  const accessCode = input.accessCode?.trim() ?? "";
  if (input.isPrivate && (accessCode.length < 4 || accessCode.length > 24)) return { error: "Private codes must be 4-24 characters.", status: 400 as const };
  const d1 = await getDatabase();
  const active = await d1.prepare("SELECT id FROM online_rooms WHERE (host_player_id = ? OR guest_player_id = ?) AND status != 'completed' LIMIT 1").bind(user.id, user.id).first<{ id: string }>();
  if (active) return { error: `Leave room ${active.id} before creating another.`, status: 409 as const };
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const id = generateRoomId();
    try {
      await d1.prepare(`INSERT INTO online_rooms
        (id, is_private, access_code_hash, status, control_mode, round_seconds, action_interval_ms,
         host_player_id, host_player, host_ready, last_host_seen_at, version, created_at, updated_at)
        VALUES (?, ?, ?, 'waiting', ?, ?, ?, ?, ?, 0, ?, 1, ?, ?)`)
        .bind(id, input.isPrivate ? 1 : 0, input.isPrivate ? await sha256(accessCode) : null, input.controlMode, roundSeconds, actionIntervalMs, user.id, JSON.stringify(makePlayer(user, bot, null)), nowMs, now, now).run();
      const row = await loadRoom(id);
      return { room: viewRoom(row!, user.id) };
    } catch {
      if (attempt === 3) throw new Error("Unable to allocate a room ID.");
    }
  }
  throw new Error("Unable to create room.");
}

export async function joinOnlineRoom(user: AuthUser, roomId: string, accessCode: string | undefined, botValue: unknown) {
  await ensureOnlineRoomSchema();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const row = await loadRoom(roomId);
    if (!row) return { error: "Room not found.", status: 404 as const };
    if (roomSide(row, user.id)) return { room: await synchronizeOnlineRoom(user, row.id) };
    if (row.status !== "waiting" || row.guestPlayerId) return { error: "This room is no longer available.", status: 409 as const };
    if (row.isPrivate && (!accessCode || await sha256(accessCode) !== row.accessCodeHash)) return { error: "Incorrect private room code.", status: 403 as const };
    const bot = validateBot(botValue, row.controlMode);
    if (!bot) return { error: "Select a valid bot and script before joining.", status: 400 as const };
    const nowMs = Date.now();
    const deadline = nowMs + 30_000;
    const host = parsePlayer(row.hostPlayer)!;
    host.setupDeadline = deadline;
    host.ready = false;
    const guest = makePlayer(user, bot, deadline);
    const now = new Date(nowMs).toISOString();
    const d1 = await getDatabase();
    const result = await d1.prepare(`UPDATE online_rooms SET
        guest_player_id = ?, guest_player = ?, host_player = ?, host_ready = 0, guest_ready = 0,
        host_setup_deadline = ?, guest_setup_deadline = ?, last_guest_seen_at = ?, updated_at = ?, version = version + 1
      WHERE id = ? AND guest_player_id IS NULL AND status = 'waiting' AND version = ?`)
      .bind(user.id, JSON.stringify(guest), JSON.stringify(host), deadline, deadline, nowMs, now, row.id, row.version).run();
    if (resultChanges(result)) return { room: await synchronizeOnlineRoom(user, row.id) };
  }
  return { error: "The room changed while joining. Please try once more.", status: 409 as const };
}

function updatePlayerJson(row: RoomRow, side: RoomSide, player: OnlineRoomPlayer) {
  if (side === "host") row.hostPlayer = JSON.stringify(player);
  else row.guestPlayer = JSON.stringify(player);
}

async function saveRoom(row: RoomRow, expectedVersion: number) {
  const d1 = await getDatabase();
  const result = await d1.prepare(`UPDATE online_rooms SET
    status = ?, guest_player_id = ?, host_player = ?, guest_player = ?, host_ready = ?, guest_ready = ?,
    host_setup_deadline = ?, guest_setup_deadline = ?, countdown_started_at = ?, realtime_started_at = ?, match_state = ?,
    winner_player_id = ?, completion_reason = ?, last_host_seen_at = ?, last_guest_seen_at = ?,
    completed_at = ?, updated_at = ?, version = version + 1
    WHERE id = ? AND version = ?`)
    .bind(row.status, row.guestPlayerId, row.hostPlayer, row.guestPlayer, row.hostReady, row.guestReady,
      row.hostSetupDeadline, row.guestSetupDeadline, row.countdownStartedAt, row.realtimeStartedAt, row.matchState,
      row.winnerPlayerId, row.completionReason, row.lastHostSeenAt, row.lastGuestSeenAt,
      row.completedAt, row.updatedAt, row.id, expectedVersion).run();
  return resultChanges(result) > 0;
}

function synchronizeState(row: RoomRow, currentSide: RoomSide, nowMs: number) {
  if (currentSide === "host") row.lastHostSeenAt = nowMs;
  else row.lastGuestSeenAt = nowMs;
  const host = parsePlayer(row.hostPlayer)!;
  const guest = parsePlayer(row.guestPlayer);
  if (row.status === "waiting" && guest) {
    if (!row.hostReady && row.hostSetupDeadline && nowMs >= row.hostSetupDeadline) { row.hostReady = 1; host.ready = true; }
    if (!row.guestReady && row.guestSetupDeadline && nowMs >= row.guestSetupDeadline) { row.guestReady = 1; guest.ready = true; }
    if (row.hostReady && row.guestReady) { row.status = "countdown"; row.countdownStartedAt = nowMs; }
    row.hostPlayer = JSON.stringify(host);
    row.guestPlayer = JSON.stringify(guest);
  }
  if (row.status === "countdown" && row.countdownStartedAt && nowMs >= row.countdownStartedAt + 5000 && guest) {
    row.status = "live";
    row.lastHostSeenAt = nowMs;
    row.lastGuestSeenAt = nowMs;
    row.matchState = JSON.stringify(createOnlineMatch(nowMs, { playerId: row.hostPlayerId, bot: host.bot }, { playerId: row.guestPlayerId!, bot: guest.bot }));
  }
  if (row.status === "live" && row.matchState && !row.realtimeStartedAt) {
    const match = parseMatch(row.matchState)!;
    const otherSeen = currentSide === "host" ? row.lastGuestSeenAt : row.lastHostSeenAt;
    if (otherSeen && nowMs - otherSeen > 6000) {
      forfeitOnlineMatch(match, currentSide);
    } else {
      advanceOnlineMatch(match, nowMs, row.controlMode, row.roundSeconds, row.actionIntervalMs);
    }
    row.matchState = JSON.stringify(match);
    if (match.phase === "complete") {
      row.status = "completed";
      row.completionReason = match.reason;
      row.winnerPlayerId = match.winnerSide === "host" ? row.hostPlayerId : match.winnerSide === "guest" ? row.guestPlayerId : null;
      row.completedAt = new Date(nowMs).toISOString();
    }
  }
  row.updatedAt = new Date(nowMs).toISOString();
}

export async function synchronizeOnlineRoom(user: AuthUser, roomId: string) {
  await ensureOnlineRoomSchema();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const row = await loadRoom(roomId);
    if (!row) throw new Error("Room not found.");
    const side = roomSide(row, user.id);
    if (!side) throw new Error("You are not a player in this room.");
    if (row.status === "completed") return viewRoom(row, user.id);
    const expected = row.version;
    synchronizeState(row, side, Date.now());
    if (await saveRoom(row, expected)) {
      if ((row.status as RoomStatus) === "completed") await finalizeOnlineRoom(row);
      return viewRoom(row, user.id);
    }
  }
  throw new Error("The room changed too quickly; retry.");
}

export async function updateOnlineRoom(user: AuthUser, roomId: string, action: string, payload: { bot?: unknown; name?: unknown; duration?: unknown; sequence?: unknown }) {
  await ensureOnlineRoomSchema();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const row = await loadRoom(roomId);
    if (!row) return { error: "Room not found.", status: 404 as const };
    const side = roomSide(row, user.id);
    if (!side) return { error: "You are not a player in this room.", status: 403 as const };
    const expected = row.version;
    const nowMs = Date.now();
    synchronizeState(row, side, nowMs);
    let actionResult: OnlineActionResult | undefined;
    if (action === "ready") {
      if (row.status !== "waiting" || !row.guestPlayerId) return { error: "Both players must be present before readying.", status: 409 as const };
      const player = parsePlayer(side === "host" ? row.hostPlayer : row.guestPlayer)!;
      player.ready = true;
      updatePlayerJson(row, side, player);
      if (side === "host") row.hostReady = 1; else row.guestReady = 1;
      if (row.hostReady && row.guestReady) { row.status = "countdown"; row.countdownStartedAt = nowMs; }
    } else if (action === "realtime_started") {
      if (row.status !== "live" || !row.matchState) return { error: "The realtime match is not ready.", status: 409 as const };
      row.realtimeStartedAt ??= nowMs;
    } else if (action === "configure") {
      if (row.status !== "waiting") return { error: "Bot setup is locked after the countdown begins.", status: 409 as const };
      const bot = validateBot(payload.bot, row.controlMode);
      if (!bot) return { error: "Invalid bot or script.", status: 400 as const };
      const player = parsePlayer(side === "host" ? row.hostPlayer : row.guestPlayer)!;
      player.bot = bot;
      updatePlayerJson(row, side, player);
    } else if (action === "action") {
      if (row.status !== "live" || !row.matchState || row.controlMode === "script") return { error: "Actions are not accepted right now.", status: 409 as const };
      const name = payload.name;
      if (typeof name !== "string" || !["forward", "turnleft", "turnright", "dash", "skill"].includes(name)) return { error: "Unknown action.", status: 400 as const };
      const match = parseMatch(row.matchState)!;
      const sequence = typeof payload.sequence === "number" && Number.isFinite(payload.sequence) ? Math.round(payload.sequence) : null;
      actionResult = performOnlineActionDetailed(
        match,
        side,
        name as OnlineActionName,
        typeof payload.duration === "number" ? payload.duration : undefined,
        row.actionIntervalMs,
        { queueIfThrottled: true, sequence },
      );
      row.matchState = JSON.stringify(match);
    } else if (action === "leave") {
      if (row.status === "live" || row.status === "countdown") {
        const winnerSide = side === "host" ? "guest" : "host";
        const match = parseMatch(row.matchState) ?? createOnlineMatch(nowMs, { playerId: row.hostPlayerId, bot: parsePlayer(row.hostPlayer)!.bot }, { playerId: row.guestPlayerId!, bot: parsePlayer(row.guestPlayer)!.bot });
        forfeitOnlineMatch(match, winnerSide);
        row.matchState = JSON.stringify(match);
        row.status = "completed";
        row.winnerPlayerId = winnerSide === "host" ? row.hostPlayerId : row.guestPlayerId;
        row.completionReason = "disconnect";
        row.completedAt = new Date(nowMs).toISOString();
      } else if (side === "guest") {
        row.guestPlayerId = null; row.guestPlayer = null; row.guestReady = 0; row.guestSetupDeadline = null; row.lastGuestSeenAt = null;
        row.hostReady = 0; row.hostSetupDeadline = null;
        const host = parsePlayer(row.hostPlayer)!; host.ready = false; host.setupDeadline = null; row.hostPlayer = JSON.stringify(host);
      } else {
        row.status = "completed"; row.completionReason = "disconnect"; row.completedAt = new Date(nowMs).toISOString();
      }
    } else return { error: "Unknown room action.", status: 400 as const };
    row.updatedAt = new Date(nowMs).toISOString();
    if (await saveRoom(row, expected)) {
      if (row.status === "completed" && row.guestPlayerId) await finalizeOnlineRoom(row);
      if (action === "leave") return { left: true as const };
      return { room: viewRoom(row, user.id), actionResult };
    }
  }
  return { error: "The room changed; try again.", status: 409 as const };
}

async function realtimeSettings() {
  const runtime = await import("cloudflare:workers");
  const env = runtime.env as unknown as { REALTIME_URL?: string; REALTIME_SHARED_SECRET?: string };
  const url = env.REALTIME_URL?.trim().replace(/\/$/, "") ?? "";
  const secret = env.REALTIME_SHARED_SECRET?.trim() ?? "";
  return { url, secret };
}

export async function createRealtimeConnection(user: AuthUser, roomId: string) {
  const { url, secret } = await realtimeSettings();
  if (!url || !secret) return { error: "Realtime transport is not configured; using compatibility mode.", status: 503 as const };
  const room = await synchronizeOnlineRoom(user, roomId);
  if (room.status !== "live" || !room.match || !room.guest) return { error: "The realtime match has not started yet.", status: 409 as const };
  const bootstrap: OnlineRoomBootstrap = {
    protocolVersion: REALTIME_PROTOCOL_VERSION,
    roomId: room.id,
    controlMode: room.controlMode,
    roundSeconds: room.roundSeconds,
    actionIntervalMs: room.actionIntervalMs,
    host: room.host,
    guest: room.guest,
    match: room.match,
  };
  const claims = {
    roomId: room.id,
    playerId: user.id,
    side: room.currentSide,
    bootstrapHash: await hashRealtimePayload(bootstrap),
    expiresAt: Date.now() + 60_000,
  };
  const websocketUrl = `${url.replace(/^http:/, "ws:").replace(/^https:/, "wss:")}/room/${encodeURIComponent(room.id)}`;
  const ticket: RealtimeConnectionTicket = { websocketUrl, token: await signRealtimeTicket(claims, secret), bootstrap };
  return { ticket };
}

export async function completeRealtimeRoom(roomId: string, stateValue: unknown, proof: RealtimeCompletionProof) {
  const { secret } = await realtimeSettings();
  if (!secret) return { error: "Realtime completion is not configured.", status: 503 as const };
  if (!stateValue || typeof stateValue !== "object") return { error: "Invalid match state.", status: 400 as const };
  const state = stateValue as OnlineMatchState;
  if (state.schemaVersion !== 1 || state.phase !== "complete" || !state.reason || !["host", "guest", "draw"].includes(String(state.winnerSide))) {
    return { error: "The authoritative match is not complete.", status: 400 as const };
  }
  if (!await verifyCompletionProof(roomId.toUpperCase(), state, proof, secret)) return { error: "Invalid completion proof.", status: 403 as const };
  await ensureOnlineRoomSchema();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const row = await loadRoom(roomId);
    if (!row) return { error: "Room not found.", status: 404 as const };
    if (row.status === "completed") return { completed: true as const };
    if (!row.guestPlayerId || state.bots.host.playerId !== row.hostPlayerId || state.bots.guest.playerId !== row.guestPlayerId) {
      return { error: "Match participants do not match the room.", status: 409 as const };
    }
    if (state.replay.length > 2400) return { error: "Replay is too large.", status: 413 as const };
    const expected = row.version;
    row.matchState = JSON.stringify(state);
    row.status = "completed";
    row.completionReason = state.reason;
    row.winnerPlayerId = state.winnerSide === "host" ? row.hostPlayerId : state.winnerSide === "guest" ? row.guestPlayerId : null;
    row.completedAt = new Date(proof.completedAt).toISOString();
    row.updatedAt = row.completedAt;
    if (await saveRoom(row, expected)) {
      await finalizeOnlineRoom(row);
      return { completed: true as const };
    }
  }
  return { error: "The room changed while completing the match.", status: 409 as const };
}

function replayFor(row: RoomRow, match: OnlineMatchState | null) {
  const host = parsePlayer(row.hostPlayer)!;
  const guest = parsePlayer(row.guestPlayer)!;
  return match ? {
    version: 3,
    arena: ONLINE_ARENA,
    roundSeconds: row.roundSeconds,
    player: { name: host.bot.name, skill: host.bot.skill, appearance: host.bot.appearance },
    enemy: { name: guest.bot.name, skill: guest.bot.skill, appearance: guest.bot.appearance },
    frames: match.replay,
  } : null;
}

async function finalizeOnlineRoom(row: RoomRow) {
  if (!row.guestPlayerId) return;
  const d1 = await getDatabase();
  const match = parseMatch(row.matchState);
  const replay = replayFor(row, match);
  const now = row.completedAt ?? new Date().toISOString();
  const participants = [
    { side: "host" as const, id: row.hostPlayerId, player: parsePlayer(row.hostPlayer)! },
    { side: "guest" as const, id: row.guestPlayerId, player: parsePlayer(row.guestPlayer)! },
  ];
  for (const participant of participants) {
    const result: MatchResult = !row.winnerPlayerId ? "draw" : row.winnerPlayerId === participant.id ? "win" : "loss";
    const rule = MATCH_OUTCOME_RULES[result];
    const current = await getOnlineProfile(participant.id);
    if (!current) continue;
    const historyEntry = {
      id: `match-${row.id}-${participant.id}`,
      result,
      mode: row.controlMode,
      battleType: "pvp",
      botId: participant.player.bot.id,
      scriptId: null,
      playedAt: now,
      telemetry: match?.bots[participant.side].telemetry ?? {},
      replay,
    };
    const next = {
      ...current.profile,
      gold: current.profile.gold + rule.rewards.gold,
      xp: current.profile.xp + rule.rewards.xp,
      battleHistory: [...current.profile.battleHistory, historyEntry].slice(-50),
    };
    const matchId = `match-${row.id}-${participant.id}`;
    const claimId = `reward-${row.id}-${participant.id}`;
    await d1.batch([
      d1.prepare(`UPDATE online_profiles SET profile = ?, revision = revision + 1, updated_at = ?
        WHERE player_id = ? AND NOT EXISTS (SELECT 1 FROM online_reward_claims WHERE room_id = ? AND player_id = ?)`)
        .bind(JSON.stringify(next), now, participant.id, row.id, participant.id),
      d1.prepare(`UPDATE players SET total_xp = total_xp + ?, gold_balance = gold_balance + ?, updated_at = ?
        WHERE id = ? AND NOT EXISTS (SELECT 1 FROM online_reward_claims WHERE room_id = ? AND player_id = ?)`)
        .bind(rule.rewards.xp, rule.rewards.gold, now, participant.id, row.id, participant.id),
      d1.prepare(`INSERT OR IGNORE INTO prototype_match_records
        (id, player_id, player_handle, bot_id, bot_name, control_mode, battle_mode, result, rank_points, telemetry, replay, played_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pvp', ?, ?, ?, ?, ?)`)
        .bind(matchId, participant.id, participant.player.handle, participant.player.bot.id, participant.player.bot.name, row.controlMode, result, rule.rankPoints, JSON.stringify(match?.bots[participant.side].telemetry ?? {}), JSON.stringify(replay ?? {}), now),
      d1.prepare("INSERT OR IGNORE INTO online_reward_claims (id, room_id, player_id, result, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(claimId, row.id, participant.id, result, now),
    ]);
  }
}
