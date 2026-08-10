import type { ControlMode } from "../game/rules";
import type { OnlineActionName, OnlineActionResult, OnlineMatchState, OnlineRoomPlayer, RoomSide } from "./types";

export const REALTIME_PROTOCOL_VERSION = 1;
export const REALTIME_PHYSICS_HZ = 30;
export const REALTIME_SNAPSHOT_HZ = 20;
export const REALTIME_DISCONNECT_GRACE_MS = 6_000;

export interface OnlineRoomBootstrap {
  protocolVersion: 1;
  roomId: string;
  controlMode: ControlMode;
  roundSeconds: number;
  actionIntervalMs: number;
  host: OnlineRoomPlayer;
  guest: OnlineRoomPlayer;
  match: OnlineMatchState;
}

export interface RealtimeTicketClaims {
  roomId: string;
  playerId: string;
  side: RoomSide;
  bootstrapHash: string;
  expiresAt: number;
}

export interface RealtimeControlState {
  sequence: number;
  forward: boolean;
  turn: -1 | 0 | 1;
}

export type RealtimeClientMessage =
  | { type: "authenticate"; bootstrap: OnlineRoomBootstrap }
  | { type: "input"; input: RealtimeControlState }
  | { type: "action"; sequence: number; name: OnlineActionName; duration?: number }
  | { type: "ping"; sentAt: number }
  | { type: "leave" };

export interface RealtimeCompletionProof {
  completedAt: number;
  stateHash: string;
  signature: string;
}

export type RealtimeServerMessage =
  | { type: "ready"; side: RoomSide; serverTime: number }
  | { type: "snapshot"; serverTick: number; acknowledgedSequence: number; state: OnlineMatchState }
  | { type: "action-result"; result: OnlineActionResult }
  | { type: "pong"; sentAt: number; serverTime: number }
  | { type: "complete"; state: OnlineMatchState; proof: RealtimeCompletionProof }
  | { type: "error"; message: string };

export interface RealtimeConnectionTicket {
  websocketUrl: string;
  token: string;
  bootstrap: OnlineRoomBootstrap;
}
