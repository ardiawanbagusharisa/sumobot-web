"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { MatchResult } from "@/lib/game/rules";
import { BotVisual } from "./BotVisual";
import { BotDiagnosticsPanels, type BotDiagnosticSnapshot } from "./BotDiagnosticsPanels";
import type { BattleReplayData, ReplayFrame } from "./BattleArena";

interface BattleReplayProps {
  data: BattleReplayData;
  result: MatchResult;
  playedAt: string;
  onClose?: () => void;
  embedded?: boolean;
}

function formatClock(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function interpolateAngle(from: number, to: number, amount: number) {
  let difference = to - from;
  while (difference > Math.PI) difference -= Math.PI * 2;
  while (difference < -Math.PI) difference += Math.PI * 2;
  return from + difference * amount;
}

function frameAt(frames: ReplayFrame[], elapsedMs: number) {
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (frames[middle][0] <= elapsedMs) low = middle;
    else high = middle - 1;
  }
  const current = frames[low];
  const next = frames[Math.min(frames.length - 1, low + 1)];
  const canInterpolate = current[1] === next[1] && next[0] > current[0];
  const amount = canInterpolate ? Math.min(1, Math.max(0, (elapsedMs - current[0]) / (next[0] - current[0]))) : 0;
  return {
    source: current,
    player: { x: current[5] + (next[5] - current[5]) * amount, y: current[6] + (next[6] - current[6]) * amount, angle: interpolateAngle(current[7], next[7], amount), stone: Boolean(current[8]), stunned: Boolean(current[9]) },
    enemy: { x: current[10] + (next[10] - current[10]) * amount, y: current[11] + (next[11] - current[11]) * amount, angle: interpolateAngle(current[12], next[12], amount), stone: Boolean(current[13]), stunned: Boolean(current[14]) },
  };
}

function buildDiagnostics(data: BattleReplayData, frames: ReplayFrame[], source: ReplayFrame, elapsedMs: number, side: "player" | "enemy"): BotDiagnosticSnapshot {
  const positionIndex = side === "player" ? 5 : 10;
  const stunnedIndex = side === "player" ? 9 : 14;
  const actionIndex = side === "player" ? 15 : 21;
  const actionCounts = {
    forward: source[actionIndex] ?? 0,
    turnleft: source[actionIndex + 1] ?? 0,
    turnright: source[actionIndex + 2] ?? 0,
    dash: source[actionIndex + 3] ?? 0,
    skill: source[actionIndex + 4] ?? 0,
  };
  const heatmap = Array(64).fill(0) as number[];
  let centerSamples = 0;
  let collisionTransitions = 0;
  let wasStunned = false;
  frames.forEach((item) => {
    const x = item[positionIndex] ?? data.arena.x;
    const y = item[positionIndex + 1] ?? data.arena.y;
    const gridX = Math.max(0, Math.min(7, Math.floor(((x - (data.arena.x - data.arena.radius)) / (data.arena.radius * 2)) * 8)));
    const gridY = Math.max(0, Math.min(7, Math.floor(((y - (data.arena.y - data.arena.radius)) / (data.arena.radius * 2)) * 8)));
    heatmap[gridY * 8 + gridX] += 1;
    if (Math.hypot(x - data.arena.x, y - data.arena.y) < data.arena.radius * .45) centerSamples += 1;
    const stunned = Boolean(item[stunnedIndex]);
    if (stunned && !wasStunned) collisionTransitions += 1;
    wasStunned = stunned;
  });
  return {
    name: side === "player" ? data.player.name : data.enemy.name,
    elapsedSeconds: elapsedMs / 1000,
    collisions: (side === "player" ? source[20] : source[26]) ?? collisionTransitions,
    centerShare: frames.length ? centerSamples / frames.length : 0,
    actionCounts,
    heatmap,
  };
}

export function BattleReplay({ data, result, playedAt, onClose, embedded = false }: BattleReplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playbackStartedAtRef = useRef(0);
  const playbackOffsetRef = useRef(0);
  const elapsedRef = useRef(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [elapsedMs, setElapsedMs] = useState(0);
  const durationMs = data.frames.at(-1)?.[0] ?? 0;
  const frame = useMemo(() => frameAt(data.frames, elapsedMs), [data.frames, elapsedMs]);
  const diagnostics = useMemo(() => {
    const sampledFrames = data.frames.filter((item) => item[0] <= elapsedMs);
    const source = sampledFrames.at(-1) ?? data.frames[0];
    return {
      left: buildDiagnostics(data, sampledFrames, source, elapsedMs, "player"),
      right: buildDiagnostics(data, sampledFrames, source, elapsedMs, "enemy"),
    };
  }, [data, elapsedMs]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const { width, height, x: arenaX, y: arenaY, radius } = data.arena;
    context.fillStyle = "#0b1020";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "rgba(184,255,61,.08)";
    context.lineWidth = 1;
    for (let x = 0; x < width; x += 32) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke(); }
    for (let y = 0; y < height; y += 32) { context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke(); }
    context.beginPath(); context.arc(arenaX, arenaY, radius + 8, 0, Math.PI * 2); context.fillStyle = "#f2f0e8"; context.fill();
    context.beginPath(); context.arc(arenaX, arenaY, radius, 0, Math.PI * 2); context.fillStyle = "#20283b"; context.fill(); context.strokeStyle = "#b8ff3d"; context.lineWidth = 4; context.stroke();
    context.beginPath(); context.arc(arenaX, arenaY, 42, 0, Math.PI * 2); context.strokeStyle = "rgba(245,243,234,.18)"; context.lineWidth = 2; context.stroke();
    context.beginPath(); context.moveTo(arenaX, arenaY - radius); context.lineTo(arenaX, arenaY + radius); context.stroke();

    const trailWindow = 720;
    const recentFrames = data.frames.filter((item) => item[0] <= elapsedMs && item[0] >= elapsedMs - trailWindow);
    const drawTrail = (item: ReplayFrame, previous: ReplayFrame | undefined, side: "player" | "enemy") => {
      const positionIndex = side === "player" ? 5 : 10;
      const angleIndex = side === "player" ? 7 : 12;
      const x = item[positionIndex] ?? 0;
      const y = item[positionIndex + 1] ?? 0;
      const previousX = previous?.[positionIndex] ?? x;
      const previousY = previous?.[positionIndex + 1] ?? y;
      if (!previous || previous[1] !== item[1] || Math.hypot(x - previousX, y - previousY) < .7) return;
      const age = elapsedMs - item[0];
      const alpha = Math.max(0, 1 - age / trailWindow);
      const angle = item[angleIndex];
      const offsetX = -Math.sin(angle) * 18;
      const offsetY = Math.cos(angle) * 18;
      context.globalAlpha = alpha * .46;
      context.fillStyle = side === "player" ? "#b8ff3d" : "#ff554f";
      [1, -1].forEach((direction) => {
        context.beginPath();
        context.arc(x + offsetX * direction, y + offsetY * direction, 2.3, 0, Math.PI * 2);
        context.fill();
      });
    };
    recentFrames.forEach((item) => {
      const frameIndex = data.frames.indexOf(item);
      const previous = frameIndex > 0 ? data.frames[frameIndex - 1] : undefined;
      drawTrail(item, previous, "player");
      drawTrail(item, previous, "enemy");
    });

    let previousCollisionCount = 0;
    let previouslyStunned = false;
    data.frames.forEach((item) => {
      if (item[0] > elapsedMs || item[0] < elapsedMs - 560) {
        previousCollisionCount = item[20] ?? previousCollisionCount;
        previouslyStunned = Boolean(item[9] || item[14]);
        return;
      }
      const collisionCount = item[20] ?? previousCollisionCount;
      const stunned = Boolean(item[9] || item[14]);
      const collisionStarted = collisionCount > previousCollisionCount || (stunned && !previouslyStunned);
      if (collisionStarted) {
        const progress = Math.min(1, Math.max(0, (elapsedMs - item[0]) / 560));
        const contactX = (item[5] + item[10]) / 2;
        const contactY = (item[6] + item[11]) / 2;
        context.globalAlpha = (1 - progress) * .7;
        context.strokeStyle = "#f5f3ea";
        context.lineWidth = 2;
        context.beginPath(); context.arc(contactX, contactY, 8 + progress * 34, 0, Math.PI * 2); context.stroke();
        for (let particle = 0; particle < 12; particle += 1) {
          const particleAngle = particle / 12 * Math.PI * 2 + item[0] * .0017;
          const travel = progress * (34 + (particle % 4) * 9);
          context.globalAlpha = (1 - progress) * .9;
          context.fillStyle = particle % 3 === 0 ? "#f5f3ea" : particle % 2 ? "#ff554f" : "#b8ff3d";
          context.beginPath(); context.arc(contactX + Math.cos(particleAngle) * travel, contactY + Math.sin(particleAngle) * travel, 1.4 + (particle % 3) * .55, 0, Math.PI * 2); context.fill();
        }
      }
      previousCollisionCount = collisionCount;
      previouslyStunned = stunned;
    });
    context.globalAlpha = 1;
  }, [data, elapsedMs]);

  useEffect(() => {
    if (!playing) return;
    playbackStartedAtRef.current = performance.now();
    playbackOffsetRef.current = elapsedRef.current;
    let animationFrame = 0;
    const tick = (now: number) => {
      const next = Math.min(durationMs, playbackOffsetRef.current + (now - playbackStartedAtRef.current) * speed);
      elapsedRef.current = next;
      setElapsedMs(next);
      if (next >= durationMs) setPlaying(false);
      else animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [durationMs, playing, speed]);

  useEffect(() => {
    if (!onClose) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const seek = (value: number) => { elapsedRef.current = value; setElapsedMs(value); playbackOffsetRef.current = value; playbackStartedAtRef.current = performance.now(); };
  const togglePlaying = () => {
    if (elapsedMs >= durationMs) seek(0);
    setPlaying((value) => !value || elapsedMs >= durationMs);
  };
  const botStyle = (x: number, y: number, angle: number) => ({ left: `${x / data.arena.width * 100}%`, top: `${y / data.arena.height * 100}%`, transform: `translate(-50%,-50%) rotate(${angle}rad)` }) as CSSProperties;

  return (
    <div className={embedded ? "home-replay-embed" : "replay-backdrop"} role={embedded ? "region" : "dialog"} aria-modal={embedded ? undefined : true} aria-label="Battle replay">
      <section className="replay-card">
        <header><div><span className="eyebrow">Recorded battle replay</span><h2>{data.player.name} vs. {data.enemy.name}</h2><p>{playedAt} · <strong className={result}>{result.toUpperCase()}</strong></p></div>{!embedded && <button type="button" onClick={onClose} aria-label="Close replay">Close ×</button>}</header>
        <div className="replay-score"><strong>{frame.source[3]}</strong><span>ROUND {frame.source[1]}/3 · {formatClock(frame.source[2])}</span><strong>{frame.source[4]}</strong></div>
        <div className="replay-arena">
          <canvas ref={canvasRef} width={data.arena.width} height={data.arena.height} />
          <div className={`arena-bot team-green ${frame.player.stunned ? "stunned" : ""} ${frame.player.stone ? "stone-active" : ""}`} style={botStyle(frame.player.x, frame.player.y, frame.player.angle)}><BotVisual name={data.player.name} skill={data.player.skill} appearance={data.player.appearance} variant="arena" team="green" /><i className="direction-marker" /></div>
          <div className={`arena-bot team-red ${frame.enemy.stunned ? "stunned" : ""} ${frame.enemy.stone ? "stone-active" : ""}`} style={botStyle(frame.enemy.x, frame.enemy.y, frame.enemy.angle)}><BotVisual name={data.enemy.name} skill={data.enemy.skill} appearance={data.enemy.appearance} variant="arena" team="red" /><i className="direction-marker" /></div>
          <BotDiagnosticsPanels left={diagnostics.left} right={diagnostics.right} />
        </div>
        <footer className="replay-controls"><button type="button" onClick={togglePlaying}>{playing ? "Pause" : elapsedMs >= durationMs ? "Replay" : "Play"}</button><input type="range" min="0" max={Math.max(1, durationMs)} value={elapsedMs} onChange={(event) => seek(Number(event.target.value))} aria-label="Replay position" /><time>{formatClock(elapsedMs)} / {formatClock(durationMs)}</time><div>{[0.5, 1, 2].map((value) => <button type="button" key={value} className={speed === value ? "active" : ""} onClick={() => setSpeed(value)}>{value}×</button>)}</div></footer>
      </section>
    </div>
  );
}
