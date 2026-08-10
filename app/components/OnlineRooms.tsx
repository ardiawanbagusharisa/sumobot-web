"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { ControlMode } from "@/lib/game/rules";
import type { OnlineActionName, OnlineBotSelection, OnlineRoomSummary, OnlineRoomView, RoomSide } from "@/lib/online/types";
import { ONLINE_ARENA } from "@/lib/online/simulation";
import { BotVisual } from "./BotVisual";

interface OnlineRoomBrowserProps {
  bots: OnlineBotSelection[];
  selectedBotId: string;
  mode: ControlMode;
  roundSeconds: number;
  actionIntervalMs: number;
  onJoined: (roomId: string, mode: ControlMode) => void;
}

async function roomRequest(body: Record<string, unknown>) {
  const response = await fetch("/api/rooms", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as { room?: OnlineRoomView; error?: string };
  if (!response.ok || !payload.room) throw new Error(payload.error ?? "Room request failed.");
  return payload.room;
}

export function OnlineRoomBrowser({ bots, selectedBotId, mode, roundSeconds, actionIntervalMs, onJoined }: OnlineRoomBrowserProps) {
  const [rooms, setRooms] = useState<OnlineRoomSummary[]>([]);
  const [query, setQuery] = useState("");
  const [privateRoom, setPrivateRoom] = useState(false);
  const [createCode, setCreateCode] = useState("");
  const [joinCodes, setJoinCodes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Live room list updates automatically.");
  const selectedBot = bots.find((bot) => bot.id === selectedBotId) ?? bots[0];

  const refresh = useCallback(async (search = query) => {
    try {
      const response = await fetch(`/api/rooms${search.trim() ? `?query=${encodeURIComponent(search.trim())}` : ""}`, { cache: "no-store" });
      const payload = await response.json() as { rooms?: OnlineRoomSummary[] };
      const nextRooms = payload.rooms ?? [];
      setRooms(nextRooms);
      if (search.trim()) {
        setJoinCodes((codes) => Object.fromEntries(nextRooms.map((room) => [room.id, room.isPrivate ? (codes[room.id] ?? search.trim()) : (codes[room.id] ?? "")] )));
      }
    } catch {
      setMessage("Room list is temporarily unavailable.");
    }
  }, [query]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [refresh]);

  const createRoom = async () => {
    if (!selectedBot) return;
    setBusy(true);
    try {
      const room = await roomRequest({ action: "create", isPrivate: privateRoom, accessCode: createCode, controlMode: mode, roundSeconds, actionIntervalMs, bot: selectedBot });
      onJoined(room.id, room.controlMode);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create room.");
    } finally { setBusy(false); }
  };

  const joinRoom = async (room: OnlineRoomSummary) => {
    if (!selectedBot) return;
    setBusy(true);
    try {
      const joined = await roomRequest({ action: "join", roomId: room.id, accessCode: joinCodes[room.id], bot: selectedBot });
      onJoined(joined.id, joined.controlMode);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to join room.");
    } finally { setBusy(false); }
  };

  const search = (event: FormEvent) => { event.preventDefault(); void refresh(query); };

  return (
    <section className="online-room-browser" aria-label="Online PvP rooms">
      <header className="online-room-heading">
        <div><span className="eyebrow">Online alpha</span><h2>Game rooms</h2><p>Create a room or join another player. Locked rooms require the creator&apos;s code.</p></div>
        <form className="room-search" onSubmit={search}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Room ID or private code" aria-label="Search rooms" /><button type="submit">Find</button></form>
      </header>

      <div className="room-create-panel">
        <div className="room-privacy-toggle" role="group" aria-label="Room privacy">
          <button type="button" className={!privateRoom ? "active" : ""} onClick={() => setPrivateRoom(false)}>Public</button>
          <button type="button" className={privateRoom ? "active" : ""} onClick={() => setPrivateRoom(true)}>Private</button>
        </div>
        {privateRoom && <input value={createCode} onChange={(event) => setCreateCode(event.target.value)} minLength={4} maxLength={24} placeholder="Create a 4-24 character code" aria-label="Private room code" />}
        <div className="room-create-summary"><strong>{mode.toUpperCase()}</strong><span>{selectedBot?.name ?? "Select a bot"} · {roundSeconds}s rounds · {actionIntervalMs}ms tick</span></div>
        <button type="button" className="battle-launch" disabled={busy || !selectedBot || (privateRoom && createCode.trim().length < 4)} onClick={createRoom}>Create room</button>
      </div>

      <p className="room-message" aria-live="polite">{message}</p>
      <div className="room-list">
        {rooms.length === 0 && <div className="room-empty"><strong>No matching rooms</strong><span>Create one and invite another player.</span></div>}
        {rooms.map((room) => (
          <article className="room-row" key={room.id}>
            <div className="room-id"><span>{room.isPrivate ? "LOCKED" : "PUBLIC"}</span><strong>{room.id}</strong></div>
            <div><strong>{room.hostName}{room.guestName ? ` vs ${room.guestName}` : " is waiting"}</strong><span>{room.controlMode.toUpperCase()} · {room.roundSeconds}s · {room.actionIntervalMs}ms</span></div>
            <span className={`room-status ${room.status}`}>{room.status === "live" ? "ONGOING" : room.status.toUpperCase()}</span>
            {room.status === "waiting" && room.playerCount === 1 ? (
              <div className="room-join">
                {room.isPrivate && <input value={joinCodes[room.id] ?? ""} onChange={(event) => setJoinCodes((codes) => ({ ...codes, [room.id]: event.target.value }))} placeholder="Room code" aria-label={`Code for room ${room.id}`} />}
                <button type="button" disabled={busy || (room.isPrivate && !(joinCodes[room.id]?.trim()))} onClick={() => void joinRoom(room)}>Join</button>
              </div>
            ) : <span className="room-full">{room.playerCount}/2</span>}
          </article>
        ))}
      </div>
    </section>
  );
}

interface OnlineBattleRoomProps {
  roomId: string;
  bots: OnlineBotSelection[];
  selectedBotId: string;
  onExit: () => void;
  onProfileChanged: () => void;
}

export function OnlineBattleRoom({ roomId, bots, selectedBotId, onExit, onProfileChanged }: OnlineBattleRoomProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const roomRef = useRef<OnlineRoomView | null>(null);
  const heldRef = useRef<Set<OnlineActionName>>(new Set());
  const completedRef = useRef(false);
  const [room, setRoom] = useState<OnlineRoomView | null>(null);
  const [botId, setBotId] = useState(selectedBotId);
  const [command, setCommand] = useState("");
  const [message, setMessage] = useState("Connecting to authoritative match server…");
  const [clock, setClock] = useState(() => Date.now());

  const poll = useCallback(async () => {
    try {
      const response = await fetch(`/api/rooms?roomId=${encodeURIComponent(roomId)}`, { cache: "no-store" });
      const payload = await response.json() as { room?: OnlineRoomView; error?: string };
      if (!response.ok || !payload.room) throw new Error(payload.error ?? "Room unavailable.");
      roomRef.current = payload.room;
      setRoom(payload.room);
      setMessage("");
      if (payload.room.status === "completed" && !completedRef.current) {
        completedRef.current = true;
        onProfileChanged();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection interrupted.");
    }
  }, [onProfileChanged, roomId]);

  useEffect(() => {
    const initial = window.setTimeout(() => void poll(), 0);
    const timer = window.setInterval(() => { setClock(Date.now()); void poll(); }, room?.status === "live" ? 200 : 500);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [poll, room?.status]);

  const mutate = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    try {
      const next = await roomRequest({ action, roomId, ...extra });
      roomRef.current = next;
      setRoom(next);
      return next;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed.");
      return null;
    }
  }, [roomId]);

  const sendAction = useCallback((name: OnlineActionName, duration?: number) => {
    if (roomRef.current?.status !== "live") return;
    void mutate("action", { name, duration });
  }, [mutate]);

  useEffect(() => {
    if (room?.controlMode !== "buttons") return;
    const heldActions = heldRef.current;
    const keyActions: Record<string, OnlineActionName> = { KeyW: "forward", KeyA: "turnleft", KeyD: "turnright" };
    const down = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      const held = keyActions[event.code];
      if (held) { event.preventDefault(); if (!heldActions.has(held)) sendAction(held, .3); heldActions.add(held); }
      else if (!event.repeat && (event.code === "KeyE" || event.code === "KeyQ")) sendAction(event.code === "KeyE" ? "dash" : "skill");
    };
    const up = (event: KeyboardEvent) => { const held = keyActions[event.code]; if (held) heldActions.delete(held); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    const repeat = window.setInterval(() => heldActions.forEach((action) => sendAction(action, .3)), Math.max(100, room.actionIntervalMs));
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.clearInterval(repeat); heldActions.clear(); };
  }, [room?.actionIntervalMs, room?.controlMode, sendAction]);

  useEffect(() => () => {
    const current = roomRef.current;
    if (current && current.status !== "completed") {
      void fetch("/api/rooms", { method: "POST", credentials: "same-origin", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "leave", roomId }) });
    }
  }, [roomId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.fillStyle = "#0b1020"; context.fillRect(0, 0, ONLINE_ARENA.width, ONLINE_ARENA.height);
    context.strokeStyle = "rgba(184,255,61,.08)"; context.lineWidth = 1;
    for (let x = 0; x < ONLINE_ARENA.width; x += 32) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, ONLINE_ARENA.height); context.stroke(); }
    for (let y = 0; y < ONLINE_ARENA.height; y += 32) { context.beginPath(); context.moveTo(0, y); context.lineTo(ONLINE_ARENA.width, y); context.stroke(); }
    context.beginPath(); context.arc(ONLINE_ARENA.x, ONLINE_ARENA.y, ONLINE_ARENA.radius + 8, 0, Math.PI * 2); context.fillStyle = "#f2f0e8"; context.fill();
    context.beginPath(); context.arc(ONLINE_ARENA.x, ONLINE_ARENA.y, ONLINE_ARENA.radius, 0, Math.PI * 2); context.fillStyle = "#20283b"; context.fill(); context.strokeStyle = "#b8ff3d"; context.lineWidth = 4; context.stroke();
    context.beginPath(); context.moveTo(ONLINE_ARENA.x, ONLINE_ARENA.y - ONLINE_ARENA.radius); context.lineTo(ONLINE_ARENA.x, ONLINE_ARENA.y + ONLINE_ARENA.radius); context.strokeStyle = "rgba(245,243,234,.18)"; context.lineWidth = 2; context.stroke();
  }, [room?.status]);

  const configure = async (nextBotId: string) => {
    setBotId(nextBotId);
    const bot = bots.find((item) => item.id === nextBotId);
    if (bot) await mutate("configure", { bot });
  };

  const leave = async () => {
    try {
      await fetch("/api/rooms", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "leave", roomId }) });
    } finally { onExit(); }
  };
  const submitCommand = (event: FormEvent) => {
    event.preventDefault();
    const value = command.trim().toLowerCase();
    const timed = value.match(/^(forward|turnleft|turnright)\((\d+(?:\.\d+)?)\)$/);
    const instant = value.match(/^(dash|skill)\(\)$/);
    if (timed) sendAction(timed[1] as OnlineActionName, Number(timed[2]));
    else if (instant) sendAction(instant[1] as OnlineActionName);
    else setMessage("Use forward(x), turnleft(x), turnright(x), dash(), or skill().");
    setCommand("");
  };

  const startHeldAction = useCallback((action: OnlineActionName, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    heldRef.current.add(action);
    sendAction(action, .3);
  }, [sendAction]);
  const stopHeldAction = useCallback((action: OnlineActionName) => { heldRef.current.delete(action); }, []);
  const setupRemaining = room ? Math.max(0, Math.ceil((((room.currentSide === "host" ? room.host : room.guest)?.setupDeadline ?? clock) - clock) / 1000)) : 0;
  const countdown = room?.countdownEndsAt ? Math.max(0, Math.ceil((room.countdownEndsAt - clock) / 1000)) : 0;
  const match = room?.match;
  const ownSide: RoomSide = room?.currentSide ?? "host";
  const remaining = match ? Math.max(0, room!.roundSeconds * 1000 - (match.simulatedAt - match.roundStartedAt)) : 0;
  const botStyle = (side: RoomSide) => {
    const bot = match?.bots[side];
    return bot ? { left: `${bot.x / ONLINE_ARENA.width * 100}%`, top: `${bot.y / ONLINE_ARENA.height * 100}%`, transform: `translate(-50%,-50%) rotate(${bot.angle}rad)` } : undefined;
  };

  if (!room) return <section className="online-lobby loading"><strong>Connecting to room {roomId}</strong><span>{message}</span></section>;
  if (room.status === "waiting" || room.status === "countdown") return (
    <section className="online-lobby">
      <header><div><span className="eyebrow">Room {room.id} · {room.isPrivate ? "Private" : "Public"}</span><h1>{room.status === "countdown" ? `Battle starts in ${countdown}` : "Prepare your bot"}</h1><p>{room.controlMode.toUpperCase()} · {room.roundSeconds}s rounds · {room.actionIntervalMs}ms authoritative tick</p></div><button type="button" onClick={leave}>Leave room</button></header>
      <div className="lobby-versus">
        {[room.host, room.guest].map((player) => player ? <article key={player.id} className={player.id === (ownSide === "host" ? room.host.id : room.guest?.id) ? "you" : ""}><BotVisual name={player.bot.name} skill={player.bot.skill} appearance={player.bot.appearance} /><strong>{player.displayName}</strong><span>{player.bot.name} · {player.ready ? "READY" : "SETTING UP"}</span></article> : <article key="empty" className="empty"><strong>Waiting for player two</strong><span>Share room ID {room.id}</span></article>)}
      </div>
      {room.status === "waiting" && room.guest && <div className="lobby-ready-panel"><label>Battle bot<select value={botId} onChange={(event) => void configure(event.target.value)}>{bots.map((bot) => <option value={bot.id} key={bot.id}>{bot.name} · {bot.skill}</option>)}</select></label><span>Auto-ready in {setupRemaining}s</span><button type="button" onClick={() => void mutate("ready")}>Ready now</button></div>}
      {message && <p className="room-message">{message}</p>}
    </section>
  );

  return (
    <section className="battle-shell online-battle-shell" aria-label="Authoritative online Sumobot battle">
      <div className="online-connection"><span className="live-dot" /> ONLINE · ROOM {room.id} · {room.controlMode.toUpperCase()}</div>
      <div className="replay-score replay-matchup-bar">
        <div className="battle-bot-identity player"><strong>{room.host.displayName}</strong><span>{room.host.bot.name}</span></div>
        <strong className="battle-score player">{match?.scores.host ?? 0}</strong>
        <span className="battle-time-stack"><time className="battle-clock">{Math.ceil(remaining / 1000)}s</time><small>ROUND {match?.round ?? 1}/3</small></span>
        <strong className="battle-score enemy">{match?.scores.guest ?? 0}</strong>
        <div className="battle-bot-identity enemy"><strong>{room.guest?.displayName}</strong><span>{room.guest?.bot.name}</span></div>
      </div>
      <div className="online-arena">
        <canvas ref={canvasRef} width={ONLINE_ARENA.width} height={ONLINE_ARENA.height} />
        {match && <>
          <div className={`arena-bot team-green ${match.simulatedAt < match.bots.host.stunnedUntil ? "stunned" : ""}`} style={botStyle("host")}><BotVisual name={match.bots.host.name} skill={match.bots.host.skill} appearance={match.bots.host.appearance} variant="arena" team="green" /><i className="direction-marker" /></div>
          <div className={`arena-bot team-red ${match.simulatedAt < match.bots.guest.stunnedUntil ? "stunned" : ""}`} style={botStyle("guest")}><BotVisual name={match.bots.guest.name} skill={match.bots.guest.skill} appearance={match.bots.guest.appearance} variant="arena" team="red" /><i className="direction-marker" /></div>
        </>}
      </div>
      {room.status === "completed" ? <div className="online-result"><span>{room.completionReason === "disconnect" ? "Opponent disconnected" : "Match complete"}</span><strong>{room.result?.toUpperCase()}</strong><p>Rewards and leaderboard points were applied online.</p><button type="button" onClick={onExit}>Return to rooms</button></div> : (
        <div className="online-controls">
          {room.controlMode === "buttons" && <div className="action-pad"><button type="button" onPointerDown={(event) => startHeldAction("turnleft", event)} onPointerUp={() => stopHeldAction("turnleft")} onPointerCancel={() => stopHeldAction("turnleft")}>Turn left</button><button type="button" onPointerDown={(event) => startHeldAction("forward", event)} onPointerUp={() => stopHeldAction("forward")} onPointerCancel={() => stopHeldAction("forward")}>Forward</button><button type="button" onPointerDown={(event) => startHeldAction("turnright", event)} onPointerUp={() => stopHeldAction("turnright")} onPointerCancel={() => stopHeldAction("turnright")}>Turn right</button><button type="button" onClick={() => sendAction("dash")}>Dash</button><button type="button" onClick={() => sendAction("skill")}>Skill</button></div>}
          {room.controlMode === "live" && <form className="online-command" onSubmit={submitCommand}><input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="forward(0.3)" aria-label="Live battle command" /><button type="submit">Send command</button></form>}
          {room.controlMode === "script" && <p>Both scripts are executing on the authoritative match server.</p>}
          <button type="button" className="leave-online" onClick={leave}>Forfeit</button>
        </div>
      )}
      {message && <p className="online-error">{message}</p>}
    </section>
  );
}
