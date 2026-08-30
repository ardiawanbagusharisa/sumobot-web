"use client";
import { commandHelp, parseBotCommand } from "@/lib/game/commands";

import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { roomPollDelay, type OnlineTransportState } from "@/lib/online/polling";
import type { OnlineActionName, OnlineActionResult, OnlineBotSelection, OnlineBotState, OnlineMatchState, OnlineRoomView } from "@/lib/online/types";
import type { RealtimeConnectionTicket, RealtimeServerMessage } from "@/lib/online/realtime-protocol";
import { ONLINE_ARENA } from "@/lib/online/simulation";
import { BattleViewport } from "./BattleViewport";
import { BotDiagnosticsPanels, type BotDiagnosticSnapshot } from "./BotDiagnosticsPanels";
import { BotVisual } from "./BotVisual";

interface OnlineBattleRoomProps {
  roomId: string;
  bots: OnlineBotSelection[];
  selectedBotId: string;
  onExit: () => void;
  onProfileChanged: () => void;
  autoReturnSeconds?: number;
  returnLabel?: string;
}

type RenderBot = Pick<OnlineBotState, "x" | "y" | "angle" | "vx" | "vy" | "turnUntil" | "turnDirection" | "spinVelocity" | "stunnedUntil" | "skillUntil" | "skill">;
interface WheelTrail { x: number; y: number; life: number; maxLife: number; color: string }
interface CollisionParticle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number; color: string }

const ACTION_REJECTION_COPY: Record<NonNullable<OnlineActionResult["reason"]>, string> = {
  interval: "waiting for the next action tick",
  stunned: "bot is stunned",
  stone_locked: "Stone is active",
  dash_cooldown: "dash is cooling down",
  skill_cooldown: "skill is cooling down",
  queue_full: "command queue is full",
};

function actionFeedback(result: OnlineActionResult) {
  if (result.queued) return `${result.name} queued for the next available tick`;
  if (result.accepted) return `${result.name} executed`;
  return `${result.name} rejected · ${result.reason ? ACTION_REJECTION_COPY[result.reason] : "not available"}`;
}

async function postRoom(body: Record<string, unknown>) {
  const response = await fetch("/api/rooms", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json() as { room?: OnlineRoomView; actionResult?: OnlineActionResult; ticket?: RealtimeConnectionTicket; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Room request failed.");
  return payload;
}

function diagnosticSnapshot(bot: OnlineBotState): BotDiagnosticSnapshot {
  return {
    name: bot.name,
    elapsedSeconds: bot.telemetry.durationSeconds,
    collisions: bot.telemetry.collisions,
    centerShare: bot.telemetry.durationSeconds ? bot.telemetry.centerSeconds / bot.telemetry.durationSeconds : 0,
    actionCounts: bot.telemetry.actionCounts,
    heatmap: bot.telemetry.trajectory,
  };
}

function drawArena(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, ONLINE_ARENA.width, ONLINE_ARENA.height);
  context.fillStyle = "#0b1020"; context.fillRect(0, 0, ONLINE_ARENA.width, ONLINE_ARENA.height);
  context.strokeStyle = "rgba(184,255,61,.08)"; context.lineWidth = 1;
  for (let x = 0; x < ONLINE_ARENA.width; x += 32) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, ONLINE_ARENA.height); context.stroke(); }
  for (let y = 0; y < ONLINE_ARENA.height; y += 32) { context.beginPath(); context.moveTo(0, y); context.lineTo(ONLINE_ARENA.width, y); context.stroke(); }
  context.beginPath(); context.arc(ONLINE_ARENA.x, ONLINE_ARENA.y, ONLINE_ARENA.radius + 8, 0, Math.PI * 2); context.fillStyle = "#f2f0e8"; context.fill();
  context.beginPath(); context.arc(ONLINE_ARENA.x, ONLINE_ARENA.y, ONLINE_ARENA.radius, 0, Math.PI * 2); context.fillStyle = "#20283b"; context.fill(); context.strokeStyle = "#b8ff3d"; context.lineWidth = 4; context.stroke();
  context.beginPath(); context.arc(ONLINE_ARENA.x, ONLINE_ARENA.y, 42, 0, Math.PI * 2); context.strokeStyle = "rgba(245,243,234,.18)"; context.lineWidth = 2; context.stroke();
  context.beginPath(); context.moveTo(ONLINE_ARENA.x, ONLINE_ARENA.y - ONLINE_ARENA.radius); context.lineTo(ONLINE_ARENA.x, ONLINE_ARENA.y + ONLINE_ARENA.radius); context.stroke();
}

function normalizeAngle(angle: number) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function renderBotState(bot: OnlineBotState): RenderBot {
  return { x: bot.x, y: bot.y, angle: bot.angle, vx: bot.vx, vy: bot.vy, turnUntil: bot.turnUntil, turnDirection: bot.turnDirection, spinVelocity: bot.spinVelocity, stunnedUntil: bot.stunnedUntil, skillUntil: bot.skillUntil, skill: bot.skill };
}

function collisionBurst(x: number, y: number) {
  return Array.from({ length: 12 }, (_, index): CollisionParticle => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 65 + Math.random() * 135;
    const life = .28 + Math.random() * .28;
    return { x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life, maxLife: life, size: 1.5 + Math.random() * 3, color: index % 3 === 0 ? "#f5f3ea" : index % 2 === 0 ? "#b8ff3d" : "#ff554f" };
  });
}

export function OnlineBattleRoom({ roomId, bots, selectedBotId, onExit, onProfileChanged, autoReturnSeconds, returnLabel = "Return to rooms" }: OnlineBattleRoomProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostVisualRef = useRef<HTMLDivElement>(null);
  const guestVisualRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef<OnlineRoomView | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const transportRef = useRef<OnlineTransportState>("discovering");
  const connectingRef = useRef(false);
  const realtimeStartedRef = useRef(false);
  const heldRef = useRef<Set<OnlineActionName>>(new Set());
  const actionSequenceRef = useRef(0);
  const pendingActionsRef = useRef(new Map<number, (result: OnlineActionResult | null) => void>());
  const targetBotsRef = useRef<{ host: RenderBot; guest: RenderBot } | null>(null);
  const renderedBotsRef = useRef<{ host: RenderBot; guest: RenderBot } | null>(null);
  const targetReceivedAtRef = useRef(0);
  const renderedRoundRef = useRef<number | null>(null);
  const collisionCountRef = useRef<number | null>(null);
  const wheelTrailsRef = useRef<WheelTrail[]>([]);
  const collisionParticlesRef = useRef<CollisionParticle[]>([]);
  const nextTrailAtRef = useRef(0);
  const completedRef = useRef(false);
  const [room, setRoom] = useState<OnlineRoomView | null>(null);
  const [botId, setBotId] = useState(selectedBotId);
  const [transport, setTransportState] = useState<OnlineTransportState>("discovering");
  const [pageVisible, setPageVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [latency, setLatency] = useState<number | null>(null);
  const [command, setCommand] = useState("");
  const [commandLog, setCommandLog] = useState<string[]>(["Terminal ready. Type help for commands."]);
  const [lastActionFeedback, setLastActionFeedback] = useState("No action yet");
  const [message, setMessage] = useState("Connecting to match server…");
  const [clock, setClock] = useState(() => Date.now());
  const [controlsOpen, setControlsOpen] = useState(() => typeof window === "undefined" || !window.matchMedia("(max-width: 680px)").matches);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [scriptOpen, setScriptOpen] = useState(true);
  const [returnDeadline,setReturnDeadline]=useState<number|null>(null);
  const battleViewportMounted = Boolean(room?.match && room.guest && (room.status === "live" || room.status === "completed"));

  const setTransport = useCallback((next: OnlineTransportState) => {
    transportRef.current = next;
    setTransportState(next);
  }, []);

  const applyRoom = useCallback((next: OnlineRoomView) => {
    roomRef.current = next;
    setRoom(next);
    if (next.status === "completed" && !completedRef.current) {
      completedRef.current = true;
      if(autoReturnSeconds)setReturnDeadline(Date.now()+autoReturnSeconds*1000);
      onProfileChanged();
    }
  }, [autoReturnSeconds,onProfileChanged]);

  useEffect(() => {
    const updateVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  const poll = useCallback(async () => {
    try {
      const response = await fetch(`/api/rooms?roomId=${encodeURIComponent(roomId)}`, { cache: "no-store" });
      const payload = await response.json() as { room?: OnlineRoomView; error?: string };
      if (!response.ok || !payload.room) throw new Error(payload.error ?? "Room unavailable.");
      const active = roomRef.current;
      const preserveAuthoritativeSnapshot = transportRef.current === "realtime" && active?.status === "live" && payload.room.status === "live";
      applyRoom(preserveAuthoritativeSnapshot ? { ...payload.room, match: active.match } : payload.room);
      if (transportRef.current === "compatibility") setMessage("Compatibility transport · realtime service unavailable");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection interrupted.");
    }
  }, [applyRoom, roomId]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const loop = async () => {
      setClock(Date.now());
      await poll();
      const delay = roomPollDelay(roomRef.current?.status ?? null, transportRef.current, pageVisible);
      if (!cancelled && delay != null) timer = window.setTimeout(() => void loop(), delay);
    };
    const initialDelay = roomPollDelay(roomRef.current?.status ?? null, transportRef.current, pageVisible);
    if (initialDelay != null) void loop();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [pageVisible, poll, transport]);

  const completeFromRealtime = useCallback(async (state: OnlineMatchState, proof: Extract<RealtimeServerMessage, { type: "complete" }>["proof"]) => {
    const current = roomRef.current;
    if (!current) return;
    const winnerSide = state.winnerSide;
    const result = winnerSide === "draw" ? "draw" : winnerSide === current.currentSide ? "win" : "loss";
    applyRoom({ ...current, status: "completed", match: state, result, completionReason: state.reason, winnerPlayerId: winnerSide === "host" ? current.host.id : winnerSide === "guest" ? current.guest?.id ?? null : null });
    try {
      await fetch("/api/rooms/realtime-result", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomId, state, proof }) });
      onProfileChanged();
    } catch { /* the match worker also submits the signed result */ }
  }, [applyRoom, onProfileChanged, roomId]);

  const connectRealtime = useCallback(async () => {
    const current = roomRef.current;
    if (!current || current.status !== "live" || connectingRef.current || socketRef.current?.readyState === WebSocket.OPEN || transportRef.current === "compatibility") return;
    connectingRef.current = true;
    setTransport(realtimeStartedRef.current ? "reconnecting" : "connecting");
    setMessage(realtimeStartedRef.current ? "Reconnecting to realtime match…" : "Starting realtime match…");
    try {
      const payload = await postRoom({ action: "realtime_ticket", roomId });
      if (!payload.ticket) throw new Error("Realtime ticket unavailable.");
      const ticket = payload.ticket;
      const socket = new WebSocket(`${ticket.websocketUrl}?ticket=${encodeURIComponent(ticket.token)}`);
      socketRef.current = socket;
      socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "authenticate", bootstrap: ticket.bootstrap })));
      socket.addEventListener("message", (event) => {
        const serverMessage = JSON.parse(String(event.data)) as RealtimeServerMessage;
        if (serverMessage.type === "ready") {
          setTransport("realtime");
          setMessage("Realtime connected");
          if (!realtimeStartedRef.current) {
            realtimeStartedRef.current = true;
            void postRoom({ action: "realtime_started", roomId }).catch(() => undefined);
          }
        } else if (serverMessage.type === "snapshot") {
          const active = roomRef.current;
          if (active) applyRoom({ ...active, status: serverMessage.state.phase === "complete" ? "completed" : "live", match: serverMessage.state });
        } else if (serverMessage.type === "action-result") {
          setLastActionFeedback(actionFeedback(serverMessage.result));
          pendingActionsRef.current.get(serverMessage.result.sequence ?? -1)?.(serverMessage.result);
          if (serverMessage.result.sequence != null) pendingActionsRef.current.delete(serverMessage.result.sequence);
        } else if (serverMessage.type === "pong") {
          setLatency(Math.max(0, Math.round((Date.now() - serverMessage.sentAt) / 2)));
        } else if (serverMessage.type === "complete") {
          void completeFromRealtime(serverMessage.state, serverMessage.proof);
        } else if (serverMessage.type === "error") setMessage(serverMessage.message);
      });
      socket.addEventListener("close", () => {
        if (socketRef.current === socket) socketRef.current = null;
        if (!completedRef.current && realtimeStartedRef.current) {
          setTransport("reconnecting");
          window.setTimeout(() => setReconnectNonce((value) => value + 1), 700);
        }
      });
      socket.addEventListener("error", () => socket.close());
    } catch (error) {
      if (!realtimeStartedRef.current) {
        setTransport("compatibility");
        setMessage("Compatibility transport · realtime service unavailable");
      } else {
        setTransport("reconnecting");
        setMessage(error instanceof Error ? error.message : "Realtime connection interrupted.");
        window.setTimeout(() => setReconnectNonce((value) => value + 1), 1000);
      }
    } finally { connectingRef.current = false; }
  }, [applyRoom, completeFromRealtime, roomId, setTransport]);

  useEffect(() => { if (room?.status === "live") void connectRealtime(); }, [connectRealtime, reconnectNonce, room?.status]);

  useEffect(() => {
    if (transport !== "realtime") return;
    const timer = window.setInterval(() => {
      if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: "ping", sentAt: Date.now() }));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [transport]);

  const mutate = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    try {
      const payload = await postRoom({ action, roomId, ...extra });
      if (payload.room) applyRoom(payload.room);
      return payload;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed.");
      return null;
    }
  }, [applyRoom, roomId]);

  const sendAction = useCallback(async (name: OnlineActionName, duration?: number) => {
    const sequence = ++actionSequenceRef.current;
    const socket = socketRef.current;
    if (transportRef.current === "realtime" && socket?.readyState === WebSocket.OPEN) {
      return await new Promise<OnlineActionResult | null>((resolve) => {
        pendingActionsRef.current.set(sequence, resolve);
        socket.send(JSON.stringify({ type: "action", sequence, name, duration }));
        window.setTimeout(() => { if (pendingActionsRef.current.delete(sequence)) resolve(null); }, 1500);
      });
    }
    const payload = await mutate("action", { name, duration, sequence });
    const result = payload?.actionResult ?? null;
    if (result) setLastActionFeedback(actionFeedback(result));
    return result;
  }, [mutate]);

  const sendControlState = useCallback(() => {
    const socket = socketRef.current;
    if (transportRef.current !== "realtime" || socket?.readyState !== WebSocket.OPEN) return;
    const sequence = ++actionSequenceRef.current;
    const turn = heldRef.current.has("turnleft") ? -1 : heldRef.current.has("turnright") ? 1 : 0;
    socket.send(JSON.stringify({ type: "input", input: { sequence, forward: heldRef.current.has("forward"), turn } }));
  }, []);

  useEffect(() => {
    if (room?.controlMode !== "buttons" || room.status !== "live") return;
    const held = heldRef.current;
    const keyActions: Record<string, OnlineActionName> = { KeyW: "forward", KeyA: "turnleft", KeyD: "turnright" };
    const down = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      const action = keyActions[event.code];
      if (action) {
        event.preventDefault();
        const fresh = !held.has(action);
        held.add(action);
        sendControlState();
        if (fresh && transportRef.current === "compatibility") void sendAction(action, .3);
      } else if (!event.repeat && (event.code === "KeyE" || event.code === "KeyQ")) void sendAction(event.code === "KeyE" ? "dash" : "skill");
    };
    const up = (event: KeyboardEvent) => { const action = keyActions[event.code]; if (action) { held.delete(action); sendControlState(); } };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    const timer = window.setInterval(() => {
      if (transportRef.current === "realtime") sendControlState();
      else held.forEach((action) => void sendAction(action, .3));
    }, Math.max(50, room.actionIntervalMs));
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.clearInterval(timer); held.clear(); sendControlState(); };
  }, [room?.actionIntervalMs, room?.controlMode, room?.status, sendAction, sendControlState, transport]);

  useEffect(() => {
    const match = room?.match;
    if (!match) return;
    const next = { host: renderBotState(match.bots.host), guest: renderBotState(match.bots.guest) };
    targetBotsRef.current = next;
    targetReceivedAtRef.current = performance.now();
    if (!renderedBotsRef.current || renderedRoundRef.current !== match.round) {
      renderedBotsRef.current = structuredClone(next);
      renderedRoundRef.current = match.round;
      wheelTrailsRef.current = [];
      collisionParticlesRef.current = [];
    }
    const collisions = Math.max(match.bots.host.telemetry.collisions, match.bots.guest.telemetry.collisions);
    if (collisionCountRef.current != null && collisions > collisionCountRef.current) {
      collisionParticlesRef.current.push(...collisionBurst((next.host.x + next.guest.x) / 2, (next.host.y + next.guest.y) / 2));
    }
    collisionCountRef.current = collisions;
  }, [room?.match]);

  useEffect(() => {
    if (!battleViewportMounted) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawArena(canvas);
    let frame = 0;
    let previous = performance.now();
    const render = (now: number) => {
      const dt = Math.min(.05, (now - previous) / 1000); previous = now;
      drawArena(canvas);
      const target = targetBotsRef.current;
      const rendered = renderedBotsRef.current;
      if (target && rendered) {
        const extrapolation = Math.min(.1, Math.max(0, (now - targetReceivedAtRef.current) / 1000));
        const simulatedNow = (roomRef.current?.match?.simulatedAt ?? 0) + extrapolation * 1000;
        const blend = 1 - Math.exp(-20 * dt);
        for (const key of ["host", "guest"] as const) {
          const desiredX = target[key].x + target[key].vx * extrapolation;
          const desiredY = target[key].y + target[key].vy * extrapolation;
          let desiredAngle = target[key].angle + target[key].spinVelocity * extrapolation;
          if (simulatedNow >= target[key].stunnedUntil && simulatedNow < target[key].turnUntil) desiredAngle += target[key].turnDirection * 2.8 * extrapolation;
          rendered[key].x += (desiredX - rendered[key].x) * blend;
          rendered[key].y += (desiredY - rendered[key].y) * blend;
          rendered[key].angle = normalizeAngle(rendered[key].angle + normalizeAngle(desiredAngle - rendered[key].angle) * blend);
          rendered[key].vx = target[key].vx;
          rendered[key].vy = target[key].vy;
          rendered[key].turnUntil = target[key].turnUntil;
          rendered[key].turnDirection = target[key].turnDirection;
          rendered[key].spinVelocity = target[key].spinVelocity;
          rendered[key].stunnedUntil = target[key].stunnedUntil;
          rendered[key].skillUntil = target[key].skillUntil;
          rendered[key].skill = target[key].skill;
        }
        if (now >= nextTrailAtRef.current && roomRef.current?.match?.phase === "live") {
          for (const key of ["host", "guest"] as const) {
            if (Math.hypot(target[key].vx, target[key].vy) < 18) continue;
            const offsetX = -Math.sin(rendered[key].angle) * 18;
            const offsetY = Math.cos(rendered[key].angle) * 18;
            const color = key === "host" ? "#b8ff3d" : "#ff554f";
            wheelTrailsRef.current.push(
              { x: rendered[key].x + offsetX, y: rendered[key].y + offsetY, life: .55, maxLife: .55, color },
              { x: rendered[key].x - offsetX, y: rendered[key].y - offsetY, life: .55, maxLife: .55, color },
            );
          }
          wheelTrailsRef.current = wheelTrailsRef.current.slice(-180);
          nextTrailAtRef.current = now + 42;
        }
        const scaleX = canvas.clientWidth / ONLINE_ARENA.width;
        const scaleY = canvas.clientHeight / ONLINE_ARENA.height;
        const scale = (scaleX + scaleY) / 2;
        const position = (element: HTMLDivElement | null, bot: RenderBot) => {
          if (!element) return;
          element.style.left = `${bot.x * scaleX - 32}px`;
          element.style.top = `${bot.y * scaleY - 32}px`;
          element.style.transform = `rotate(${bot.angle}rad) scale(${scale})`;
          element.classList.toggle("stunned", simulatedNow < bot.stunnedUntil);
          element.classList.toggle("stone-active", bot.skill === "stone" && simulatedNow < bot.skillUntil);
          element.classList.toggle("boost-active", bot.skill === "boost" && simulatedNow < bot.skillUntil);
        };
        position(hostVisualRef.current, rendered.host);
        position(guestVisualRef.current, rendered.guest);
      }
      const context = canvas.getContext("2d");
      if (context) {
        context.save();
        wheelTrailsRef.current = wheelTrailsRef.current.filter((point) => {
          point.life -= dt;
          if (point.life <= 0) return false;
          context.globalAlpha = Math.pow(point.life / point.maxLife, 1.5) * .52;
          context.fillStyle = point.color;
          context.beginPath(); context.arc(point.x, point.y, 2.3, 0, Math.PI * 2); context.fill();
          return true;
        });
        collisionParticlesRef.current = collisionParticlesRef.current.filter((particle) => {
          particle.life -= dt;
          if (particle.life <= 0) return false;
          particle.x += particle.vx * dt; particle.y += particle.vy * dt;
          particle.vx *= Math.pow(.07, dt); particle.vy *= Math.pow(.07, dt);
          context.globalAlpha = particle.life / particle.maxLife;
          context.fillStyle = particle.color;
          context.beginPath(); context.arc(particle.x, particle.y, particle.size * (particle.life / particle.maxLife), 0, Math.PI * 2); context.fill();
          return true;
        });
        context.restore();
      }
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [battleViewportMounted]);

  useEffect(()=>{if(!returnDeadline)return;const tick=window.setInterval(()=>setClock(Date.now()),1000);const timer=window.setTimeout(onExit,Math.max(0,returnDeadline-Date.now()));return()=>{window.clearInterval(tick);window.clearTimeout(timer)}},[onExit,returnDeadline]);

  useEffect(() => () => {
    const socket = socketRef.current;
    if (roomRef.current?.status !== "completed" && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "leave" }));
    socket?.close();
  }, []);

  const configure = async (nextBotId: string) => {
    setBotId(nextBotId);
    const bot = bots.find((item) => item.id === nextBotId);
    if (bot) await mutate("configure", { bot });
  };

  const leave = async () => {
    const socket = socketRef.current;
    if (transportRef.current === "realtime" && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "leave" }));
      socket.close();
      onExit();
      return;
    }
    try { await postRoom({ action: "leave", roomId }); } finally { onExit(); }
  };

  const submitCommand = async (event?: FormEvent) => {
    event?.preventDefault();
    const value = command.trim().toLowerCase();
    if (!value) return;
    if (value.startsWith("help")) {
      setCommandLog(commandHelp(value.slice(4).trim()));
      setCommand(""); return;
    }
    if (value === "clear") { setCommandLog([]); setCommand(""); return; }
    const parsed = parseBotCommand(value);
    let result: OnlineActionResult | null = null;
    if (parsed.command) result = await sendAction(parsed.command.name as OnlineActionName, parsed.command.duration);
    else { setCommandLog((items) => [...items.slice(-6), `> ${value}`, parsed.error ?? "Command rejected"]); setCommand(""); return; }
    setCommandLog((items) => [...items.slice(-6), `> ${value}`, result ? actionFeedback(result) : "Command acknowledgement timed out"]);
    setCommand("");
  };

  const startHeldAction = (action: OnlineActionName, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const fresh = !heldRef.current.has(action);
    heldRef.current.add(action);
    sendControlState();
    if (fresh && transportRef.current === "compatibility") void sendAction(action, .3);
  };
  const stopHeldAction = (action: OnlineActionName) => { heldRef.current.delete(action); sendControlState(); };

  const setupRemaining = room ? Math.max(0, Math.ceil((((room.currentSide === "host" ? room.host : room.guest)?.setupDeadline ?? clock) - clock) / 1000)) : 0;
  const countdown = room?.countdownEndsAt ? Math.max(0, Math.ceil((room.countdownEndsAt - clock) / 1000)) : 0;
  const returnRemaining=returnDeadline?Math.max(0,Math.ceil((returnDeadline-clock)/1000)):null;
  if (!room) return <section className="online-lobby loading"><strong>Connecting to room {roomId}</strong><span>{message}</span></section>;
  if (room.status === "waiting" || room.status === "countdown") {
    const ownPlayer = room.currentSide === "host" ? room.host : room.guest;
    const ownReady = Boolean(ownPlayer?.ready);
    return <section className="online-lobby">
      <header><div><span className="eyebrow">Room {room.id} · {room.isPrivate ? "Private" : "Public"}</span><h1>{room.status === "countdown" ? `Battle starts in ${countdown}` : "Prepare your bot"}</h1><p>{room.controlMode.toUpperCase()} · {room.roundSeconds}s rounds · {room.actionIntervalMs}ms decision interval</p></div><button type="button" onClick={() => void leave()}>Leave room</button></header>
      <div className="lobby-versus">{[room.host, room.guest].map((player) => player ? <article key={player.id} className={player.id === ownPlayer?.id ? "you" : ""}><BotVisual name={player.bot.name} skill={player.bot.skill} appearance={player.bot.appearance} /><strong>{player.displayName}</strong><span>{player.bot.name} · {player.ready ? "READY" : "SETTING UP"}</span></article> : <article key="empty" className="empty"><strong>Waiting for player two</strong><span>Share room ID {room.id}</span></article>)}</div>
      {room.status === "waiting" && room.guest && <div className={`lobby-ready-panel ${ownReady ? "ready" : ""}`}><label>Battle bot<select value={botId} disabled={ownReady} onChange={(event) => void configure(event.target.value)}>{bots.map((bot) => <option value={bot.id} key={bot.id}>{bot.name} · {bot.skill}</option>)}</select></label><span>{ownReady ? "Waiting for opponent" : `Auto-ready in ${setupRemaining}s`}</span><button type="button" disabled={ownReady} aria-pressed={ownReady} onClick={() => void mutate("ready")}>{ownReady ? "Ready ✓" : "Ready now"}</button></div>}
      {message && <p className="room-message">{message}</p>}
    </section>;
  }

  const match = room.match;
  if (!match || !room.guest) return <section className="online-lobby loading"><strong>Synchronizing match state</strong><span>{message}</span></section>;
  const ownSide = room.currentSide;
  const ownPlayer = ownSide === "host" ? room.host : room.guest;
  const ownBot = match.bots[ownSide];
  const remaining = Math.max(0, room.roundSeconds - (match.simulatedAt - match.roundStartedAt) / 1000);
  const cooldowns = {
    dash: Math.max(0, (ownBot.dashReadyAt - match.simulatedAt) / 1000),
    skill: Math.max(0, (ownBot.skillReadyAt - match.simulatedAt) / 1000),
    stun: Math.max(0, (ownBot.stunnedUntil - match.simulatedAt) / 1000),
    stone: ownBot.skill === "stone" ? Math.max(0, (ownBot.skillUntil - match.simulatedAt) / 1000) : 0,
  };
  const networkMessage = transport === "realtime" ? `Realtime · ${latency ?? "–"}ms` : transport === "compatibility" ? "Compatibility transport" : "Connecting realtime…";
  const durationLabel = `${room.roundSeconds}s rounds`;

  return <section className="battle-shell" aria-label="Online Sumobot battle">
    <BattleViewport
      canvasRef={canvasRef}
      leftVisualRef={hostVisualRef}
      rightVisualRef={guestVisualRef}
      left={{ name: room.host.displayName, botName: room.host.bot.name, detail: room.host.bot.skill === "boost" ? "Speed ×1.5 · 3s" : "Reflect ×2 · 3s", skill: room.host.bot.skill, appearance: room.host.bot.appearance, score: match.scores.host }}
      right={{ name: room.guest.displayName, botName: room.guest.bot.name, detail: room.guest.bot.skill === "boost" ? "Speed ×1.5 · 3s" : "Reflect ×2 · 3s", skill: room.guest.bot.skill, appearance: room.guest.bot.appearance, score: match.scores.guest }}
      round={match.round}
      timeSeconds={remaining}
      message={networkMessage}
      onLeave={() => void leave()}
      leaveLabel="Leave arena"
    >
      <BotDiagnosticsPanels left={diagnosticSnapshot(match.bots.host)} right={diagnosticSnapshot(match.bots.guest)} />
      {room.status === "completed" && <div className="match-finished-actions"><strong>{room.completionReason === "disconnect" ? "Opponent disconnected" : "Match complete"}</strong><span>{returnRemaining!==null?`Returning to Seasons in ${returnRemaining}s so you can choose the next opponent.`:"Rewards and leaderboard points were applied online."}</span><div><button type="button" className="claim-reward" onClick={onExit}>{returnLabel}</button></div></div>}
    </BattleViewport>

    {room.status !== "completed" && <div className={`battle-controls arena-control-overlay ${room.controlMode} ${controlsOpen ? "open" : "collapsed"}`}>
      <div className="control-info"><button className="control-fold-toggle" type="button" aria-expanded={controlsOpen} aria-label={controlsOpen ? "Fold battle controls" : "Unfold battle controls"} onClick={() => setControlsOpen((value) => !value)}>{controlsOpen ? "v" : "^"}</button><div><strong>{room.controlMode === "live" ? "Live Command" : room.controlMode === "script" ? "Script Pilot" : "Button Pilot"}</strong><small>{durationLabel} · Boost/Stone 3s · cooldown 10s</small></div><code className={cooldowns.stun > 0 ? "stun-readout" : ""}>{cooldowns.stun > 0 ? `STUN ${cooldowns.stun.toFixed(1)}s` : lastActionFeedback}</code></div>
      {room.controlMode === "buttons" && <div className="action-pad">
        <button onPointerDown={(event) => startHeldAction("turnleft", event)} onPointerUp={() => stopHeldAction("turnleft")} onPointerCancel={() => stopHeldAction("turnleft")} onLostPointerCapture={() => stopHeldAction("turnleft")} aria-label="Hold to turn left">A<small>left</small></button>
        <button className="primary-action" onPointerDown={(event) => startHeldAction("forward", event)} onPointerUp={() => stopHeldAction("forward")} onPointerCancel={() => stopHeldAction("forward")} onLostPointerCapture={() => stopHeldAction("forward")} aria-label="Hold to move forward">W<small>forward</small></button>
        <button onPointerDown={(event) => startHeldAction("turnright", event)} onPointerUp={() => stopHeldAction("turnright")} onPointerCancel={() => stopHeldAction("turnright")} onLostPointerCapture={() => stopHeldAction("turnright")} aria-label="Hold to turn right">D<small>right</small></button>
        <button className={`instant-action skill-action ${cooldowns.skill <= 0 && cooldowns.stone <= 0 ? "ready" : "cooling"}`} disabled={cooldowns.skill > 0 || cooldowns.stun > 0 || cooldowns.stone > 0} onClick={() => void sendAction("skill")} aria-label="Use skill">Q<small>{cooldowns.skill > 0 ? `${cooldowns.skill.toFixed(1)}s` : cooldowns.stone > 0 ? "stone" : "ready"}</small></button>
        <button className={`instant-action dash-action ${cooldowns.dash <= 0 && cooldowns.stone <= 0 ? "ready" : "cooling"}`} disabled={cooldowns.dash > 0 || cooldowns.stun > 0 || cooldowns.stone > 0} onClick={() => void sendAction("dash")} aria-label="Dash">E<small>{cooldowns.dash > 0 ? `${cooldowns.dash.toFixed(1)}s` : cooldowns.stone > 0 ? "stone" : "ready"}</small></button>
      </div>}
      {room.controlMode === "live" && <div className="terminal-panel"><button className="overlay-toggle" type="button" onClick={() => setTerminalOpen((open) => !open)}><span>{terminalOpen ? "v" : "^"}</span> Live terminal</button>{terminalOpen && <><div className="terminal-log" aria-live="polite">{commandLog.map((line, index) => <span key={`${line}-${index}`}>{line}</span>)}</div><form className="terminal-input" onSubmit={(event) => void submitCommand(event)}><span>&gt;</span><input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="forward(0.5)" aria-label="Live command" autoComplete="off" /><button type="submit">Run</button></form></>}</div>}
      {room.controlMode === "script" && <div className="battle-script-panel"><button className="overlay-toggle" type="button" onClick={() => setScriptOpen((open) => !open)}><span>{scriptOpen ? "v" : "^"}</span> Authoritative battle script</button>{scriptOpen && <><textarea value={ownPlayer.bot.scriptSource} readOnly spellCheck={false} aria-label="Authoritative in-battle script" /><div className="battle-script-apply"><small>{ownBot.scriptError ?? "Running on the realtime match server"}</small><button type="button" disabled>Locked</button></div></>}</div>}
    </div>}
    {message && transport === "reconnecting" && <p className="online-error">{message}</p>}
  </section>;
}
