"use client";

import type { CSSProperties, ReactNode, RefObject } from "react";
import type { SkillType } from "@/lib/game/rules";
import { BotVisual, type BotAppearance } from "./BotVisual";

export interface BattleCompetitor {
  name: string;
  botName: string;
  detail: string;
  skill: SkillType;
  appearance: BotAppearance;
  score: number;
}

interface BattleViewportProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  leftVisualRef: RefObject<HTMLDivElement | null>;
  rightVisualRef: RefObject<HTMLDivElement | null>;
  left: BattleCompetitor;
  right: BattleCompetitor;
  round: number;
  timeSeconds: number;
  message?: string;
  leftStyle?: CSSProperties;
  rightStyle?: CSSProperties;
  leftClassName?: string;
  rightClassName?: string;
  onLeave: () => void;
  leaveLabel?: string;
  children?: ReactNode;
}

export function formatBattleTime(seconds: number) {
  const value = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

export function BattleViewport({ canvasRef, leftVisualRef, rightVisualRef, left, right, round, timeSeconds, message, leftStyle, rightStyle, leftClassName = "", rightClassName = "", onLeave, leaveLabel = "Leave arena", children }: BattleViewportProps) {
  return <>
    <div className="battle-topbar">
      <div className="battle-bot-identity player"><strong>{left.name}</strong><span><b>{left.skill.toUpperCase()}</b> {left.detail}</span></div>
      <strong className="battle-score player" aria-label={`${left.name} score ${left.score}`}>{left.score}</strong>
      <span className="battle-time-stack"><time className={`battle-clock ${timeSeconds <= 15 ? "danger" : ""}`}>{formatBattleTime(timeSeconds)}</time><small>ROUND {round}/3</small></span>
      <strong className="battle-score enemy" aria-label={`${right.name} score ${right.score}`}>{right.score}</strong>
      <div className="battle-bot-identity enemy"><strong>{right.name}</strong><span><b>{right.skill.toUpperCase()}</b> {right.detail}</span></div>
    </div>
    <div className="arena-frame">
      <canvas ref={canvasRef} width={760} height={510} aria-label="Circular Sumobot arena" />
      <button className="arena-leave-button" type="button" onClick={onLeave}>{leaveLabel}</button>
      <div ref={leftVisualRef} className={`arena-bot team-green ${leftClassName}`} style={leftStyle}><BotVisual name={left.botName} skill={left.skill} appearance={left.appearance} variant="arena" team="green" /><i className="direction-marker" /></div>
      <div ref={rightVisualRef} className={`arena-bot team-red ${rightClassName}`} style={rightStyle}><BotVisual name={right.botName} skill={right.skill} appearance={right.appearance} variant="arena" team="red" /><i className="direction-marker" /></div>
      {message && <div className="battle-message">{message}</div>}
      {children}
    </div>
  </>;
}
