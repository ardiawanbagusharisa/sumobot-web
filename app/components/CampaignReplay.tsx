"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CampaignReplayData } from "@/lib/game/campaign-replay";

export function CampaignReplay({ data, onClose }: { data: CampaignReplayData; onClose: () => void }) {
  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const startedRef = useRef(0);
  const timeRef = useRef(0);
  useEffect(() => { timeRef.current = time; }, [time]);
  const duration = data.result.seconds;
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    startedRef.current = performance.now() - timeRef.current * 1000;
    const loop = (now: number) => {
      const next = Math.min(duration, (now - startedRef.current) / 1000);
      setTime(next);
      if (next < duration) frame = requestAnimationFrame(loop); else setPlaying(false);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [duration, playing]);
  const snapshot = useMemo(() => data.frames.reduce((best, item) => Math.abs(item.at - time) < Math.abs(best.at - time) ? item : best, data.frames[0]), [data.frames, time]);
  const events = data.events.filter((event) => event.at <= time).slice(-4);
  const arena = data.mission.arena;
  return <div className="campaign-replay-backdrop"><section className="campaign-replay-dialog" role="dialog" aria-modal="true" aria-label="Campaign replay">
    <header><div><span className="eyebrow">Private campaign replay</span><h2>{data.mission.title}</h2><p>Curriculum v{data.mission.contentVersion} · {data.result.stars}★ · {Math.round(data.result.seconds)}s</p></div><button type="button" onClick={onClose}>Close</button></header>
    <div className="campaign-replay-stage" style={{ aspectRatio: `${arena.width}/${arena.height}` }}>
      <div className="campaign-replay-ring" />
      {data.mission.obstacles.map((item, index) => <i key={index} className="campaign-replay-obstacle" style={{ left: `${item.x / arena.width * 100}%`, top: `${item.y / arena.height * 100}%`, width: `${item.width / arena.width * 100}%`, height: `${item.height / arena.height * 100}%` }} />)}
      {data.mission.checkpoints.map((item, index) => <i key={item.label} className={`campaign-replay-checkpoint ${index < snapshot.checkpoint ? "done" : ""}`} style={{ left: `${item.x / arena.width * 100}%`, top: `${item.y / arena.height * 100}%` }}>{index + 1}</i>)}
      <b className="campaign-replay-bot player" style={{ left: `${snapshot.player.x / arena.width * 100}%`, top: `${snapshot.player.y / arena.height * 100}%`, transform: `translate(-50%,-50%) rotate(${snapshot.player.angle}rad)` }}>P</b>
      {snapshot.enemy && <b className="campaign-replay-bot enemy" style={{ left: `${snapshot.enemy.x / arena.width * 100}%`, top: `${snapshot.enemy.y / arena.height * 100}%`, transform: `translate(-50%,-50%) rotate(${snapshot.enemy.angle}rad)` }}>R</b>}
    </div>
    <div className="campaign-replay-controls"><button type="button" onClick={() => { if (time >= duration) setTime(0); setPlaying((value) => !value); }}>{playing ? "Pause" : time >= duration ? "Replay" : "Play"}</button><input type="range" min="0" max={duration} step=".1" value={time} onChange={(event) => { setPlaying(false); setTime(Number(event.target.value)); }} /><span>{time.toFixed(1)} / {duration.toFixed(1)}s</span></div>
    <div className="campaign-replay-events">{events.map((event, index) => <span key={`${event.at}-${index}`}><time>{event.at.toFixed(1)}s</time>{event.label}</span>)}</div>
  </section></div>;
}
