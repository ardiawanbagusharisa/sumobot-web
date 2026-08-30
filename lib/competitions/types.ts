import type { ControlMode, MatchResult } from "@/lib/game/rules";

export type CompetitionStatus = "draft" | "registration" | "active" | "closed" | "cancelled" | "archived";
export type PairingStatus = "pending" | "assigned" | "live" | "completed";
export type CompetitorEventStatus = "self" | "standby" | "offline" | "invited" | "invites-you" | "in-game" | "won" | "lost" | "draw";
export interface CompetitionPrize { gold: number; xp: number }
export interface CompetitionRewards {
  first: CompetitionPrize;
  second: CompetitionPrize;
  third: CompetitionPrize;
  participation: CompetitionPrize;
}
export interface CompetitionRuleSet {
  controlModes: ControlMode[];
  roundSeconds: 30 | 60 | 120;
  actionIntervalMs: number;
  arenaRadius: number;
  matchLimit: number;
  scoring: { win: number; draw: number; loss: number };
  tieBreakers: Array<"wins" | "fewestLosses" | "matches">;
  rewards: CompetitionRewards;
}
export interface Competition {
  id: string; title: string; description: string; status: CompetitionStatus;
  isPrivate: boolean; maxPlayers: number; competitorCount: number;
  registrationOpensAt: string; startsAt: string; endsAt: string;
  rulesVersion: number; rules: CompetitionRuleSet; enrolled: boolean;
  queued: boolean; queuedMode?: ControlMode; createdAt: string; updatedAt: string;
}
export interface CompetitionStanding {
  playerId: string; displayName: string; points: number; wins: number; draws: number; losses: number; matches: number; rank: number;
}
export interface CompetitionCompetitor {
  playerId: string; displayName: string; enrolledAt: string; matches: number; waiting: boolean; status: CompetitorEventStatus; canChallenge: boolean;
}
export interface CompetitionAssignment {
  pairingId: string; opponentId: string; opponentName: string; status: PairingStatus;
  acceptanceExpiresAt: number | null; acceptedByMe: boolean; acceptedByOpponent: boolean; roomId: string | null;
}
export interface CompetitionRewardReceipt {
  playerId: string; displayName: string; placement: number | null; gold: number; xp: number;
}
export interface CompetitionReplaySummary {
  id: string; playerAName: string; playerBName: string; result: MatchResult; playedAt: string; available: boolean;
}
export interface CompetitionDetail {
  competitors: CompetitionCompetitor[];
  standings: CompetitionStanding[];
  assignment: CompetitionAssignment | null;
  waiting: boolean;
  completedPairings: number;
  totalPairings: number;
  rewards: CompetitionRewardReceipt[];
  replays: CompetitionReplaySummary[];
}
export const DEFAULT_COMPETITION_RULES: CompetitionRuleSet = {
  controlModes: ["script"], roundSeconds: 60, actionIntervalMs: 250, arenaRadius: 188, matchLimit: 7,
  scoring: { win: 3, draw: 1, loss: 0 }, tieBreakers: ["wins", "fewestLosses", "matches"],
  rewards: {
    first: { gold: 500, xp: 1000 }, second: { gold: 300, xp: 650 }, third: { gold: 150, xp: 400 }, participation: { gold: 50, xp: 150 },
  },
};
