import type { ControlMode, SkillType } from "./rules";
import type { CampaignReplayData } from "./campaign-replay";

export type CampaignMissionKind = "route" | "timed-route" | "survival" | "duel" | "debug" | "analysis";
export type CampaignEnemyArchetype = "passive" | "rusher" | "guard" | "dodger";

export interface CampaignPoint {
  x: number;
  y: number;
  label: string;
}

export interface CampaignObstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CampaignLevelReward {
  xp: number;
  gold: number;
}

export interface CampaignLessonStep {
  id: string;
  title: string;
  explanation: string;
  task: string;
  example?: string;
  check: "review" | "start" | "checkpoint" | "complete";
}

export interface CampaignCommonMistake {
  pattern: string;
  feedback: string;
}

export interface CampaignLevel {
  id: string;
  chapter: number;
  order: number;
  title: string;
  callSign: string;
  mode: ControlMode;
  kind: CampaignMissionKind;
  concept: string;
  outcome: string;
  briefing: string;
  objectives: string[];
  hints: string[];
  durationSeconds: number;
  playerTickMs: number;
  enemyTickMs?: number;
  enemy?: CampaignEnemyArchetype;
  playerSkill?: SkillType;
  checkpoints: CampaignPoint[];
  obstacles: CampaignObstacle[];
  collisionLimit?: number;
  star2: { label: string; maxCollisions?: number; maxActions?: number; maxSeconds?: number };
  star3: { label: string; maxCollisions?: number; maxActions?: number; maxSeconds?: number };
  reward: CampaignLevelReward;
  starterSource?: string;
  contentVersion: number;
  lessonSteps: CampaignLessonStep[];
  commandTopics: string[];
  commonMistakes: CampaignCommonMistake[];
}

export interface CampaignChapter {
  number: number;
  rank: string;
  license: string;
  description: string;
  concepts: string[];
  bonus: CampaignLevelReward;
  badge: string;
}

export interface CampaignLevelProgress {
  levelId: string;
  status: "available" | "active" | "completed" | "mastered";
  attempts: number;
  bestStars: 0 | 1 | 2 | 3;
  bestScore: number;
  firstAttemptSeconds?: number;
  bestAttemptSeconds?: number;
  bestCollisions?: number;
  bestActions?: number;
  hintsViewed: number;
  lastCode?: string;
  completedAt?: string;
  rewardsClaimed: boolean;
  completedLessonSteps?: string[];
  masteryScore?: number;
  improvementPercent?: number;
}

export interface CampaignAttempt {
  levelId: string;
  completed: boolean;
  stars: 0 | 1 | 2 | 3;
  score: number;
  durationSeconds: number;
  collisions: number;
  actions: number;
  checkpoints: number;
  hintsViewed: number;
  code?: string;
  completedLessonSteps?: string[];
  runtimeErrors?: string[];
  replay?: CampaignReplayData;
}

export const campaignChapters: CampaignChapter[] = [
  {
    number: 1,
    rank: "Pilot Cadet",
    license: "Basic Maneuver License",
    description: "Learn to move, turn, cross hazards, and control a training unit under pressure.",
    concepts: ["Movement", "Orientation", "Timing", "Abilities"],
    bonus: { xp: 120, gold: 30 },
    badge: "Rookie Stripe",
  },
  {
    number: 2,
    rank: "Licensed Operator",
    license: "Command Control License",
    description: "Translate intent into precise commands, durations, sequences, and corrections.",
    concepts: ["Commands", "Sequencing", "Duration", "Correction"],
    bonus: { xp: 160, gold: 40 },
    badge: "Command Console",
  },
  {
    number: 3,
    rank: "Tactical Programmer",
    license: "Reactive Systems License",
    description: "Build the decision loop: sense the arena, choose an action, and react every tick.",
    concepts: ["Game ticks", "Sensors", "Conditionals", "Reactive programs"],
    bonus: { xp: 220, gold: 55 },
    badge: "Sensor Visor",
  },
  {
    number: 4,
    rank: "Systems Lieutenant",
    license: "Combat Logic License",
    description: "Forge reusable logic with variables, Boolean expressions, thresholds, and functions.",
    concepts: ["Variables", "Boolean logic", "Functions", "Cooldowns"],
    bonus: { xp: 280, gold: 70 },
    badge: "Logic Core",
  },
  {
    number: 5,
    rank: "Unit Commander",
    license: "Autonomous Control License",
    description: "Design behavior that remembers, changes state, survives faults, and improves through tests.",
    concepts: ["Persistent state", "State machines", "Debugging", "Testing"],
    bonus: { xp: 340, gold: 85 },
    badge: "Commander Crest",
  },
  {
    number: 6,
    rank: "AI Engineer",
    license: "Advanced Intelligence Certification",
    description: "Read evidence, tune decision speed, adapt to opponents, and graduate with an autonomous strategy.",
    concepts: ["Analytics", "Optimization", "Opponent models", "Autonomy"],
    bonus: { xp: 500, gold: 125 },
    badge: "AI Core",
  },
];

const routeScript = `// Follow the active mission beacon.
function decide(game) {
  if (game.target.angle < -10) return turnleft(0.1);
  if (game.target.angle > 10) return turnright(0.1);
  return forward(0.2);
}`;

const safeScript = `// Follow the beacon, but recover near the arena edge.
function decide(game) {
  if (game.self.distanceFromCenter > game.arena.radius * 0.78) {
    if (game.self.angleToCenter < -10) return turnleft(0.1);
    if (game.self.angleToCenter > 10) return turnright(0.1);
  }
  if (game.target.angle < -10) return turnleft(0.1);
  if (game.target.angle > 10) return turnright(0.1);
  return forward(0.2);
}`;

const duelScript = `// Face the opposing unit before advancing.
function decide(game) {
  if (game.self.distanceFromCenter > game.arena.radius * 0.76) {
    if (game.self.angleToCenter < -10) return turnleft(0.1);
    return turnright(0.1);
  }
  if (game.enemy.angle < -10) return turnleft(0.1);
  if (game.enemy.angle > 10) return turnright(0.1);
  if (game.self.dashReady && game.enemy.distance < 2) return dash();
  return forward(0.2);
}`;

const stateScript = `// A small autonomous state machine.
let state = "seek";

function face(game) {
  if (game.enemy.angle < -10) return turnleft(0.1);
  if (game.enemy.angle > 10) return turnright(0.1);
  return forward(0.2);
}

function decide(game) {
  const nearEdge = game.self.distanceFromCenter > game.arena.radius * 0.76;
  if (nearEdge) state = "recover";
  else if (game.enemy.distance < 1.8) state = "attack";
  else state = "seek";

  if (state == "recover") {
    if (game.self.angleToCenter < -10) return turnleft(0.1);
    if (game.self.angleToCenter > 10) return turnright(0.1);
    return forward(0.2);
  }
  if (state == "attack" && game.self.dashReady) return dash();
  return face(game);
}`;

const p = (x: number, y: number, label: string): CampaignPoint => ({ x, y, label });
const o = (x: number, y: number, width: number, height: number): CampaignObstacle => ({ x, y, width, height });

function commentStarterSource(source: string) {
  return source.split("\n").map((line) => `// ${line}`).join("\n");
}

type LevelInput = Omit<CampaignLevel, "chapter" | "order" | "reward" | "star2" | "star3" | "objectives" | "hints" | "checkpoints" | "obstacles" | "durationSeconds" | "playerTickMs" | "contentVersion" | "lessonSteps" | "commandTopics" | "commonMistakes"> & Partial<Pick<CampaignLevel, "objectives" | "hints" | "checkpoints" | "obstacles" | "durationSeconds" | "playerTickMs" | "star2" | "star3" | "lessonSteps" | "commandTopics" | "commonMistakes">>;

function buildLessonSteps(chapter: number, input: LevelInput): CampaignLessonStep[] {
  const example = input.mode === "buttons" ? "W forward · A/D turn · E dash · Q skill" : input.mode === "live" ? "forward(0.5); turnleft(0.2)" : chapter <= 4 ? "function decide(game) { return forward(0.2); }" : undefined;
  const steps: CampaignLessonStep[] = [
    { id: "understand", title: `Understand ${input.concept}`, explanation: input.briefing, task: input.outcome, example, check: "review" },
    { id: "prepare", title: input.mode === "script" ? "Prepare the program" : input.mode === "live" ? "Plan the command sequence" : "Review the controls", explanation: input.mode === "script" ? "Read the starter carefully. Remove comment markers only from lines you intend to run, then inspect the logic before submitting." : input.mode === "live" ? "Commands run in queue order on the pilot tick. Type help at any time for the complete command reference." : "Movement continues while a direction control is held. Abilities have cooldowns.", task: input.mode === "script" ? "Make the smallest purposeful code change and submit the program." : "Start when you can explain your first move.", check: "start" },
    { id: "execute", title: "Execute and observe", explanation: "Watch the objective marker, heading, timer, contacts, and action count. Treat the first run as evidence.", task: input.objectives?.join(" ") ?? input.outcome, check: input.checkpoints?.length ? "checkpoint" : "complete" },
    { id: "reflect", title: "Review and improve", explanation: "Compare the evidence with the star criteria. Change one decision at a time so you know what improved the result.", task: "Complete the mission, then review the performance analysis.", check: "complete" },
  ];
  return chapter >= 6 ? steps.map((step) => ({ ...step, example: undefined })) : steps;
}

function makeLevel(chapter: number, order: number, input: LevelInput): CampaignLevel {
  const standard = [35, 45, 60, 75, 90, 110][chapter - 1];
  const gold = [8, 10, 12, 15, 18, 22][chapter - 1];
  const masteryXp = [80, 100, 130, 160, 190, 250][chapter - 1];
  const masteryGold = [18, 22, 28, 35, 40, 55][chapter - 1];
  const configuredDuration = input.durationSeconds ?? 35;
  const durationMultiplier = input.kind === "survival" ? 1 : input.mode === "live" ? 2 : input.mode === "buttons" ? 1.5 : 1.25;
  return {
    ...input,
    chapter,
    order,
    durationSeconds: Math.ceil(configuredDuration * durationMultiplier),
    playerTickMs: input.playerTickMs ?? 250,
    starterSource: input.mode === "script" && input.starterSource ? commentStarterSource(input.starterSource) : input.starterSource,
    checkpoints: input.checkpoints ?? [],
    obstacles: input.obstacles ?? [],
    objectives: input.objectives ?? [input.outcome],
    hints: input.hints ?? ["Watch the active objective marker.", "Make one change, then run the mission again."],
    star2: input.star2 ?? { label: "Clean execution", maxCollisions: 2 },
    star3: input.star3 ?? { label: "Efficient execution", maxCollisions: 0, maxActions: 24 },
    reward: order === 6 ? { xp: masteryXp, gold: masteryGold } : { xp: standard, gold },
    contentVersion: 1,
    lessonSteps: input.lessonSteps ?? buildLessonSteps(chapter, input),
    commandTopics: input.commandTopics ?? (input.mode === "buttons" ? ["forward", "turnleft", "turnright", "dash", "skill"] : input.mode === "live" ? ["help", "forward", "turnleft", "turnright", "dash", "skill"] : ["decide", "game", input.concept]),
    commonMistakes: input.commonMistakes ?? [
      { pattern: "duration", feedback: "Use a duration between 0.1 and 3 seconds." },
      { pattern: "overshoot", feedback: "Shorten the action duration or tighten the steering threshold." },
      ...(input.mode === "script" ? [{ pattern: "comment", feedback: "Executable lines cannot begin with //. Remove only the comment markers you need." }] : []),
    ],
  };
}

export const campaignLevels: CampaignLevel[] = [
  makeLevel(1, 1, { id: "1-1", title: "First Motion", callSign: "Ignition", mode: "buttons", kind: "route", concept: "Forward movement", outcome: "Reach the first training beacon.", briefing: "Bring the training unit online and drive to the beacon.", checkpoints: [p(520, 220, "Beacon A")], durationSeconds: 25, star3: { label: "Direct route", maxCollisions: 0, maxSeconds: 8 } }),
  makeLevel(1, 2, { id: "1-2", title: "Turn and Face", callSign: "Vector", mode: "buttons", kind: "route", concept: "Orientation", outcome: "Visit three beacons in order.", briefing: "A pilot controls heading as well as speed. Follow the numbered route.", checkpoints: [p(380, 100, "A"), p(540, 220, "B"), p(380, 340, "C")], star3: { label: "Precise route", maxCollisions: 0, maxSeconds: 20 } }),
  makeLevel(1, 3, { id: "1-3", title: "Slalom Course", callSign: "Weave", mode: "buttons", kind: "route", concept: "Obstacle avoidance", outcome: "Clear the route without striking more than three barriers.", briefing: "Thread the unit through rectangular cargo barriers.", checkpoints: [p(300, 120, "A"), p(500, 220, "B"), p(300, 330, "C")], obstacles: [o(360, 105, 48, 105), o(360, 245, 48, 105)], collisionLimit: 3, star2: { label: "Careful pilot", maxCollisions: 1 }, star3: { label: "Flawless slalom", maxCollisions: 0, maxSeconds: 24 } }),
  makeLevel(1, 4, { id: "1-4", title: "Dash Window", callSign: "Comet", mode: "buttons", kind: "timed-route", concept: "Dash timing", outcome: "Cross both gates before the launch window closes.", briefing: "Use Dash to cover the open lanes before time expires.", checkpoints: [p(380, 100, "Gate A"), p(560, 220, "Gate B")], durationSeconds: 18, star2: { label: "Fast launch", maxSeconds: 14 }, star3: { label: "Ace launch", maxSeconds: 10, maxCollisions: 0 } }),
  makeLevel(1, 5, { id: "1-5", title: "Ability Drill", callSign: "Aegis", mode: "buttons", kind: "survival", concept: "Boost and Stone", outcome: "Remain in the arena through the pressure drill.", briefing: "Time your equipped ability while the training unit applies pressure.", enemy: "rusher", enemyTickMs: 800, durationSeconds: 18, star2: { label: "Stable defense", maxCollisions: 4 }, star3: { label: "Controlled defense", maxCollisions: 2, maxActions: 34 } }),
  makeLevel(1, 6, { id: "1-6", title: "Cadet License Trial", callSign: "Rookie Ring", mode: "buttons", kind: "duel", concept: "Combined piloting", outcome: "Push the slow training rival out of the arena.", briefing: "Earn the Basic Maneuver License in your first complete sumo trial.", enemy: "passive", enemyTickMs: 900, durationSeconds: 45, star2: { label: "Decisive victory", maxSeconds: 32 }, star3: { label: "Cadet ace", maxSeconds: 22, maxCollisions: 3 } }),

  makeLevel(2, 1, { id: "2-1", title: "Hello, Forward", callSign: "Prompt", mode: "live", kind: "route", concept: "Function calls", outcome: "Reach the beacon with forward(x).", briefing: "Issue one precise movement command from the command deck.", checkpoints: [p(520, 220, "Beacon")], hints: ["Try forward(1).", "The number is a duration in seconds."], star3: { label: "One command", maxActions: 1 } }),
  makeLevel(2, 2, { id: "2-2", title: "Precision Parking", callSign: "Dock", mode: "live", kind: "route", concept: "Duration", outcome: "Stop inside both docking zones.", briefing: "Choose command durations that move the unit without overshooting.", checkpoints: [p(400, 220, "Dock A"), p(560, 220, "Dock B")], star2: { label: "Measured approach", maxActions: 5 }, star3: { label: "Exact approach", maxActions: 3, maxCollisions: 0 } }),
  makeLevel(2, 3, { id: "2-3", title: "Turn Commands", callSign: "Compass", mode: "live", kind: "route", concept: "Command orientation", outcome: "Complete the L-shaped route.", briefing: "Combine forward and turn commands to change heading deliberately.", checkpoints: [p(380, 105, "A"), p(550, 105, "B")], obstacles: [o(445, 150, 90, 35)], hints: ["turnleft(x) and turnright(x) change heading.", "Use a short turn, observe, then correct."], star3: { label: "Compact sequence", maxActions: 8, maxCollisions: 0 } }),
  makeLevel(2, 4, { id: "2-4", title: "Command Queue", callSign: "Sequence", mode: "live", kind: "timed-route", concept: "Sequencing", outcome: "Queue a route through three gates.", briefing: "Separate commands with semicolons to execute a planned sequence.", checkpoints: [p(380, 110, "A"), p(535, 160, "B"), p(500, 315, "C")], obstacles: [o(410, 185, 55, 90)], hints: ["Commands can be separated with semicolons.", "Plan, run, inspect, then revise the sequence."], durationSeconds: 30, star3: { label: "Efficient queue", maxActions: 10, maxCollisions: 0 } }),
  makeLevel(2, 5, { id: "2-5", title: "Recover and Revise", callSign: "Correction", mode: "live", kind: "route", concept: "Debugging commands", outcome: "Recover from the blocked approach and finish the route.", briefing: "The direct route is blocked. Observe the result and revise your commands.", checkpoints: [p(540, 220, "Recovery beacon")], obstacles: [o(330, 175, 120, 90)], star2: { label: "Controlled recovery", maxCollisions: 2 }, star3: { label: "Clean recovery", maxCollisions: 0, maxActions: 12 } }),
  makeLevel(2, 6, { id: "2-6", title: "Operator License Trial", callSign: "Courier", mode: "live", kind: "timed-route", concept: "Command fluency", outcome: "Deliver to four beacons before time expires.", briefing: "Earn the Command Control License with a complete courier route.", checkpoints: [p(380, 95, "A"), p(555, 155, "B"), p(520, 325, "C"), p(300, 330, "D")], obstacles: [o(405, 160, 55, 125), o(270, 180, 60, 60)], durationSeconds: 45, star2: { label: "Fast courier", maxSeconds: 36 }, star3: { label: "Command ace", maxSeconds: 28, maxCollisions: 0, maxActions: 18 } }),

  makeLevel(3, 1, { id: "3-1", title: "Run the Starter", callSign: "Boot", mode: "script", kind: "route", concept: "Program execution", outcome: "Run a complete decide(game) program.", briefing: "Apply the starter program and observe one decision on every game tick.", checkpoints: [p(525, 220, "Target")], starterSource: routeScript, star3: { label: "Clean run", maxCollisions: 0, maxSeconds: 15 } }),
  makeLevel(3, 2, { id: "3-2", title: "One Tick at a Time", callSign: "Pulse", mode: "script", kind: "route", concept: "Game ticks", outcome: "Follow a changing target at a 500 ms decision tick.", briefing: "The program repeats because the simulator calls decide(game) every tick.", checkpoints: [p(380, 105, "A"), p(540, 220, "B"), p(380, 335, "C")], playerTickMs: 500, starterSource: routeScript, star3: { label: "Stable loop", maxCollisions: 0, maxActions: 28 } }),
  makeLevel(3, 3, { id: "3-3", title: "Read the Sensors", callSign: "Signal", mode: "script", kind: "route", concept: "Target sensors", outcome: "Use target angle and distance to follow the signal.", briefing: "Read game.target.angle to decide whether to turn or advance.", checkpoints: [p(300, 115, "A"), p(525, 125, "B"), p(525, 315, "C")], obstacles: [o(390, 165, 55, 110)], starterSource: routeScript, star3: { label: "Signal lock", maxCollisions: 0, maxSeconds: 27 } }),
  makeLevel(3, 4, { id: "3-4", title: "Edge Safety", callSign: "Return", mode: "script", kind: "survival", concept: "Conditionals", outcome: "Use an if condition to remain in the arena.", briefing: "Detect the edge, turn toward center, and survive the pressure cycle.", enemy: "passive", enemyTickMs: 850, durationSeconds: 22, starterSource: safeScript, star2: { label: "Safe recovery", maxCollisions: 5 }, star3: { label: "Calm recovery", maxCollisions: 3, maxActions: 42 } }),
  makeLevel(3, 5, { id: "3-5", title: "Choose with Else", callSign: "Branch", mode: "script", kind: "duel", concept: "If and else", outcome: "Attack when aligned and recover otherwise.", briefing: "Use branches so the same program behaves differently in different situations.", enemy: "passive", enemyTickMs: 750, durationSeconds: 45, starterSource: duelScript, star3: { label: "Decisive branch", maxSeconds: 30, maxCollisions: 4 } }),
  makeLevel(3, 6, { id: "3-6", title: "Programmer License Trial", callSign: "Decision Loop", mode: "script", kind: "duel", concept: "Reactive programming", outcome: "Defeat the rival with a reactive script.", briefing: "Earn the Reactive Systems License by combining ticks, sensors, and conditions.", enemy: "rusher", enemyTickMs: 600, durationSeconds: 50, starterSource: duelScript, star2: { label: "Reliable reaction", maxSeconds: 40 }, star3: { label: "Tactical reaction", maxSeconds: 30, maxCollisions: 4 } }),

  makeLevel(4, 1, { id: "4-1", title: "Tune a Constant", callSign: "Threshold", mode: "script", kind: "route", concept: "Constants", outcome: "Tune the aiming threshold for a narrow route.", briefing: "Change a named threshold and observe how it affects steering precision.", checkpoints: [p(300, 110, "A"), p(525, 120, "B"), p(520, 320, "C")], obstacles: [o(360, 165, 90, 50)], starterSource: `const AIM = 16;\n\nfunction decide(game) {\n  if (game.target.angle < -AIM) return turnleft(0.1);\n  if (game.target.angle > AIM) return turnright(0.1);\n  return forward(0.2);\n}`, star3: { label: "Fine tuning", maxCollisions: 0, maxSeconds: 26 } }),
  makeLevel(4, 2, { id: "4-2", title: "Boolean Gate", callSign: "Logic", mode: "script", kind: "survival", concept: "Boolean expressions", outcome: "Combine edge and enemy conditions.", briefing: "Use &&, ||, and ! to express when the unit should defend or move.", enemy: "rusher", enemyTickMs: 650, durationSeconds: 24, starterSource: safeScript, star3: { label: "Clear logic", maxCollisions: 3, maxActions: 46 } }),
  makeLevel(4, 3, { id: "4-3", title: "Cooldown Awareness", callSign: "Ready", mode: "script", kind: "duel", concept: "Boolean sensors", outcome: "Use Dash only when it is ready and useful.", briefing: "Read dashReady and enemy distance before committing the ability.", enemy: "guard", enemyTickMs: 600, durationSeconds: 48, starterSource: duelScript, star3: { label: "Resource control", maxSeconds: 32, maxActions: 55 } }),
  makeLevel(4, 4, { id: "4-4", title: "Helper Function", callSign: "Module", mode: "script", kind: "route", concept: "Functions", outcome: "Move repeated steering logic into a helper function.", briefing: "Build a reusable faceTarget(game) helper and call it from decide(game).", checkpoints: [p(300, 105, "A"), p(540, 110, "B"), p(530, 325, "C"), p(300, 330, "D")], obstacles: [o(385, 165, 70, 110)], starterSource: routeScript, star3: { label: "Reusable route", maxCollisions: 0, maxSeconds: 32 } }),
  makeLevel(4, 5, { id: "4-5", title: "Parameters and Returns", callSign: "Interface", mode: "script", kind: "duel", concept: "Function parameters", outcome: "Reuse one behavior with different thresholds.", briefing: "Pass values into a helper and return an action to the decision loop.", enemy: "dodger", enemyTickMs: 500, durationSeconds: 50, starterSource: duelScript, star3: { label: "Flexible logic", maxSeconds: 34, maxCollisions: 4 } }),
  makeLevel(4, 6, { id: "4-6", title: "Systems License Trial", callSign: "Logic Forge", mode: "script", kind: "duel", concept: "Program abstraction", outcome: "Defeat a fast rival using structured logic.", briefing: "Earn the Combat Logic License against a 250 ms tactical opponent.", enemy: "rusher", enemyTickMs: 250, durationSeconds: 55, starterSource: duelScript, star2: { label: "Structured victory", maxSeconds: 45 }, star3: { label: "Systems ace", maxSeconds: 34, maxCollisions: 4 } }),

  makeLevel(5, 1, { id: "5-1", title: "Remember a Value", callSign: "Memory", mode: "script", kind: "route", concept: "Persistent variables", outcome: "Keep a value between decision ticks.", briefing: "A global variable survives between calls to decide(game).", checkpoints: [p(380, 105, "A"), p(540, 220, "B"), p(380, 335, "C")], starterSource: `let phase = 0;\n\nfunction decide(game) {\n  if (game.target.distance < 1) phase = phase + 1;\n  if (game.target.angle < -10) return turnleft(0.1);\n  if (game.target.angle > 10) return turnright(0.1);\n  return forward(0.2);\n}`, star3: { label: "Persistent control", maxCollisions: 0, maxSeconds: 28 } }),
  makeLevel(5, 2, { id: "5-2", title: "Count the Ticks", callSign: "Clock", mode: "script", kind: "survival", concept: "Counters and time", outcome: "Change behavior after a timed phase.", briefing: "Use game.elapsed or a counter to schedule a defensive phase.", enemy: "passive", enemyTickMs: 600, durationSeconds: 24, starterSource: safeScript, star3: { label: "Timed response", maxCollisions: 3, maxActions: 45 } }),
  makeLevel(5, 3, { id: "5-3", title: "Seek–Attack–Recover", callSign: "States", mode: "script", kind: "duel", concept: "Finite-state machines", outcome: "Switch deliberately between three behavior states.", briefing: "Use state to make a readable autonomous strategy.", enemy: "guard", enemyTickMs: 500, durationSeconds: 52, starterSource: stateScript, star3: { label: "State control", maxSeconds: 36, maxCollisions: 4 } }),
  makeLevel(5, 4, { id: "5-4", title: "Syntax Repair", callSign: "Patch", mode: "script", kind: "debug", concept: "Syntax debugging", outcome: "Repair the program so it can run.", briefing: "Read the parser message, locate the malformed condition, and apply a fix.", checkpoints: [p(520, 220, "Test target")], starterSource: `function decide(game) {\n  if (game.target.angle < -10 {\n    return turnleft(0.1);\n  }\n  return forward(0.2);\n}`, hints: ["The if condition must close its parentheses.", "Compare the condition with: if (condition) { ... }"], star3: { label: "Direct repair", maxSeconds: 22, maxCollisions: 0 } }),
  makeLevel(5, 5, { id: "5-5", title: "Sensor Repair", callSign: "Diagnose", mode: "script", kind: "debug", concept: "Runtime debugging", outcome: "Replace the invalid sensor and complete the route.", briefing: "The program parses, but it reads a sensor that does not exist.", checkpoints: [p(380, 105, "A"), p(525, 220, "B")], starterSource: `function decide(game) {\n  if (game.beacon.heading < -10) return turnleft(0.1);\n  if (game.beacon.heading > 10) return turnright(0.1);\n  return forward(0.2);\n}`, hints: ["The mission beacon is game.target.", "Use game.target.angle for its relative heading."], star3: { label: "Clean diagnosis", maxSeconds: 28, maxCollisions: 0 } }),
  makeLevel(5, 6, { id: "5-6", title: "Commander License Trial", callSign: "Memory Core", mode: "script", kind: "duel", concept: "Stateful autonomy", outcome: "Defeat a changing opponent with a state machine.", briefing: "Earn the Autonomous Control License with readable, stateful behavior.", enemy: "dodger", enemyTickMs: 350, durationSeconds: 58, starterSource: stateScript, star2: { label: "Reliable command", maxSeconds: 47 }, star3: { label: "Commander grade", maxSeconds: 36, maxCollisions: 4 } }),

  makeLevel(6, 1, { id: "6-1", title: "Tick Laboratory", callSign: "Frequency", mode: "script", kind: "analysis", concept: "Decision frequency", outcome: "Complete the same route with a 500 ms decision tick.", briefing: "Observe how decision frequency changes turning, overshoot, and action count.", checkpoints: [p(300, 105, "A"), p(535, 115, "B"), p(520, 330, "C")], obstacles: [o(390, 165, 55, 115)], playerTickMs: 500, starterSource: routeScript, star3: { label: "Stable at 500 ms", maxCollisions: 0, maxSeconds: 30 } }),
  makeLevel(6, 2, { id: "6-2", title: "Read the Evidence", callSign: "Telemetry", mode: "script", kind: "analysis", concept: "Performance analysis", outcome: "Reduce collisions from the baseline route.", briefing: "Use the live metrics to revise a threshold and produce a cleaner run.", checkpoints: [p(300, 110, "A"), p(540, 125, "B"), p(520, 325, "C"), p(300, 325, "D")], obstacles: [o(365, 160, 70, 55), o(430, 250, 70, 55)], starterSource: routeScript, star2: { label: "Evidence-led revision", maxCollisions: 1 }, star3: { label: "Optimized route", maxCollisions: 0, maxSeconds: 32 } }),
  makeLevel(6, 3, { id: "6-3", title: "Opponent Models", callSign: "Profile", mode: "script", kind: "duel", concept: "Opponent modeling", outcome: "Adapt the strategy to a guarding rival.", briefing: "Watch the rival behavior, then tune when your unit should approach and dash.", enemy: "guard", enemyTickMs: 300, durationSeconds: 58, starterSource: stateScript, star3: { label: "Model advantage", maxSeconds: 38, maxCollisions: 4 } }),
  makeLevel(6, 4, { id: "6-4", title: "Obstacle Arena", callSign: "Terrain", mode: "script", kind: "analysis", concept: "Planning under constraints", outcome: "Collect all points through a dense obstacle field.", briefing: "Combine target sensing, edge safety, and careful thresholds.", checkpoints: [p(290, 105, "A"), p(535, 105, "B"), p(545, 320, "C"), p(290, 325, "D")], obstacles: [o(350, 135, 55, 95), o(455, 215, 55, 95), o(315, 270, 70, 40)], durationSeconds: 55, starterSource: safeScript, star3: { label: "Terrain master", maxCollisions: 0, maxSeconds: 38 } }),
  makeLevel(6, 5, { id: "6-5", title: "Adaptive Gauntlet", callSign: "Escalation", mode: "script", kind: "duel", concept: "Robust strategy", outcome: "Defeat a 180 ms rusher without leaving the arena.", briefing: "Use every previous concept against the campaign's fastest rival.", enemy: "rusher", enemyTickMs: 180, durationSeconds: 60, starterSource: stateScript, star2: { label: "Robust victory", maxSeconds: 50 }, star3: { label: "Adaptive victory", maxSeconds: 38, maxCollisions: 5 } }),
  makeLevel(6, 6, { id: "6-6", title: "AI Engineer Certification", callSign: "Autonomy", mode: "script", kind: "duel", concept: "Autonomous systems", outcome: "Graduate with a complete autonomous strategy.", briefing: "Build, test, and certify a strategy that can defeat an elite dodger.", enemy: "dodger", enemyTickMs: 150, durationSeconds: 65, starterSource: stateScript, star2: { label: "Certified system", maxSeconds: 52 }, star3: { label: "AI Engineer distinction", maxSeconds: 40, maxCollisions: 4 } }),
];

export function levelsForChapter(chapter: number) {
  return campaignLevels.filter((level) => level.chapter === chapter);
}

export function chapterForLevel(levelId: string) {
  const level = campaignLevels.find((entry) => entry.id === levelId);
  return level ? campaignChapters[level.chapter - 1] : undefined;
}

export function levelIsUnlocked(level: CampaignLevel, progress: Record<string, CampaignLevelProgress>) {
  const index = campaignLevels.findIndex((entry) => entry.id === level.id);
  if (index <= 0) return true;
  return Boolean(progress[campaignLevels[index - 1].id]?.bestStars);
}

export function chapterIsComplete(chapter: number, progress: Record<string, CampaignLevelProgress>) {
  return levelsForChapter(chapter).every((level) => (progress[level.id]?.bestStars ?? 0) >= 1);
}

export function earnedStars(progress: Record<string, CampaignLevelProgress>) {
  return Object.values(progress).reduce((total, entry) => total + (entry.bestStars ?? 0), 0);
}

