import type { ControlMode } from "@/lib/game/rules";

export type CompetitionStatus = "draft" | "registration" | "active" | "closed" | "cancelled" | "archived";
export interface CompetitionRuleSet {
  controlModes: ControlMode[];
  roundSeconds: 30 | 60 | 120;
  actionIntervalMs: number;
  arenaRadius: number;
  matchLimit: number;
  scoring: { win: number; draw: number; loss: number };
  tieBreakers: Array<"wins" | "fewestLosses" | "matches">;
  rewards: { first: number; second: number; third: number };
}
export interface Competition {
  id: string; title: string; description: string; status: CompetitionStatus;
  registrationOpensAt: string; startsAt: string; endsAt: string;
  rulesVersion: number; rules: CompetitionRuleSet; enrolled: boolean; createdAt: string; updatedAt: string;
}
export interface CompetitionStanding {
  playerId: string; displayName: string; points: number; wins: number; draws: number; losses: number; matches: number; rank: number;
}
export const DEFAULT_COMPETITION_RULES: CompetitionRuleSet = {
  controlModes: ["live", "script"], roundSeconds: 60, actionIntervalMs: 250, arenaRadius: 188, matchLimit: 20,
  scoring: { win: 3, draw: 1, loss: 0 }, tieBreakers: ["wins", "fewestLosses", "matches"], rewards: { first: 500, second: 300, third: 150 },
};
