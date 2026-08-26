import type { CampaignLevel, CampaignObstacle, CampaignPoint } from "./campaign";
import type { SkillType } from "./rules";

export interface CampaignReplayFrame {
  at: number;
  remaining: number;
  checkpoint: number;
  player: { x: number; y: number; angle: number; skillActive: boolean };
  enemy?: { x: number; y: number; angle: number; skillActive: boolean };
}

export interface CampaignReplayEvent {
  at: number;
  type: "command" | "checkpoint" | "collision" | "hint" | "script-submit" | "runtime-error" | "complete";
  label: string;
}

export interface CampaignReplayData {
  schemaVersion: 1;
  kind: "campaign";
  recordedAt: string;
  mission: {
    levelId: string;
    contentVersion: number;
    title: string;
    mode: CampaignLevel["mode"];
    kind: CampaignLevel["kind"];
    durationSeconds: number;
    playerTickMs: number;
    enemyTickMs?: number;
    enemy?: CampaignLevel["enemy"];
    arena: { width: number; height: number; x: number; y: number; radius: number };
    checkpoints: CampaignPoint[];
    obstacles: CampaignObstacle[];
  };
  player: { name: string; skill: SkillType; appearance: Record<string, unknown> };
  frames: CampaignReplayFrame[];
  events: CampaignReplayEvent[];
  result: { completed: boolean; stars: number; seconds: number; collisions: number; actions: number };
}

export interface ReplayEnvelope<TKind extends "battle" | "campaign", TPayload> {
  schemaVersion: 1;
  kind: TKind;
  id: string;
  createdAt: string;
  payload: TPayload;
}

export function campaignMissionSnapshot(level: CampaignLevel) {
  return {
    levelId: level.id,
    contentVersion: level.contentVersion,
    title: level.title,
    mode: level.mode,
    kind: level.kind,
    durationSeconds: level.durationSeconds,
    playerTickMs: level.playerTickMs,
    enemyTickMs: level.enemyTickMs,
    enemy: level.enemy,
    arena: { width: 760, height: 440, x: 380, y: 220, radius: 188 },
    checkpoints: level.checkpoints.map((point) => ({ ...point })),
    obstacles: level.obstacles.map((obstacle) => ({ ...obstacle })),
  };
}
