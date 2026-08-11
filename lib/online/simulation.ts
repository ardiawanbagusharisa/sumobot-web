import { GAME_RULES, clampActionDuration } from "@/lib/game/rules";
import { createScriptRuntime } from "@/lib/game/script-runtime";
import type {
  OnlineActionName,
  OnlineActionRejectionReason,
  OnlineActionResult,
  OnlineBotSelection,
  OnlineBotState,
  OnlineMatchState,
  OnlineReplayFrame,
  OnlineTelemetry,
  RoomSide,
} from "@/lib/online/types";

export const ONLINE_ARENA = { width: 760, height: 510, x: 380, y: 263, radius: 205 } as const;
const STEP_MS = 50;
const MAX_ADVANCE_MS = 15_000;
const REPLAY_INTERVAL_MS = 200;
const TELEMETRY_INTERVAL_MS = 250;
const DISORIENTATION_DAMPING = 7;

function collisionTurn(now: number, salt: number, minimumDegrees: number, maximumDegrees: number) {
  const magnitudeSeed = Math.abs(Math.sin((now + salt) * 12.9898) * 43_758.5453);
  const magnitude = minimumDegrees + (magnitudeSeed - Math.floor(magnitudeSeed)) * (maximumDegrees - minimumDegrees);
  const direction = Math.sin((now + salt) * .731) < 0 ? -1 : 1;
  return magnitude * Math.PI / 180 * direction;
}

function emptyTelemetry(): OnlineTelemetry {
  return {
    durationSeconds: 0,
    actionCounts: { forward: 0, turnleft: 0, turnright: 0, dash: 0, skill: 0 },
    collisions: 0,
    trajectory: Array(64).fill(0),
    centerSeconds: 0,
    edgeSeconds: 0,
    distanceTravelled: 0,
    averageSpeed: 0,
    firstActions: [],
  };
}
function createBot(side: RoomSide, playerId: string, selection: OnlineBotSelection): OnlineBotState {
  const x = side === "host" ? ONLINE_ARENA.x - 115 : ONLINE_ARENA.x + 115;
  const y = ONLINE_ARENA.y;
  return {
    ...selection,
    playerId,
    x,
    y,
    angle: side === "host" ? 0 : Math.PI,
    vx: 0,
    vy: 0,
    radius: 28,
    thrustUntil: 0,
    turnUntil: 0,
    turnDirection: 1,
    dashReadyAt: 0,
    skillReadyAt: 0,
    skillUntil: 0,
    stunnedUntil: 0,
    spinVelocity: 0,
    lastActionAt: 0,
    nextDecisionAt: 0,
    pendingActions: [],
    scriptSnapshot: {},
    scriptError: null,
    telemetry: emptyTelemetry(),
    speedTotal: 0,
    speedSamples: 0,
    previousX: x,
    previousY: y,
  };
}

function resetBot(bot: OnlineBotState, side: RoomSide, now: number) {
  bot.x = side === "host" ? ONLINE_ARENA.x - 115 : ONLINE_ARENA.x + 115;
  bot.y = ONLINE_ARENA.y;
  bot.angle = side === "host" ? 0 : Math.PI;
  bot.vx = 0;
  bot.vy = 0;
  bot.thrustUntil = 0;
  bot.turnUntil = 0;
  bot.dashReadyAt = now;
  bot.skillReadyAt = now;
  bot.skillUntil = 0;
  bot.stunnedUntil = 0;
  bot.spinVelocity = 0;
  bot.lastActionAt = 0;
  bot.nextDecisionAt = now;
  bot.pendingActions = [];
  bot.scriptError = null;
  bot.previousX = bot.x;
  bot.previousY = bot.y;
}

export function createOnlineMatch(
  now: number,
  host: { playerId: string; bot: OnlineBotSelection },
  guest: { playerId: string; bot: OnlineBotSelection },
): OnlineMatchState {
  const state: OnlineMatchState = {
    schemaVersion: 1,
    simulatedAt: now,
    startedAt: now,
    roundStartedAt: now,
    round: 1,
    scores: { host: 0, guest: 0 },
    phase: "live",
    roundBreakUntil: null,
    nextReplayAt: now,
    nextTelemetryAt: now,
    lastCollisionAt: 0,
    bots: {
      host: createBot("host", host.playerId, host.bot),
      guest: createBot("guest", guest.playerId, guest.bot),
    },
    replay: [],
    winnerSide: null,
    reason: null,
  };
  resetBot(state.bots.host, "host", now);
  resetBot(state.bots.guest, "guest", now);
  recordFrame(state, 60);
  return state;
}

function normalizeAngle(angle: number) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

export function performOnlineActionDetailed(
  state: OnlineMatchState,
  side: RoomSide,
  action: OnlineActionName,
  duration: number | undefined,
  actionIntervalMs: number,
  options: { queueIfThrottled?: boolean; sequence?: number | null } = {},
): OnlineActionResult {
  const rejected = (reason: OnlineActionRejectionReason): OnlineActionResult => ({
    name: action, accepted: false, queued: false, reason, sequence: options.sequence ?? null, executeAt: null,
  });
  const accepted = (queued = false, executeAt: number | null = null): OnlineActionResult => ({
    name: action, accepted: true, queued, reason: null, sequence: options.sequence ?? null, executeAt,
  });
  if (state.phase !== "live") return rejected("interval");
  const now = state.simulatedAt;
  const bot = state.bots[side];
  bot.pendingActions ??= [];
  const timed = action === "forward" || action === "turnleft" || action === "turnright";
  if (timed && now - bot.lastActionAt < actionIntervalMs) {
    if (!options.queueIfThrottled) return rejected("interval");
    if (bot.pendingActions.length >= 8) return rejected("queue_full");
    const previousExecuteAt = bot.pendingActions.at(-1)?.executeAt ?? bot.lastActionAt;
    const executeAt = Math.max(now, previousExecuteAt + actionIntervalMs);
    bot.pendingActions.push({ name: action, duration: clampActionDuration(duration ?? 0.2), executeAt });
    return accepted(true, executeAt);
  }
  if (now < bot.stunnedUntil) return rejected("stunned");
  if (bot.skill === "stone" && now < bot.skillUntil) return rejected("stone_locked");
  const safeDuration = clampActionDuration(duration ?? 0.2) * 1000;

  if (action === "forward") bot.thrustUntil = Math.max(bot.thrustUntil, now + safeDuration);
  else if (action === "turnleft" || action === "turnright") {
    bot.turnDirection = action === "turnleft" ? -1 : 1;
    bot.turnUntil = now + safeDuration;
  } else if (action === "dash") {
    if (now < bot.dashReadyAt) return rejected("dash_cooldown");
    const boost = bot.skill === "boost" && now < bot.skillUntil ? GAME_RULES.skills.boostMultiplier : 1;
    bot.vx += Math.cos(bot.angle) * GAME_RULES.dash.force * boost;
    bot.vy += Math.sin(bot.angle) * GAME_RULES.dash.force * boost;
    bot.dashReadyAt = now + GAME_RULES.dash.cooldownSeconds * 1000;
  } else if (action === "skill") {
    if (now < bot.skillReadyAt) return rejected("skill_cooldown");
    bot.skillUntil = now + GAME_RULES.skills.durationSeconds * 1000;
    bot.skillReadyAt = now + GAME_RULES.skills.cooldownSeconds * 1000;
    if (bot.skill === "stone") { bot.vx = 0; bot.vy = 0; }
  }

  if (timed) bot.lastActionAt = now;
  bot.telemetry.actionCounts[action] += 1;
  if (bot.telemetry.firstActions.length < 8) bot.telemetry.firstActions.push(action);
  return accepted();
}

export function performOnlineAction(
  state: OnlineMatchState,
  side: RoomSide,
  action: OnlineActionName,
  duration: number | undefined,
  actionIntervalMs: number,
) {
  return performOnlineActionDetailed(state, side, action, duration, actionIntervalMs).accepted;
}

export function applyOnlineControlState(
  state: OnlineMatchState,
  side: RoomSide,
  input: { forward: boolean; turn: -1 | 0 | 1 },
) {
  if (state.phase !== "live") return;
  const bot = state.bots[side];
  const now = state.simulatedAt;
  if (now < bot.stunnedUntil || (bot.skill === "stone" && now < bot.skillUntil)) return;
  const holdUntil = now + 120;
  if (input.forward) bot.thrustUntil = Math.max(bot.thrustUntil, holdUntil);
  if (input.turn !== 0) {
    bot.turnDirection = input.turn;
    bot.turnUntil = Math.max(bot.turnUntil, holdUntil);
  }
}

type OnlineScriptRuntime = ReturnType<typeof createScriptRuntime>;

function prepareScriptRuntime(bot: OnlineBotState): OnlineScriptRuntime | null {
  try {
    const runtime = createScriptRuntime(bot.scriptSource);
    runtime.restore(bot.scriptSnapshot);
    bot.scriptError = null;
    return runtime;
  } catch (error) {
    bot.scriptError = error instanceof Error ? error.message : "Script runtime error";
    return null;
  }
}

function scriptDecision(state: OnlineMatchState, side: RoomSide, actionIntervalMs: number, runtime: OnlineScriptRuntime | null) {
  const bot = state.bots[side];
  if (state.simulatedAt < bot.nextDecisionAt) return;
  const other = state.bots[side === "host" ? "guest" : "host"];
  try {
    if (!runtime) {
      bot.nextDecisionAt = state.simulatedAt + actionIntervalMs;
      return;
    }
    const action = runtime.decide({ game: {
      elapsed: Math.max(0, (state.simulatedAt - state.startedAt) / 1000),
      arena: { radius: ONLINE_ARENA.radius },
      self: {
        distanceFromCenter: Math.hypot(bot.x - ONLINE_ARENA.x, bot.y - ONLINE_ARENA.y),
        angleToCenter: normalizeAngle(Math.atan2(ONLINE_ARENA.y - bot.y, ONLINE_ARENA.x - bot.x) - bot.angle) * 180 / Math.PI,
        dashReady: state.simulatedAt >= bot.dashReadyAt,
        skillReady: state.simulatedAt >= bot.skillReadyAt,
        skill: bot.skill,
      },
      enemy: {
        distance: Math.hypot(other.x - bot.x, other.y - bot.y) / 80,
        angle: normalizeAngle(Math.atan2(other.y - bot.y, other.x - bot.x) - bot.angle) * 180 / Math.PI,
        stunned: state.simulatedAt < other.stunnedUntil,
        stone: other.skill === "stone" && state.simulatedAt < other.skillUntil,
      },
    } });
    bot.scriptSnapshot = runtime.snapshot();
    bot.scriptError = null;
    if (action) performOnlineAction(state, side, action.name, action.duration, actionIntervalMs);
  } catch (error) {
    bot.scriptError = error instanceof Error ? error.message : "Script runtime error";
  }
  bot.nextDecisionAt = state.simulatedAt + actionIntervalMs;
}

function drainQueuedActions(state: OnlineMatchState, side: RoomSide, actionIntervalMs: number) {
  const bot = state.bots[side];
  bot.pendingActions ??= [];
  const next = bot.pendingActions[0];
  if (!next || state.simulatedAt < next.executeAt) return;
  bot.pendingActions.shift();
  performOnlineActionDetailed(state, side, next.name, next.duration, actionIntervalMs);
}

function updateBot(bot: OnlineBotState, dt: number, now: number) {
  if (bot.skill === "stone" && now < bot.skillUntil) {
    bot.vx = 0; bot.vy = 0; bot.spinVelocity = 0;
    return;
  }
  if (Math.abs(bot.spinVelocity) > .001) {
    bot.angle = normalizeAngle(bot.angle + bot.spinVelocity * dt);
    bot.spinVelocity *= Math.exp(-DISORIENTATION_DAMPING * dt);
  }
  const stunned = now < bot.stunnedUntil;
  if (!stunned && now < bot.turnUntil) bot.angle = normalizeAngle(bot.angle + bot.turnDirection * 2.8 * dt);
  if (!stunned && now < bot.thrustUntil) {
    const boost = bot.skill === "boost" && now < bot.skillUntil ? GAME_RULES.skills.boostMultiplier : 1;
    bot.vx += Math.cos(bot.angle) * 330 * boost * dt;
    bot.vy += Math.sin(bot.angle) * 330 * boost * dt;
  }
  const speed = Math.hypot(bot.vx, bot.vy);
  if (speed > 355) { bot.vx = bot.vx / speed * 355; bot.vy = bot.vy / speed * 355; }
  bot.vx *= Math.pow(.18, dt);
  bot.vy *= Math.pow(.18, dt);
  bot.x += bot.vx * dt;
  bot.y += bot.vy * dt;
}

function resolveCollision(state: OnlineMatchState) {
  const host = state.bots.host;
  const guest = state.bots.guest;
  const dx = guest.x - host.x;
  const dy = guest.y - host.y;
  const distance = Math.max(.001, Math.hypot(dx, dy));
  const minimum = host.radius + guest.radius;
  if (distance >= minimum) return;
  const nx = dx / distance;
  const ny = dy / distance;
  const relative = (guest.vx - host.vx) * nx + (guest.vy - host.vy) * ny;
  const approaching = relative < -5;
  const hostStone = host.skill === "stone" && state.simulatedAt < host.skillUntil;
  const guestStone = guest.skill === "stone" && state.simulatedAt < guest.skillUntil;
  if (approaching && state.simulatedAt - state.lastCollisionAt > 280) {
    host.telemetry.collisions += 1;
    guest.telemetry.collisions += 1;
    state.lastCollisionAt = state.simulatedAt;
    const hostIsAttacker = Math.hypot(host.vx, host.vy) >= Math.hypot(guest.vx, guest.vy);
    if (!hostStone) {
      host.stunnedUntil = Math.max(host.stunnedUntil, state.simulatedAt + 500);
      host.thrustUntil = state.simulatedAt;
      host.turnUntil = state.simulatedAt;
      host.spinVelocity += collisionTurn(state.simulatedAt, 17, hostIsAttacker ? 15 : 30, hostIsAttacker ? 90 : 120) * DISORIENTATION_DAMPING;
    }
    if (!guestStone) {
      guest.stunnedUntil = Math.max(guest.stunnedUntil, state.simulatedAt + 500);
      guest.thrustUntil = state.simulatedAt;
      guest.turnUntil = state.simulatedAt;
      guest.spinVelocity += collisionTurn(state.simulatedAt, 43, hostIsAttacker ? 30 : 15, hostIsAttacker ? 120 : 90) * DISORIENTATION_DAMPING;
    }
  }
  const overlap = minimum - distance;
  if (hostStone) { guest.x += nx * overlap; guest.y += ny * overlap; }
  else if (guestStone) { host.x -= nx * overlap; host.y -= ny * overlap; }
  else {
    host.x -= nx * overlap * .5; host.y -= ny * overlap * .5;
    guest.x += nx * overlap * .5; guest.y += ny * overlap * .5;
  }
  if (!approaching) return;
  const impact = Math.max(120, Math.hypot(host.vx - guest.vx, host.vy - guest.vy));
  if (hostStone) { guest.vx = nx * impact * GAME_RULES.skills.stoneReflectMultiplier; guest.vy = ny * impact * GAME_RULES.skills.stoneReflectMultiplier; }
  else if (guestStone) { host.vx = -nx * impact * GAME_RULES.skills.stoneReflectMultiplier; host.vy = -ny * impact * GAME_RULES.skills.stoneReflectMultiplier; }
  else {
    const impulse = relative * .92;
    host.vx += nx * impulse; host.vy += ny * impulse;
    guest.vx -= nx * impulse; guest.vy -= ny * impulse;
  }
}

function sampleTelemetry(state: OnlineMatchState) {
  for (const side of ["host", "guest"] as const) {
    const bot = state.bots[side];
    const gridX = Math.max(0, Math.min(7, Math.floor(((bot.x - (ONLINE_ARENA.x - ONLINE_ARENA.radius)) / (ONLINE_ARENA.radius * 2)) * 8)));
    const gridY = Math.max(0, Math.min(7, Math.floor(((bot.y - (ONLINE_ARENA.y - ONLINE_ARENA.radius)) / (ONLINE_ARENA.radius * 2)) * 8)));
    bot.telemetry.trajectory[gridY * 8 + gridX] += 1;
    const center = Math.hypot(bot.x - ONLINE_ARENA.x, bot.y - ONLINE_ARENA.y);
    if (center < ONLINE_ARENA.radius * .45) bot.telemetry.centerSeconds += .25;
    if (center > ONLINE_ARENA.radius * .78) bot.telemetry.edgeSeconds += .25;
    bot.telemetry.distanceTravelled += Math.hypot(bot.x - bot.previousX, bot.y - bot.previousY);
    bot.previousX = bot.x; bot.previousY = bot.y;
    bot.speedTotal += Math.hypot(bot.vx, bot.vy); bot.speedSamples += 1;
    bot.telemetry.durationSeconds = (state.simulatedAt - state.startedAt) / 1000;
    bot.telemetry.averageSpeed = bot.speedSamples ? bot.speedTotal / bot.speedSamples : 0;
  }
}

function recordFrame(state: OnlineMatchState, roundSeconds: number) {
  const host = state.bots.host;
  const guest = state.bots.guest;
  const remaining = Math.max(0, roundSeconds * 1000 - (state.simulatedAt - state.roundStartedAt));
  const frame: OnlineReplayFrame = [
    state.simulatedAt - state.startedAt, state.round, remaining, state.scores.host, state.scores.guest,
    host.x, host.y, host.angle, Number(host.skill === "stone" && state.simulatedAt < host.skillUntil), Number(state.simulatedAt < host.stunnedUntil),
    guest.x, guest.y, guest.angle, Number(guest.skill === "stone" && state.simulatedAt < guest.skillUntil), Number(state.simulatedAt < guest.stunnedUntil),
    host.telemetry.actionCounts.forward, host.telemetry.actionCounts.turnleft, host.telemetry.actionCounts.turnright, host.telemetry.actionCounts.dash, host.telemetry.actionCounts.skill, host.telemetry.collisions,
    guest.telemetry.actionCounts.forward, guest.telemetry.actionCounts.turnleft, guest.telemetry.actionCounts.turnright, guest.telemetry.actionCounts.dash, guest.telemetry.actionCounts.skill, guest.telemetry.collisions,
  ];
  state.replay.push(frame.map((value) => Math.round(value * 1000) / 1000) as OnlineReplayFrame);
  if (state.replay.length > 2400) state.replay = state.replay.slice(-2400);
}

function finishRound(state: OnlineMatchState, winner: RoomSide | "draw", reason: "arena_exit" | "draw_timeout") {
  if (winner !== "draw") state.scores[winner] += 1;
  const finished = state.scores.host >= GAME_RULES.winsRequired || state.scores.guest >= GAME_RULES.winsRequired || state.round >= GAME_RULES.roundsPerMatch;
  if (finished) {
    state.phase = "complete";
    state.winnerSide = state.scores.host === state.scores.guest ? "draw" : state.scores.host > state.scores.guest ? "host" : "guest";
    state.reason = reason;
    return;
  }
  state.phase = "round-break";
  state.roundBreakUntil = state.simulatedAt + 1700;
}

export function advanceOnlineMatch(state: OnlineMatchState, targetNow: number, controlMode: string, roundSeconds: number, actionIntervalMs: number) {
  const cappedTarget = Math.min(targetNow, state.simulatedAt + MAX_ADVANCE_MS);
  const scriptRuntimes = controlMode === "script" ? {
    host: prepareScriptRuntime(state.bots.host),
    guest: prepareScriptRuntime(state.bots.guest),
  } : null;
  while (state.simulatedAt < cappedTarget && state.phase !== "complete") {
    const previousSimulatedAt = state.simulatedAt;
    state.simulatedAt = Math.min(cappedTarget, state.simulatedAt + STEP_MS);
    const deltaSeconds = (state.simulatedAt - previousSimulatedAt) / 1000;
    if (state.phase === "round-break") {
      if (state.roundBreakUntil && state.simulatedAt >= state.roundBreakUntil) {
        state.round += 1;
        state.roundStartedAt = state.simulatedAt;
        state.phase = "live";
        state.roundBreakUntil = null;
        resetBot(state.bots.host, "host", state.simulatedAt);
        resetBot(state.bots.guest, "guest", state.simulatedAt);
      }
      continue;
    }
    drainQueuedActions(state, "host", actionIntervalMs);
    drainQueuedActions(state, "guest", actionIntervalMs);
    if (controlMode === "script") {
      scriptDecision(state, "host", actionIntervalMs, scriptRuntimes?.host ?? null);
      scriptDecision(state, "guest", actionIntervalMs, scriptRuntimes?.guest ?? null);
    }
    updateBot(state.bots.host, deltaSeconds, state.simulatedAt);
    updateBot(state.bots.guest, deltaSeconds, state.simulatedAt);
    resolveCollision(state);
    if (state.simulatedAt >= state.nextTelemetryAt) {
      sampleTelemetry(state);
      state.nextTelemetryAt = state.simulatedAt + TELEMETRY_INTERVAL_MS;
    }
    if (state.simulatedAt >= state.nextReplayAt) {
      recordFrame(state, roundSeconds);
      state.nextReplayAt = state.simulatedAt + REPLAY_INTERVAL_MS;
    }
    const hostOut = Math.hypot(state.bots.host.x - ONLINE_ARENA.x, state.bots.host.y - ONLINE_ARENA.y) > ONLINE_ARENA.radius + state.bots.host.radius;
    const guestOut = Math.hypot(state.bots.guest.x - ONLINE_ARENA.x, state.bots.guest.y - ONLINE_ARENA.y) > ONLINE_ARENA.radius + state.bots.guest.radius;
    if (hostOut && guestOut) finishRound(state, "draw", "arena_exit");
    else if (hostOut) finishRound(state, "guest", "arena_exit");
    else if (guestOut) finishRound(state, "host", "arena_exit");
    else if (state.simulatedAt - state.roundStartedAt >= roundSeconds * 1000) finishRound(state, "draw", "draw_timeout");
  }
  return state;
}

export function forfeitOnlineMatch(state: OnlineMatchState, winnerSide: RoomSide) {
  state.phase = "complete";
  state.winnerSide = winnerSide;
  state.reason = "disconnect";
  return state;
}
