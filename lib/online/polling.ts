import type { RoomStatus } from "@/lib/online/types";

export type OnlineTransportState = "discovering" | "connecting" | "realtime" | "reconnecting" | "compatibility";

export const ROOM_LIST_POLL_INTERVAL_MS = 5_000;
export const ROOM_LOBBY_POLL_INTERVAL_MS = 750;
export const REALTIME_CONNECTING_POLL_INTERVAL_MS = 750;
export const REALTIME_HEALTH_CHECK_INTERVAL_MS = 15_000;
export const COMPATIBILITY_POLL_INTERVAL_MS = 120;
export const ROOM_HEARTBEAT_INTERVAL_MS = 3_000;

export function roomListPollDelay(visible: boolean) {
  return visible ? ROOM_LIST_POLL_INTERVAL_MS : null;
}

export function roomPollDelay(status: RoomStatus | null, transport: OnlineTransportState, visible: boolean) {
  if (status === "completed") return null;
  if (status !== "live") return visible ? ROOM_LOBBY_POLL_INTERVAL_MS : null;
  if (transport === "compatibility") return COMPATIBILITY_POLL_INTERVAL_MS;
  if (transport === "realtime") return REALTIME_HEALTH_CHECK_INTERVAL_MS;
  return REALTIME_CONNECTING_POLL_INTERVAL_MS;
}

interface RoomSynchronizationState {
  status: RoomStatus;
  lastSeenAt: number | null;
  guestPresent: boolean;
  hostReady: boolean;
  guestReady: boolean;
  hostSetupDeadline: number | null;
  guestSetupDeadline: number | null;
  countdownStartedAt: number | null;
  realtimeStartedAt: number | null;
  hasMatchState: boolean;
}

export function roomSynchronizationNeedsPersistence(state: RoomSynchronizationState, nowMs: number) {
  const heartbeatDue = state.lastSeenAt == null || nowMs - state.lastSeenAt >= ROOM_HEARTBEAT_INTERVAL_MS;
  if (heartbeatDue) return true;

  if (state.status === "waiting" && state.guestPresent) {
    const hostDeadlineDue = !state.hostReady && state.hostSetupDeadline != null && nowMs >= state.hostSetupDeadline;
    const guestDeadlineDue = !state.guestReady && state.guestSetupDeadline != null && nowMs >= state.guestSetupDeadline;
    if (hostDeadlineDue || guestDeadlineDue || (state.hostReady && state.guestReady)) return true;
  }

  if (state.status === "countdown" && state.guestPresent && state.countdownStartedAt != null && nowMs >= state.countdownStartedAt + 5_000) {
    return true;
  }

  // Compatibility gameplay advances from these HTTP synchronization calls.
  // Realtime gameplay advances in the WebSocket worker instead.
  return state.status === "live" && state.hasMatchState && state.realtimeStartedAt == null;
}
