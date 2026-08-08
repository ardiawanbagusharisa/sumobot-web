export type ControlMode = "buttons" | "live" | "script";
export type SkillType = "boost" | "stone";
export type MatchResult = "win" | "draw" | "loss";

export const GAME_RULES = {
  roundsPerMatch: 3,
  winsRequired: 2,
  roundSeconds: {
    buttons: 60,
    live: 120,
    script: 60,
  } satisfies Record<ControlMode, number>,
  actionDuration: {
    minimum: 0.1,
    maximum: 3,
    step: 0.1,
  },
  dash: {
    cooldownSeconds: 1,
    force: 520,
  },
  skills: {
    durationSeconds: 3,
    cooldownSeconds: 10,
    boostMultiplier: 1.5,
    stoneReflectMultiplier: 2,
  },
  prototypeOpponent: {
    decisionIntervalMs: 450,
  },
} as const;

export const RANK_POINTS: Record<MatchResult, number> = {
  win: 1,
  draw: 0.5,
  loss: 0.25,
};

export const MATCH_REWARDS: Record<MatchResult, { xp: number; gold: number }> = {
  win: { xp: 100, gold: 25 },
  draw: { xp: 75, gold: 15 },
  loss: { xp: 50, gold: 10 },
};

export function clampActionDuration(value: number) {
  const { minimum, maximum, step } = GAME_RULES.actionDuration;
  const clamped = Math.min(maximum, Math.max(minimum, value));
  return Math.round(clamped / step) * step;
}

export const PRIMITIVE_SCRIPT = `// Primitive rule-based strategy
function decide(game) {
  const edge = game.arena.radius * 0.75;

  // Move back toward the center near the edge.
  if (game.self.distanceFromCenter > edge) {
    if (game.self.angleToCenter < 0) return turnleft(0.2);
    return turnright(0.2);
  }

  // Face the opponent before attacking.
  if (game.enemy.angle < -10) return turnleft(0.1);
  if (game.enemy.angle > 10) return turnright(0.1);

  if (game.self.skillReady && game.enemy.distance < 1.2) return skill();
  if (game.self.dashReady && game.enemy.distance < 2.0) return dash();
  return forward(0.2);
}`;

export const FSM_SCRIPT = `// A state machine built with normal script variables.
let state = "seek";

function faceEnemy(game) {
  if (game.enemy.angle < -12) return turnleft(0.1);
  if (game.enemy.angle > 12) return turnright(0.1);
  return forward(0.2);
}

function decide(game) {
  const nearEdge = game.self.distanceFromCenter > game.arena.radius * 0.78;

  if (state == "seek") {
    if (nearEdge) state = "recover";
    else if (game.enemy.distance < 1.6) state = "attack";
    else return faceEnemy(game);
  }

  if (state == "attack") {
    if (nearEdge) state = "recover";
    else if (game.enemy.distance > 2.4) state = "seek";
    else if (game.self.skillReady) return skill();
    else if (game.self.dashReady) return dash();
    else return faceEnemy(game);
  }

  if (state == "recover") {
    if (game.self.distanceFromCenter < game.arena.radius * 0.55) state = "seek";
    else if (game.self.angleToCenter < -10) return turnleft(0.15);
    else if (game.self.angleToCenter > 10) return turnright(0.15);
    else return forward(0.3);
  }

  return faceEnemy(game);
}`;

export const STARTER_SCRIPT = PRIMITIVE_SCRIPT;

export interface ScriptTuning {
  edgeLimit: number;
  aimTolerance: number;
  dashDistance: number;
}

export function parseScriptTuning(source: string): ScriptTuning {
  const read = (name: string, fallback: number) => {
    const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*([0-9.]+)`));
    return match ? Number(match[1]) : fallback;
  };

  const tuning = {
    edgeLimit: read("EDGE_LIMIT", 0.75),
    aimTolerance: read("AIM_TOLERANCE", 10),
    dashDistance: read("DASH_DISTANCE", 2),
  };

  if (!Number.isFinite(tuning.edgeLimit) || tuning.edgeLimit < 0.45 || tuning.edgeLimit > 0.95) {
    throw new Error("EDGE_LIMIT must be between 0.45 and 0.95.");
  }
  if (!Number.isFinite(tuning.aimTolerance) || tuning.aimTolerance < 2 || tuning.aimTolerance > 90) {
    throw new Error("AIM_TOLERANCE must be between 2 and 90 degrees.");
  }
  if (!Number.isFinite(tuning.dashDistance) || tuning.dashDistance < 0.5 || tuning.dashDistance > 5) {
    throw new Error("DASH_DISTANCE must be between 0.5 and 5.");
  }

  return tuning;
}
