export type ControlMode = "buttons" | "live" | "script";
export type SkillType = "boost" | "stone";
export type MatchResult = "win" | "draw" | "loss";

export const PLAYER_SCRIPT_LIMIT = 15;

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
  actionIntervalMs: {
    minimum: 50,
    maximum: 3000,
    default: 250,
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

export function normalizeActionIntervalMs(value: unknown, fallback: number = GAME_RULES.actionIntervalMs.default) {
  const parsed = typeof value === "number" ? value : Number(value);
  const fallbackValue = Number.isFinite(fallback) ? fallback : GAME_RULES.actionIntervalMs.default;
  const finite = Number.isFinite(parsed) ? parsed : fallbackValue;
  return Math.round(Math.min(GAME_RULES.actionIntervalMs.maximum, Math.max(GAME_RULES.actionIntervalMs.minimum, finite)));
}

export interface MatchOutcomeRule {
  rankPoints: number;
  rewards: { xp: number; gold: number };
}

/**
 * The single reward/ranking ruleset used by browser and server flows.
 * Keeping outcomes as structured data makes future seasons and game modes
 * configurable without scattering reward literals through the application.
 */
export const MATCH_OUTCOME_RULES: Record<MatchResult, MatchOutcomeRule> = {
  win: { rankPoints: 1, rewards: { xp: 100, gold: 25 } },
  draw: { rankPoints: 0.5, rewards: { xp: 75, gold: 15 } },
  loss: { rankPoints: 0.25, rewards: { xp: 50, gold: 10 } },
};

export const RANK_POINTS: Record<MatchResult, number> = {
  win: MATCH_OUTCOME_RULES.win.rankPoints,
  draw: MATCH_OUTCOME_RULES.draw.rankPoints,
  loss: MATCH_OUTCOME_RULES.loss.rankPoints,
};

export const MATCH_REWARDS: Record<MatchResult, { xp: number; gold: number }> = {
  win: MATCH_OUTCOME_RULES.win.rewards,
  draw: MATCH_OUTCOME_RULES.draw.rewards,
  loss: MATCH_OUTCOME_RULES.loss.rewards,
};

export const CAMPAIGN_REWARD_RULES = {
  firstCompletion: { xp: 150, gold: 40 },
} as const;

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

export const FSM_SCRIPT = `// Finite State Machine
// One script owns the state, transitions, and every state handler.
let state = "searching";
let stateChangedAt = 0;

function transition(nextState, game) {
  state = nextState;
  stateChangedAt = game.elapsed;
  return true;
}

function steerToEnemy(game, tolerance) {
  if (game.enemy.angle < -tolerance) return turnleft(0.1);
  if (game.enemy.angle > tolerance) return turnright(0.1);
  return forward(0.2);
}

function searching(game) {
  if (game.self.distanceFromCenter > game.arena.radius * 0.78) {
    transition("recovering", game);
    return recovering(game);
  }
  if (game.enemy.distance < 5 && abs(game.enemy.angle) < 20) {
    transition("approaching", game);
    return approaching(game);
  }
  return steerToEnemy(game, 20);
}

function approaching(game) {
  if (game.self.distanceFromCenter > game.arena.radius * 0.82) {
    transition("recovering", game);
    return recovering(game);
  }
  if (game.enemy.distance < 2.5 && abs(game.enemy.angle) < 15) {
    transition("attacking", game);
    return attacking(game);
  }
  if (game.enemy.distance > 6 || abs(game.enemy.angle) > 50) {
    transition("searching", game);
    return searching(game);
  }
  return steerToEnemy(game, 12);
}

function attacking(game) {
  if (game.self.distanceFromCenter > game.arena.radius * 0.84) {
    transition("recovering", game);
    return recovering(game);
  }
  if (game.enemy.distance > 4 || abs(game.enemy.angle) > 25) {
    transition("approaching", game);
    return approaching(game);
  }
  if (game.self.skillReady && !game.enemy.stone) return skill();
  if (game.self.dashReady && abs(game.enemy.angle) < 10) return dash();
  return steerToEnemy(game, 8);
}

function recovering(game) {
  if (game.self.distanceFromCenter < game.arena.radius * 0.56 && game.elapsed - stateChangedAt > 0.1) {
    transition("searching", game);
    return searching(game);
  }
  if (game.self.angleToCenter < -10) return turnleft(0.15);
  if (game.self.angleToCenter > 10) return turnright(0.15);
  return forward(0.3);
}

function decide(game) {
  if (state == "searching") return searching(game);
  if (state == "approaching") return approaching(game);
  if (state == "attacking") return attacking(game);
  if (state == "recovering") return recovering(game);
  transition("searching", game);
  return searching(game);
}`;

export const BEHAVIOR_TREE_SCRIPT = `// Behavior Tree
// The root selector tries branches in priority order. Each branch is a
// sequence: a condition must succeed before its action is returned.
function nearEdge(game) {
  return game.self.distanceFromCenter > game.arena.radius * 0.8;
}

function inAttackRange(game) {
  return game.enemy.distance < 2.5 && abs(game.enemy.angle) < 15;
}

function inApproachRange(game) {
  return game.enemy.distance < 5 && abs(game.enemy.angle) < 45;
}

function recoverAction(game) {
  if (game.self.angleToCenter < -10) return turnleft(0.15);
  if (game.self.angleToCenter > 10) return turnright(0.15);
  return forward(0.3);
}

function attackAction(game) {
  if (game.self.skillReady && !game.enemy.stone) return skill();
  if (game.self.dashReady && abs(game.enemy.angle) < 10) return dash();
  return forward(0.2);
}

function approachAction(game) {
  if (game.enemy.angle < -12) return turnleft(0.1);
  if (game.enemy.angle > 12) return turnright(0.1);
  return forward(0.25);
}

function searchAction(game) {
  if (game.enemy.angle < -25) return turnleft(0.2);
  if (game.enemy.angle > 25) return turnright(0.2);
  return forward(0.15);
}

function recoverSequence(game) {
  if (!nearEdge(game)) return null;
  return recoverAction(game);
}

function attackSequence(game) {
  if (!inAttackRange(game)) return null;
  return attackAction(game);
}

function approachSequence(game) {
  if (!inApproachRange(game)) return null;
  return approachAction(game);
}

function rootSelector(game) {
  let result = recoverSequence(game);
  if (result) return result;
  result = attackSequence(game);
  if (result) return result;
  result = approachSequence(game);
  if (result) return result;
  return searchAction(game);
}

function decide(game) {
  return rootSelector(game);
}`;

export const FUZZY_SCRIPT = `// Sugeno-style Fuzzy Logic
// Sensor values belong to several overlapping sets at the same time.
function triangle(value, center, spread) {
  return clamp(1 - abs(value - center) / spread, 0, 1);
}

function decide(game) {
  const distance = game.enemy.distance;
  const angle = game.enemy.angle;
  const angleSize = abs(angle);

  // Fuzzification: continuous memberships from 0 to 1.
  const close = triangle(distance, 0.7, 1.4);
  const medium = triangle(distance, 2.5, 2.2);
  const far = clamp((distance - 2) / 4, 0, 1);
  const front = triangle(angleSize, 0, 50);
  const left = clamp(-angle / 90, 0, 1);
  const right = clamp(angle / 90, 0, 1);
  const edge = clamp((game.self.distanceFromCenter - game.arena.radius * 0.65) / (game.arena.radius * 0.25), 0, 1);

  // Rule inference: membership strength times each rule's crisp output.
  let forwardScore = far * front * 3 + medium * front * 2;
  let leftScore = left * 1.8;
  let rightScore = right * 1.8;
  let dashScore = 0;
  let skillScore = 0;

  if (game.self.dashReady) dashScore = close * front * 5;
  if (game.self.skillReady && !game.enemy.stone) skillScore = (close + medium) * front * 2.4;

  // Arena-safety rules smoothly override combat as border risk rises.
  if (edge > 0) {
    forwardScore = max(forwardScore * (1 - edge), edge * 4);
    if (game.self.angleToCenter < -8) leftScore = max(leftScore, edge * 5);
    if (game.self.angleToCenter > 8) rightScore = max(rightScore, edge * 5);
    dashScore = dashScore * (1 - edge);
    skillScore = skillScore * (1 - edge);
  }

  // Defuzzification: select the action with the strongest aggregated score.
  let bestScore = forwardScore;
  let bestAction = forward(0.22);
  if (leftScore > bestScore) { bestScore = leftScore; bestAction = turnleft(0.12); }
  if (rightScore > bestScore) { bestScore = rightScore; bestAction = turnright(0.12); }
  if (skillScore > bestScore) { bestScore = skillScore; bestAction = skill(); }
  if (dashScore > bestScore) { bestScore = dashScore; bestAction = dash(); }
  return bestAction;
}`;

export const UTILITY_SCRIPT = `// Utility AI
// Every candidate action is scored by multiplicative considerations.
function rising(value, low, high) {
  return clamp((value - low) / (high - low), 0, 1);
}

function falling(value, low, high) {
  return 1 - rising(value, low, high);
}

function decide(game) {
  const angle = game.enemy.angle;
  const alignment = falling(abs(angle), 0, 90);
  const closeEnemy = falling(game.enemy.distance, 0.7, 5);
  const farEnemy = rising(game.enemy.distance, 1.5, 6);
  const centerSafety = falling(game.self.distanceFromCenter, game.arena.radius * 0.55, game.arena.radius * 0.92);
  const edgeDanger = 1 - centerSafety;
  const leftNeed = rising(-angle, 5, 90);
  const rightNeed = rising(angle, 5, 90);
  const centerLeftNeed = rising(-game.self.angleToCenter, 5, 90);
  const centerRightNeed = rising(game.self.angleToCenter, 5, 90);

  // Multiplication gives each consideration veto power, matching Utility AI.
  let forwardScore = (0.25 + farEnemy * 0.75) * (0.2 + alignment * 0.8) * (0.15 + centerSafety * 0.85);
  let leftScore = max(leftNeed * centerSafety, centerLeftNeed * edgeDanger * 2);
  let rightScore = max(rightNeed * centerSafety, centerRightNeed * edgeDanger * 2);
  let dashScore = 0;
  let skillScore = 0;

  if (game.self.dashReady) dashScore = closeEnemy * alignment * centerSafety * 1.6;
  if (game.self.skillReady && !game.enemy.stone) skillScore = closeEnemy * alignment * centerSafety * 1.8;

  let bestScore = forwardScore;
  let bestAction = forward(0.2);
  if (leftScore > bestScore) { bestScore = leftScore; bestAction = turnleft(0.12); }
  if (rightScore > bestScore) { bestScore = rightScore; bestAction = turnright(0.12); }
  if (dashScore > bestScore) { bestScore = dashScore; bestAction = dash(); }
  if (skillScore > bestScore) { bestScore = skillScore; bestAction = skill(); }
  return bestAction;
}`;

export const BOT_SCRIPT_TEMPLATES = [
  { id: "primitive", name: "Primitive Rules", source: PRIMITIVE_SCRIPT },
  { id: "fsm", name: "Finite State Machine", source: FSM_SCRIPT },
  { id: "behavior-tree", name: "Behavior Tree", source: BEHAVIOR_TREE_SCRIPT },
  { id: "fuzzy", name: "Fuzzy Logic", source: FUZZY_SCRIPT },
  { id: "utility", name: "Utility AI", source: UTILITY_SCRIPT },
] as const;

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
