"use client";

import type { CSSProperties } from "react";
import type { SkillType } from "@/lib/game/rules";

export interface BotAppearance {
  wheel: string;
  body: string;
  face: string;
  accessory: string;
  faceId?: string;
  accessoryId?: string;
}

interface BotVisualProps {
  name: string;
  skill: SkillType;
  appearance: BotAppearance;
  variant?: "display" | "compact" | "arena";
  team?: "green" | "red";
}

export function BotVisual({ name, skill, appearance, variant = "display", team = "green" }: BotVisualProps) {
  const style = {
    "--bot-wheel": appearance.wheel,
    "--bot-body": appearance.body,
    "--bot-eye": appearance.face,
    "--bot-accessory": appearance.accessory,
    "--team-color": team === "green" ? "#b8ff3d" : "#ff554f",
  } as CSSProperties;

  return (
    <div className={`bot-preview ${variant} team-${team} face-${appearance.faceId ?? "standard"} accessory-${appearance.accessoryId ?? "standard"}`} style={style} aria-label={`${name} bot with ${skill} skill`}>
      <div className="bot-shadow" />
      <div className="bot-accessory"><i /><span /></div>
      <div className="bot-body">
        <div className="bot-face"><i /><i /></div>
        <div className="bot-badge">{name.slice(0, 1).toUpperCase()}</div>
      </div>
      <div className="bot-wheel left" />
      <div className="bot-wheel right" />
      {variant === "display" && <span className={`skill-chip ${skill}`}>{skill}</span>}
    </div>
  );
}
