import type { ControlMode, MatchResult, SkillType } from "@/lib/game/rules";
import type { ScriptRuntimeSnapshot } from "@/lib/game/script-runtime";

export type RoomStatus = "waiting" | "countdown" | "live" | "completed";
export type RoomSide = "host" | "guest";
export type OnlineActionName = "forward" | "turnleft" | "turnright" | "dash" | "skill";

export interface OnlineBotSelection {
  id: string;
  name: string;
  skill: SkillType;
  scriptSource: string;
  appearance: {
    wheel: string;
    body: string;
    face: string;
    accessory: string;
    faceId?: string;
    accessoryId?: string;
  };
}
export interface OnlineRoomPlayer {
  id: string;
  handle: string;
  displayName: string;
  ready: boolean;
  setupDeadline: number | null;
  bot: OnlineBotSelection;
}

export interface OnlineTelemetry {
  durationSeconds: number;
  actionCounts: Record<OnlineActionName, number>;
  collisions: number;
  trajectory: number[];
  centerSeconds: number;
  edgeSeconds: number;
  distanceTravelled: number;
  averageSpeed: number;
  firstActions: string[];
}

export interface OnlineBotState extends OnlineBotSelection {
  playerId: string;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  radius: number;
  thrustUntil: number;
  turnUntil: number;
  turnDirection: -1 | 1;
  dashReadyAt: number;
  skillReadyAt: number;
  skillUntil: number;
  stunnedUntil: number;
  spinVelocity: number;
  lastActionAt: number;
  nextDecisionAt: number;
  scriptSnapshot: ScriptRuntimeSnapshot;
  telemetry: OnlineTelemetry;
  speedTotal: number;
  speedSamples: number;
  previousX: number;
  previousY: number;
}

export type OnlineReplayFrame = [
  number, number, number, number, number,
  number, number, number, number, number,
  number, number, number, number, number,
  number, number, number, number, number, number,
  number, number, number, number, number, number,
];

export interface OnlineMatchState {
  schemaVersion: 1;
  simulatedAt: number;
  startedAt: number;
  roundStartedAt: number;
  round: number;
  scores: { host: number; guest: number };
  phase: "live" | "round-break" | "complete";
  roundBreakUntil: number | null;
  nextReplayAt: number;
  nextTelemetryAt: number;
  lastCollisionAt: number;
  bots: { host: OnlineBotState; guest: OnlineBotState };
  replay: OnlineReplayFrame[];
  winnerSide: RoomSide | "draw" | null;
  reason: "arena_exit" | "draw_timeout" | "disconnect" | null;
}

export interface OnlineRoomSummary {
  id: string;
  isPrivate: boolean;
  status: RoomStatus;
  controlMode: ControlMode;
  roundSeconds: number;
  actionIntervalMs: number;
  hostName: string;
  guestName: string | null;
  playerCount: 1 | 2;
  createdAt: string;
}

export interface OnlineRoomView extends OnlineRoomSummary {
  currentSide: RoomSide;
  host: OnlineRoomPlayer;
  guest: OnlineRoomPlayer | null;
  countdownEndsAt: number | null;
  match: OnlineMatchState | null;
  winnerPlayerId: string | null;
  result: MatchResult | null;
  completionReason: "arena_exit" | "draw_timeout" | "disconnect" | null;
}
