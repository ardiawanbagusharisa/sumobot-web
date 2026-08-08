"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BotVisual, type BotAppearance } from "./BotVisual";
import { BotDiagnosticsPanels, type BotDiagnosticSnapshot } from "./BotDiagnosticsPanels";
import {
  clampActionDuration,
  GAME_RULES,
  PRIMITIVE_SCRIPT,
  type ControlMode,
  type MatchResult,
  type SkillType,
} from "@/lib/game/rules";
import { createScriptRuntime } from "@/lib/game/script-runtime";

type Side = "player" | "enemy";
type HeldAction = "forward" | "turnleft" | "turnright";

interface CollisionParticle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number; color: string }
interface TrailPoint { x: number; y: number; life: number; maxLife: number; color: string }

interface BotState {
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  spinVelocity: number;
  radius: number;
  thrustUntil: number;
  turnUntil: number;
  turnDirection: -1 | 0 | 1;
  dashReadyAt: number;
  skillReadyAt: number;
  skillUntil: number;
  stunnedUntil: number;
  skill: SkillType;
}

interface BattleArenaProps {
  mode: ControlMode;
  playerSkill: SkillType;
  playerBotName: string;
  playerAppearance: BotAppearance;
  scriptSource: string;
  roundSeconds: number;
  actionIntervalMs: number;
  battleType: "pvai" | "pvp";
  practice: boolean;
  onExit: () => void;
  onMatchComplete: (result: MatchResult, telemetry: BattleTelemetry, replay: BattleReplayData) => void;
  onApplyScript?: (source: string) => void;
}

export interface BattleTelemetry {
  durationSeconds: number;
  actionCounts: Record<"forward" | "turnleft" | "turnright" | "dash" | "skill", number>;
  collisions: number;
  trajectory: number[];
  centerSeconds: number;
  edgeSeconds: number;
  distanceTravelled: number;
  averageSpeed: number;
  firstActions: string[];
}

export type ReplayFrame = [
  elapsedMs: number,
  round: number,
  remainingMs: number,
  playerScore: number,
  enemyScore: number,
  playerX: number,
  playerY: number,
  playerAngle: number,
  playerStone: 0 | 1,
  playerStunned: 0 | 1,
  enemyX: number,
  enemyY: number,
  enemyAngle: number,
  enemyStone: 0 | 1,
  enemyStunned: 0 | 1,
  playerForward?: number,
  playerTurnLeft?: number,
  playerTurnRight?: number,
  playerDash?: number,
  playerSkill?: number,
  collisions?: number,
  enemyForward?: number,
  enemyTurnLeft?: number,
  enemyTurnRight?: number,
  enemyDash?: number,
  enemySkill?: number,
  enemyCollisions?: number,
];

export interface BattleReplayData {
  version: 1 | 2 | 3;
  arena: { width: number; height: number; x: number; y: number; radius: number };
  roundSeconds: number;
  player: { name: string; skill: SkillType; appearance: BotAppearance };
  enemy: { name: string; skill: SkillType; appearance: BotAppearance };
  frames: ReplayFrame[];
}

const WIDTH = 760;
const HEIGHT = 510;
const ARENA_X = WIDTH / 2;
const ARENA_Y = HEIGHT / 2 + 8;
const ARENA_RADIUS = 205;
const BOT_VISUAL_SIZE = 64;
const DISORIENTATION_DAMPING = 7;
const REPLAY_SAMPLE_INTERVAL_MS = 200;
const ENEMY_APPEARANCE: BotAppearance = { wheel: "#541f25", body: "#ff554f", face: "#fff1e8", accessory: "#ff554f", faceId: "face-focus", accessoryId: "acc-antenna" };

function randomSignedTurn(minimumDegrees: number, maximumDegrees: number) {
  const degrees = minimumDegrees + Math.random() * (maximumDegrees - minimumDegrees);
  return degrees * Math.PI / 180 * (Math.random() < 0.5 ? -1 : 1);
}

function createBot(side: Side, skill: SkillType): BotState {
  return {
    x: side === "player" ? ARENA_X - 112 : ARENA_X + 112,
    y: ARENA_Y,
    angle: side === "player" ? 0 : Math.PI,
    vx: 0,
    vy: 0,
    spinVelocity: 0,
    radius: 27,
    thrustUntil: 0,
    turnUntil: 0,
    turnDirection: 0,
    dashReadyAt: 0,
    skillReadyAt: 0,
    skillUntil: 0,
    stunnedUntil: 0,
    skill,
  };
}

function normalizeAngle(angle: number) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function formatTime(seconds: number) {
  const value = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function emptyTelemetry(): BattleTelemetry {
  return { durationSeconds: 0, actionCounts: { forward: 0, turnleft: 0, turnright: 0, dash: 0, skill: 0 }, collisions: 0, trajectory: Array(64).fill(0), centerSeconds: 0, edgeSeconds: 0, distanceTravelled: 0, averageSpeed: 0, firstActions: [] };
}

function diagnosticSnapshot(name: string, telemetry: BattleTelemetry): BotDiagnosticSnapshot {
  return { name, elapsedSeconds: telemetry.durationSeconds, collisions: telemetry.collisions, centerShare: telemetry.durationSeconds ? telemetry.centerSeconds / telemetry.durationSeconds : 0, actionCounts: telemetry.actionCounts, heatmap: telemetry.trajectory };
}

function safeScriptRuntime(source: string) {
  try { return createScriptRuntime(source); }
  catch { return createScriptRuntime(PRIMITIVE_SCRIPT); }
}

export function BattleArena({ mode, playerSkill, playerBotName, playerAppearance, scriptSource, roundSeconds, actionIntervalMs, battleType, practice, onExit, onMatchComplete, onApplyScript }: BattleArenaProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerVisualRef = useRef<HTMLDivElement>(null);
  const enemyVisualRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef(createBot("player", playerSkill));
  const enemyRef = useRef(createBot("enemy", "stone"));
  const runningRef = useRef(false);
  const startedAtRef = useRef(0);
  const lastFrameRef = useRef(0);
  const roundRef = useRef(1);
  const scoresRef = useRef({ player: 0, enemy: 0 });
  const nextEnemyDecisionRef = useRef(0);
  const nextScriptDecisionRef = useRef(0);
  const heldActionsRef = useRef<Set<HeldAction>>(new Set());
  const nextHeldActionAtRef = useRef(0);
  const lastPlayerActionAtRef = useRef(0);
  const nextTelemetrySampleRef = useRef(0);
  const lastCollisionAtRef = useRef(0);
  const matchStartedAtRef = useRef(0);
  const lastTelemetryPositionRef = useRef({ player: { x: 0, y: 0 }, enemy: { x: 0, y: 0 } });
  const telemetryRef = useRef<BattleTelemetry>(emptyTelemetry());
  const enemyTelemetryRef = useRef<BattleTelemetry>(emptyTelemetry());
  const speedSamplesRef = useRef({ player: { total: 0, count: 0 }, enemy: { total: 0, count: 0 } });
  const collisionParticlesRef = useRef<CollisionParticle[]>([]);
  const wheelTrailsRef = useRef<TrailPoint[]>([]);
  const nextTrailAtRef = useRef(0);
  const nextHudUpdateAtRef = useRef(0);
  const replayFramesRef = useRef<ReplayFrame[]>([]);
  const nextReplayFrameAtRef = useRef(0);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scriptRuntimeRef = useRef(safeScriptRuntime(scriptSource));
  const [running, setRunning] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [matchTelemetry, setMatchTelemetry] = useState<BattleTelemetry | null>(null);
  const [matchReplay, setMatchReplay] = useState<BattleReplayData | null>(null);
  const [round, setRound] = useState(1);
  const [scores, setScores] = useState({ player: 0, enemy: 0 });
  const [timeLeft, setTimeLeft] = useState(roundSeconds);
  const [message, setMessage] = useState("Ready for round one");
  const [lastAction, setLastAction] = useState("No action yet");
  const [command, setCommand] = useState("");
  const [commandLog, setCommandLog] = useState<string[]>([
    "Terminal ready. Type help for commands.",
  ]);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [scriptOpen, setScriptOpen] = useState(true);
  const [controlsOpen, setControlsOpen] = useState(() => typeof window === "undefined" || !window.matchMedia("(max-width: 680px)").matches);
  const [temporaryScript, setTemporaryScript] = useState(scriptSource);
  const [scriptStatus, setScriptStatus] = useState("Temporary battle copy");
  const [cooldowns, setCooldowns] = useState({ dash: 0, skill: 0, stun: 0, stone: 0 });
  const [diagnosticTelemetry, setDiagnosticTelemetry] = useState({ player: emptyTelemetry(), enemy: emptyTelemetry() });

  useEffect(() => {
    playerRef.current.skill = playerSkill;
  }, [playerSkill]);

  const resetTelemetry = useCallback(() => {
    telemetryRef.current = emptyTelemetry();
    enemyTelemetryRef.current = emptyTelemetry();
    speedSamplesRef.current = { player: { total: 0, count: 0 }, enemy: { total: 0, count: 0 } };
    nextTelemetrySampleRef.current = 0;
    lastCollisionAtRef.current = 0;
    lastTelemetryPositionRef.current = { player: { x: 0, y: 0 }, enemy: { x: 0, y: 0 } };
    nextHudUpdateAtRef.current = 0;
    replayFramesRef.current = [];
    nextReplayFrameAtRef.current = 0;
    setCooldowns({ dash: 0, skill: 0, stun: 0, stone: 0 });
    setDiagnosticTelemetry({ player: emptyTelemetry(), enemy: emptyTelemetry() });
  }, []);

  const resetBots = useCallback(() => {
    playerRef.current = createBot("player", playerSkill);
    enemyRef.current = createBot("enemy", "stone");
    nextEnemyDecisionRef.current = 0;
    nextScriptDecisionRef.current = 0;
    nextTrailAtRef.current = 0;
    collisionParticlesRef.current = [];
    wheelTrailsRef.current = [];
  }, [playerSkill]);

  const beginRound = useCallback(() => {
    resetBots();
    scriptRuntimeRef.current?.reset();
    startedAtRef.current = performance.now();
    lastFrameRef.current = performance.now();
    runningRef.current = true;
    setRunning(true);
    setTimeLeft(roundSeconds);
    setMessage(`Round ${roundRef.current} · Fight!`);
  }, [resetBots, roundSeconds]);

  const startMatch = useCallback(() => {
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
    roundRef.current = 1;
    scoresRef.current = { player: 0, enemy: 0 };
    setRound(1);
    setScores({ player: 0, enemy: 0 });
    setLastAction("Match started");
    setHasStarted(true);
    setMatchResult(null);
    setMatchTelemetry(null);
    setMatchReplay(null);
    resetTelemetry();
    matchStartedAtRef.current = performance.now();
    beginRound();
  }, [beginRound, resetTelemetry]);

  const finishRound = useCallback(
    (winner: Side | "draw") => {
      if (!runningRef.current) return;
      runningRef.current = false;
      setRunning(false);

      if (winner !== "draw") {
        scoresRef.current = {
          ...scoresRef.current,
          [winner]: scoresRef.current[winner] + 1,
        };
        setScores(scoresRef.current);
      }

      const roundEndedAt = performance.now();
      const player = playerRef.current;
      const enemy = enemyRef.current;
      replayFramesRef.current.push([
        Math.round(roundEndedAt - matchStartedAtRef.current), roundRef.current,
        Math.max(0, Math.round((roundSeconds - (roundEndedAt - startedAtRef.current) / 1000) * 1000)),
        scoresRef.current.player, scoresRef.current.enemy,
        Math.round(player.x * 10) / 10, Math.round(player.y * 10) / 10, Math.round(player.angle * 1000) / 1000,
        player.skill === "stone" && roundEndedAt < player.skillUntil ? 1 : 0, roundEndedAt < player.stunnedUntil ? 1 : 0,
        Math.round(enemy.x * 10) / 10, Math.round(enemy.y * 10) / 10, Math.round(enemy.angle * 1000) / 1000,
        enemy.skill === "stone" && roundEndedAt < enemy.skillUntil ? 1 : 0, roundEndedAt < enemy.stunnedUntil ? 1 : 0,
        telemetryRef.current.actionCounts.forward, telemetryRef.current.actionCounts.turnleft, telemetryRef.current.actionCounts.turnright,
        telemetryRef.current.actionCounts.dash, telemetryRef.current.actionCounts.skill, telemetryRef.current.collisions,
        enemyTelemetryRef.current.actionCounts.forward, enemyTelemetryRef.current.actionCounts.turnleft, enemyTelemetryRef.current.actionCounts.turnright,
        enemyTelemetryRef.current.actionCounts.dash, enemyTelemetryRef.current.actionCounts.skill, enemyTelemetryRef.current.collisions,
      ]);

      setMessage(
        winner === "draw"
          ? `Round ${roundRef.current} is a draw`
          : winner === "player"
            ? `${playerBotName} wins round ${roundRef.current}`
            : `Pebble wins round ${roundRef.current}`,
      );

      const matchFinished =
        scoresRef.current.player >= GAME_RULES.winsRequired ||
        scoresRef.current.enemy >= GAME_RULES.winsRequired ||
        roundRef.current >= GAME_RULES.roundsPerMatch;

      if (matchFinished) {
        const result: MatchResult = scoresRef.current.player === scoresRef.current.enemy
          ? "draw"
          : scoresRef.current.player > scoresRef.current.enemy
            ? "win"
            : "loss";
        setMatchResult(result);
        const samples = speedSamplesRef.current.player;
        const telemetry = {
          ...telemetryRef.current,
          durationSeconds: Math.max(0, (performance.now() - matchStartedAtRef.current) / 1000),
          averageSpeed: samples.count ? samples.total / samples.count : 0,
        };
        telemetryRef.current = telemetry;
        setMatchTelemetry(telemetry);
        setMatchReplay({
          version: 3,
          arena: { width: WIDTH, height: HEIGHT, x: ARENA_X, y: ARENA_Y, radius: ARENA_RADIUS },
          roundSeconds,
          player: { name: playerBotName, skill: playerSkill, appearance: { ...playerAppearance } },
          enemy: { name: battleType === "pvai" ? "Pebble" : "Rival", skill: "stone", appearance: { ...ENEMY_APPEARANCE } },
          frames: [...replayFramesRef.current],
        });
        const finalMessage =
          scoresRef.current.player === scoresRef.current.enemy
            ? "Match draw · +0.50 rank points"
            : scoresRef.current.player > scoresRef.current.enemy
              ? `${playerBotName} wins the match · +1.00 rank point`
              : `${battleType === "pvai" ? "Pebble" : "Rival"} wins · ${playerBotName} earns +0.25 rank points`;
        transitionTimerRef.current = setTimeout(() => setMessage(finalMessage), 900);
        return;
      }

      transitionTimerRef.current = setTimeout(() => {
        roundRef.current += 1;
        setRound(roundRef.current);
        beginRound();
      }, 1700);
    },
    [battleType, beginRound, playerAppearance, playerBotName, playerSkill, roundSeconds],
  );

  const performAction = useCallback((side: Side, action: string, duration = 0.2, bypassInterval = false) => {
    if (!runningRef.current) return false;
    const now = performance.now();
    const isTimedAction = action === "forward" || action === "turnleft" || action === "turnright";
    if (side === "player" && isTimedAction && !bypassInterval && now - lastPlayerActionAtRef.current < actionIntervalMs) return false;
    const bot = side === "player" ? playerRef.current : enemyRef.current;
    const safeDuration = clampActionDuration(duration) * 1000;

    if (now < bot.stunnedUntil) return false;
    if (now < bot.skillUntil && bot.skill === "stone") return false;

    if (action === "forward") {
      bot.thrustUntil = Math.max(bot.thrustUntil, now + safeDuration);
    } else if (action === "turnleft" || action === "turnright") {
      bot.turnDirection = action === "turnleft" ? -1 : 1;
      bot.turnUntil = now + safeDuration;
    } else if (action === "dash") {
      if (now < bot.dashReadyAt) return false;
      const multiplier = now < bot.skillUntil && bot.skill === "boost" ? GAME_RULES.skills.boostMultiplier : 1;
      bot.vx += Math.cos(bot.angle) * GAME_RULES.dash.force * multiplier;
      bot.vy += Math.sin(bot.angle) * GAME_RULES.dash.force * multiplier;
      bot.dashReadyAt = now + GAME_RULES.dash.cooldownSeconds * 1000;
    } else if (action === "skill") {
      if (now < bot.skillReadyAt) return false;
      bot.skillUntil = now + GAME_RULES.skills.durationSeconds * 1000;
      bot.skillReadyAt = now + GAME_RULES.skills.cooldownSeconds * 1000;
      if (bot.skill === "stone") {
        bot.vx = 0;
        bot.vy = 0;
      }
    } else {
      return false;
    }

    const targetTelemetry = side === "player" ? telemetryRef.current : enemyTelemetryRef.current;
    const actionKey = action as keyof BattleTelemetry["actionCounts"];
    targetTelemetry.actionCounts[actionKey] += 1;
    if (targetTelemetry.firstActions.length < 8) targetTelemetry.firstActions.push(action);
    if (side === "player") {
      if (isTimedAction) lastPlayerActionAtRef.current = now;
      const suffix = action === "forward" || action.startsWith("turn") ? `(${(safeDuration / 1000).toFixed(1)})` : "()";
      setLastAction(`${action}${suffix}`);
    }
    return true;
  }, [actionIntervalMs]);

  const startHolding = useCallback((action: HeldAction) => {
    heldActionsRef.current.add(action);
    nextHeldActionAtRef.current = 0;
  }, []);

  const stopHolding = useCallback((action: HeldAction) => {
    heldActionsRef.current.delete(action);
  }, []);

  const submitCommand = useCallback(() => {
    const value = command.trim().toLowerCase();
    if (!value) return;

    if (value === "clear") {
      setCommandLog([]);
      setCommand("");
      return;
    }
    if (value === "help") {
      setCommandLog((items) => [...items.slice(-3), "> help", "forward(x), turnleft(x), turnright(x), dash(), skill()"]);
      setCommand("");
      return;
    }

    const timed = value.match(/^(forward|turnleft|turnright)\((\d+(?:\.\d+)?)\)$/);
    const instant = value.match(/^(dash|skill)\(\)$/);
    let accepted = false;

    if (timed) {
      const duration = Number(timed[2]);
      if (duration >= GAME_RULES.actionDuration.minimum && duration <= GAME_RULES.actionDuration.maximum) {
        accepted = performAction("player", timed[1], duration);
      }
    } else if (instant) {
      accepted = performAction("player", instant[1]);
    }

    setCommandLog((items) => [
      ...items.slice(-4),
      `> ${value}`,
      accepted ? "Command accepted" : "Command rejected · check syntax, cooldown, or duration",
    ]);
    setCommand("");
  }, [command, performAction]);

  const editTemporaryScript = (value: string) => {
    setTemporaryScript(value);
    setScriptStatus("Changes ready to apply");
  };

  const applyTemporaryScript = () => {
    try {
      scriptRuntimeRef.current = createScriptRuntime(temporaryScript);
      onApplyScript?.(temporaryScript);
      setScriptStatus(practice ? "Applied to this test and saved in Lab" : "Applied to this battle only");
    } catch (error) {
      setScriptStatus(error instanceof Error ? error.message : "Invalid temporary script");
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (mode !== "buttons") return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const heldActions: Record<string, HeldAction> = { KeyW: "forward", KeyA: "turnleft", KeyD: "turnright" };
      const heldAction = heldActions[event.code];
      if (heldAction) {
        event.preventDefault();
        startHolding(heldAction);
      } else if (!event.repeat && (event.code === "KeyE" || event.code === "KeyQ")) {
        event.preventDefault();
        performAction("player", event.code === "KeyE" ? "dash" : "skill");
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const heldActions: Record<string, HeldAction> = { KeyW: "forward", KeyA: "turnleft", KeyD: "turnright" };
      const action = heldActions[event.code];
      if (action) stopHolding(action);
    };
    const clearHeldActions = () => heldActionsRef.current.clear();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearHeldActions);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearHeldActions);
      clearHeldActions();
    };
  }, [mode, performAction, startHolding, stopHolding]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let animationFrame = 0;

    const updateBot = (bot: BotState, dt: number, now: number) => {
      const stoneActive = bot.skill === "stone" && now < bot.skillUntil;
      if (stoneActive) {
        bot.vx = 0;
        bot.vy = 0;
        bot.spinVelocity = 0;
        return;
      }

      if (Math.abs(bot.spinVelocity) > 0.001) {
        bot.angle = normalizeAngle(bot.angle + bot.spinVelocity * dt);
        bot.spinVelocity *= Math.exp(-DISORIENTATION_DAMPING * dt);
      } else {
        bot.spinVelocity = 0;
      }
      const stunned = now < bot.stunnedUntil;
      if (!stunned && now < bot.turnUntil) bot.angle += bot.turnDirection * 2.8 * dt;
      if (!stunned && now < bot.thrustUntil) {
        const boost = bot.skill === "boost" && now < bot.skillUntil ? GAME_RULES.skills.boostMultiplier : 1;
        bot.vx += Math.cos(bot.angle) * 330 * boost * dt;
        bot.vy += Math.sin(bot.angle) * 330 * boost * dt;
      }

      const speed = Math.hypot(bot.vx, bot.vy);
      const maxSpeed = 355;
      if (speed > maxSpeed) {
        bot.vx = (bot.vx / speed) * maxSpeed;
        bot.vy = (bot.vy / speed) * maxSpeed;
      }
      bot.vx *= Math.pow(0.18, dt);
      bot.vy *= Math.pow(0.18, dt);
      bot.x += bot.vx * dt;
      bot.y += bot.vy * dt;
    };

    const decideFor = (bot: BotState, target: BotState, now: number) => {
      const centerDistance = Math.hypot(bot.x - ARENA_X, bot.y - ARENA_Y);
      const targetAngle =
        centerDistance > ARENA_RADIUS * 0.78
          ? Math.atan2(ARENA_Y - bot.y, ARENA_X - bot.x)
          : Math.atan2(target.y - bot.y, target.x - bot.x);
      const difference = normalizeAngle(targetAngle - bot.angle);
      const tolerance = (12 * Math.PI) / 180;

      if (difference < -tolerance) performAction("enemy", "turnleft", 0.1);
      else if (difference > tolerance) performAction("enemy", "turnright", 0.1);
      else {
        const distance = Math.hypot(target.x - bot.x, target.y - bot.y) / 80;
        if (now >= bot.skillReadyAt && distance < 1.2) performAction("enemy", "skill");
        else if (now >= bot.dashReadyAt && distance < 1.8) performAction("enemy", "dash");
        else performAction("enemy", "forward", 0.2);
      }
    };

    const loop = (now: number) => {
      const dt = Math.min(0.034, Math.max(0.001, (now - lastFrameRef.current) / 1000));
      lastFrameRef.current = now;
      const player = playerRef.current;
      const enemy = enemyRef.current;

      if (runningRef.current) {
        if (mode === "buttons" && heldActionsRef.current.size > 0 && now >= nextHeldActionAtRef.current) {
          const holdDuration = Math.min(3, Math.max(0.1, actionIntervalMs / 1000 + 0.08));
          heldActionsRef.current.forEach((action) => performAction("player", action, holdDuration, true));
          nextHeldActionAtRef.current = now + actionIntervalMs;
        }
        if (now >= nextEnemyDecisionRef.current) {
          decideFor(enemy, player, now);
          nextEnemyDecisionRef.current = now + (battleType === "pvai" ? Math.max(GAME_RULES.prototypeOpponent.decisionIntervalMs, actionIntervalMs) : Math.max(220, actionIntervalMs));
        }
        if (mode === "script" && now >= nextScriptDecisionRef.current) {
          const angleToCenter = normalizeAngle(Math.atan2(ARENA_Y - player.y, ARENA_X - player.x) - player.angle) * 180 / Math.PI;
          const enemyAngle = normalizeAngle(Math.atan2(enemy.y - player.y, enemy.x - player.x) - player.angle) * 180 / Math.PI;
          try {
            const action = scriptRuntimeRef.current?.decide({ game: {
              elapsed: Math.max(0, (now - matchStartedAtRef.current) / 1000),
              arena: { radius: ARENA_RADIUS },
              self: {
                distanceFromCenter: Math.hypot(player.x - ARENA_X, player.y - ARENA_Y),
                angleToCenter,
                dashReady: now >= player.dashReadyAt,
                skillReady: now >= player.skillReadyAt,
                skill: player.skill,
              },
              enemy: {
                distance: Math.hypot(enemy.x - player.x, enemy.y - player.y) / 80,
                angle: enemyAngle,
                stunned: now < enemy.stunnedUntil,
                stone: enemy.skill === "stone" && now < enemy.skillUntil,
              },
            } });
            if (action) performAction("player", action.name, action.duration);
          } catch (error) {
            setScriptStatus(error instanceof Error ? error.message : "Script runtime error");
          }
          nextScriptDecisionRef.current = now + actionIntervalMs;
        }

        updateBot(player, dt, now);
        updateBot(enemy, dt, now);

        if (now >= nextTrailAtRef.current) {
          const addWheelTrails = (bot: BotState, color: string) => {
            if (Math.hypot(bot.vx, bot.vy) < 18) return;
            const offsetX = -Math.sin(bot.angle) * 18;
            const offsetY = Math.cos(bot.angle) * 18;
            wheelTrailsRef.current.push(
              { x: bot.x + offsetX, y: bot.y + offsetY, life: 0.55, maxLife: 0.55, color },
              { x: bot.x - offsetX, y: bot.y - offsetY, life: 0.55, maxLife: 0.55, color },
            );
          };
          addWheelTrails(player, "#b8ff3d");
          addWheelTrails(enemy, "#ff554f");
          wheelTrailsRef.current = wheelTrailsRef.current.slice(-180);
          nextTrailAtRef.current = now + 42;
        }

        if (now >= nextTelemetrySampleRef.current) {
          const sampleBot = (side: Side, bot: BotState, telemetry: BattleTelemetry) => {
            const gridX = Math.max(0, Math.min(7, Math.floor(((bot.x - (ARENA_X - ARENA_RADIUS)) / (ARENA_RADIUS * 2)) * 8)));
            const gridY = Math.max(0, Math.min(7, Math.floor(((bot.y - (ARENA_Y - ARENA_RADIUS)) / (ARENA_RADIUS * 2)) * 8)));
            telemetry.trajectory[gridY * 8 + gridX] += 1;
            const centerDistance = Math.hypot(bot.x - ARENA_X, bot.y - ARENA_Y);
            if (centerDistance < ARENA_RADIUS * 0.45) telemetry.centerSeconds += 0.25;
            if (centerDistance > ARENA_RADIUS * 0.78) telemetry.edgeSeconds += 0.25;
            const previous = lastTelemetryPositionRef.current[side];
            if (previous.x || previous.y) telemetry.distanceTravelled += Math.hypot(bot.x - previous.x, bot.y - previous.y);
            lastTelemetryPositionRef.current[side] = { x: bot.x, y: bot.y };
            speedSamplesRef.current[side].total += Math.hypot(bot.vx, bot.vy);
            speedSamplesRef.current[side].count += 1;
          };
          sampleBot("player", player, telemetryRef.current);
          sampleBot("enemy", enemy, enemyTelemetryRef.current);
          nextTelemetrySampleRef.current = now + 250;
        }

        if (now >= nextHudUpdateAtRef.current) {
          setCooldowns({
            dash: Math.max(0, (player.dashReadyAt - now) / 1000),
            skill: Math.max(0, (player.skillReadyAt - now) / 1000),
            stun: Math.max(0, (player.stunnedUntil - now) / 1000),
            stone: player.skill === "stone" ? Math.max(0, (player.skillUntil - now) / 1000) : 0,
          });
          const elapsedSeconds = Math.max(0, (now - matchStartedAtRef.current) / 1000);
          const snapshot = (telemetry: BattleTelemetry, side: Side): BattleTelemetry => ({
            ...telemetry,
            durationSeconds: elapsedSeconds,
            averageSpeed: speedSamplesRef.current[side].count ? speedSamplesRef.current[side].total / speedSamplesRef.current[side].count : 0,
            actionCounts: { ...telemetry.actionCounts },
            trajectory: [...telemetry.trajectory],
            firstActions: [...telemetry.firstActions],
          });
          setDiagnosticTelemetry({ player: snapshot(telemetryRef.current, "player"), enemy: snapshot(enemyTelemetryRef.current, "enemy") });
          nextHudUpdateAtRef.current = now + 120;
        }

        const dx = enemy.x - player.x;
        const dy = enemy.y - player.y;
        const distance = Math.max(0.001, Math.hypot(dx, dy));
        const minimumDistance = player.radius + enemy.radius;
        if (distance < minimumDistance) {
          const playerStone = player.skill === "stone" && now < player.skillUntil;
          const enemyStone = enemy.skill === "stone" && now < enemy.skillUntil;
          const nx = dx / distance;
          const ny = dy / distance;
          const relativeNormalVelocity = (enemy.vx - player.vx) * nx + (enemy.vy - player.vy) * ny;
          const isApproaching = relativeNormalVelocity < -5;
          const isNewCollision = isApproaching && now - lastCollisionAtRef.current > 280;
          if (isNewCollision) {
            telemetryRef.current.collisions += 1;
            enemyTelemetryRef.current.collisions += 1;
            lastCollisionAtRef.current = now;
            const playerSpeed = Math.hypot(player.vx, player.vy);
            const enemySpeed = Math.hypot(enemy.vx, enemy.vy);
            const playerIsAttacker = playerSpeed >= enemySpeed;
            if (!playerStone) {
              player.stunnedUntil = Math.max(player.stunnedUntil, now + 500);
              player.thrustUntil = now;
              player.turnUntil = now;
            }
            if (!enemyStone) {
              enemy.stunnedUntil = Math.max(enemy.stunnedUntil, now + 500);
              enemy.thrustUntil = now;
              enemy.turnUntil = now;
            }
            if (!playerStone) player.spinVelocity += (playerIsAttacker ? randomSignedTurn(15, 90) : randomSignedTurn(30, 120)) * DISORIENTATION_DAMPING;
            if (!enemyStone) enemy.spinVelocity += (playerIsAttacker ? randomSignedTurn(30, 120) : randomSignedTurn(15, 90)) * DISORIENTATION_DAMPING;
            const contactX = (player.x + enemy.x) / 2;
            const contactY = (player.y + enemy.y) / 2;
            for (let index = 0; index < 12; index += 1) {
              const particleAngle = Math.random() * Math.PI * 2;
              const particleSpeed = 65 + Math.random() * 135;
              const life = 0.28 + Math.random() * 0.28;
              collisionParticlesRef.current.push({ x: contactX, y: contactY, vx: Math.cos(particleAngle) * particleSpeed, vy: Math.sin(particleAngle) * particleSpeed, life, maxLife: life, size: 1.5 + Math.random() * 3, color: index % 3 === 0 ? "#f5f3ea" : index % 2 === 0 ? "#b8ff3d" : "#ff554f" });
            }
          }
          const overlap = minimumDistance - distance;

          if (playerStone) {
            enemy.x += nx * overlap;
            enemy.y += ny * overlap;
          } else if (enemyStone) {
            player.x -= nx * overlap;
            player.y -= ny * overlap;
          } else {
            player.x -= nx * overlap * 0.5;
            player.y -= ny * overlap * 0.5;
            enemy.x += nx * overlap * 0.5;
            enemy.y += ny * overlap * 0.5;
          }

          if (isApproaching) {
            const impact = Math.max(120, Math.hypot(player.vx - enemy.vx, player.vy - enemy.vy));
            if (playerStone) {
              enemy.vx = nx * impact * GAME_RULES.skills.stoneReflectMultiplier;
              enemy.vy = ny * impact * GAME_RULES.skills.stoneReflectMultiplier;
            } else if (enemyStone) {
              player.vx = -nx * impact * GAME_RULES.skills.stoneReflectMultiplier;
              player.vy = -ny * impact * GAME_RULES.skills.stoneReflectMultiplier;
            } else {
              const impulse = relativeNormalVelocity * 0.92;
              player.vx += nx * impulse;
              player.vy += ny * impulse;
              enemy.vx -= nx * impulse;
              enemy.vy -= ny * impulse;
            }
          }
        }

        const elapsed = (now - startedAtRef.current) / 1000;
        const remaining = roundSeconds - elapsed;
        if (now >= nextReplayFrameAtRef.current) {
          replayFramesRef.current.push([
            Math.round(now - matchStartedAtRef.current), roundRef.current, Math.max(0, Math.round(remaining * 1000)),
            scoresRef.current.player, scoresRef.current.enemy,
            Math.round(player.x * 10) / 10, Math.round(player.y * 10) / 10, Math.round(player.angle * 1000) / 1000,
            player.skill === "stone" && now < player.skillUntil ? 1 : 0, now < player.stunnedUntil ? 1 : 0,
            Math.round(enemy.x * 10) / 10, Math.round(enemy.y * 10) / 10, Math.round(enemy.angle * 1000) / 1000,
            enemy.skill === "stone" && now < enemy.skillUntil ? 1 : 0, now < enemy.stunnedUntil ? 1 : 0,
            telemetryRef.current.actionCounts.forward, telemetryRef.current.actionCounts.turnleft, telemetryRef.current.actionCounts.turnright,
            telemetryRef.current.actionCounts.dash, telemetryRef.current.actionCounts.skill, telemetryRef.current.collisions,
            enemyTelemetryRef.current.actionCounts.forward, enemyTelemetryRef.current.actionCounts.turnleft, enemyTelemetryRef.current.actionCounts.turnright,
            enemyTelemetryRef.current.actionCounts.dash, enemyTelemetryRef.current.actionCounts.skill, enemyTelemetryRef.current.collisions,
          ]);
          nextReplayFrameAtRef.current = now + REPLAY_SAMPLE_INTERVAL_MS;
        }

        const playerOut = Math.hypot(player.x - ARENA_X, player.y - ARENA_Y) > ARENA_RADIUS + player.radius;
        const enemyOut = Math.hypot(enemy.x - ARENA_X, enemy.y - ARENA_Y) > ARENA_RADIUS + enemy.radius;
        setTimeLeft(remaining);

        if (playerOut && enemyOut) finishRound("draw");
        else if (playerOut) finishRound("enemy");
        else if (enemyOut) finishRound("player");
        else if (remaining <= 0) finishRound("draw");
      }

      const scaleX = canvas.clientWidth / WIDTH;
      const scaleY = canvas.clientHeight / HEIGHT;
      const visualScale = (scaleX + scaleY) / 2;
      const positionVisual = (element: HTMLDivElement | null, bot: BotState) => {
        if (!element) return;
        element.style.left = `${bot.x * scaleX - BOT_VISUAL_SIZE / 2}px`;
        element.style.top = `${bot.y * scaleY - BOT_VISUAL_SIZE / 2}px`;
        element.style.transform = `rotate(${bot.angle}rad) scale(${visualScale})`;
        element.classList.toggle("stunned", now < bot.stunnedUntil);
      };
      positionVisual(playerVisualRef.current, player);
      positionVisual(enemyVisualRef.current, enemy);

      context.clearRect(0, 0, WIDTH, HEIGHT);
      context.fillStyle = "#0b1020";
      context.fillRect(0, 0, WIDTH, HEIGHT);
      context.strokeStyle = "rgba(184,255,61,.08)";
      context.lineWidth = 1;
      for (let x = 0; x < WIDTH; x += 32) {
        context.beginPath(); context.moveTo(x, 0); context.lineTo(x, HEIGHT); context.stroke();
      }
      for (let y = 0; y < HEIGHT; y += 32) {
        context.beginPath(); context.moveTo(0, y); context.lineTo(WIDTH, y); context.stroke();
      }
      context.beginPath();
      context.arc(ARENA_X, ARENA_Y, ARENA_RADIUS + 8, 0, Math.PI * 2);
      context.fillStyle = "#f2f0e8";
      context.fill();
      context.beginPath();
      context.arc(ARENA_X, ARENA_Y, ARENA_RADIUS, 0, Math.PI * 2);
      context.fillStyle = "#20283b";
      context.fill();
      context.strokeStyle = "#b8ff3d";
      context.lineWidth = 4;
      context.stroke();
      context.beginPath();
      context.arc(ARENA_X, ARENA_Y, 42, 0, Math.PI * 2);
      context.strokeStyle = "rgba(245,243,234,.18)";
      context.lineWidth = 2;
      context.stroke();
      context.beginPath();
      context.moveTo(ARENA_X, ARENA_Y - ARENA_RADIUS);
      context.lineTo(ARENA_X, ARENA_Y + ARENA_RADIUS);
      context.stroke();

      context.save();
      wheelTrailsRef.current = wheelTrailsRef.current.filter((point) => {
        point.life -= dt;
        if (point.life <= 0) return false;
        context.globalAlpha = Math.pow(point.life / point.maxLife, 1.5) * 0.52;
        context.fillStyle = point.color;
        context.beginPath();
        context.arc(point.x, point.y, 2.3, 0, Math.PI * 2);
        context.fill();
        return true;
      });
      collisionParticlesRef.current = collisionParticlesRef.current.filter((particle) => {
        particle.life -= dt;
        if (particle.life <= 0) return false;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vx *= Math.pow(0.07, dt);
        particle.vy *= Math.pow(0.07, dt);
        context.globalAlpha = particle.life / particle.maxLife;
        context.fillStyle = particle.color;
        context.beginPath();
        context.arc(particle.x, particle.y, particle.size * (particle.life / particle.maxLife), 0, Math.PI * 2);
        context.fill();
        return true;
      });
      context.restore();

      animationFrame = requestAnimationFrame(loop);
    };

    animationFrame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationFrame);
  }, [actionIntervalMs, battleType, finishRound, mode, performAction, playerAppearance, playerBotName, practice, roundSeconds]);

  useEffect(() => () => {
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
  }, []);

  const durationLabel = `${roundSeconds}s rounds`;
  const playerDiagnostics = diagnosticSnapshot(playerBotName, diagnosticTelemetry.player);
  const enemyDiagnostics = diagnosticSnapshot(battleType === "pvai" ? "Pebble" : "Rival", diagnosticTelemetry.enemy);

  return (
    <section className="battle-shell" aria-label="Playable Sumobot prototype">
      <div className="battle-topbar">
        <div>
          <span className="eyebrow">Local training match</span>
          <h2>{playerBotName} vs. {battleType === "pvai" ? "Pebble" : "Rival"}</h2>
        </div>
        <div className="battle-score" aria-label={`Score ${scores.player} to ${scores.enemy}`}>
          <strong>{scores.player}</strong><span>ROUND {round}/3</span><strong>{scores.enemy}</strong>
        </div>
        <div className="battle-actions-top"><div className={`battle-clock ${timeLeft <= 15 ? "danger" : ""}`}>{formatTime(timeLeft)}</div><button type="button" onClick={onExit}>Leave arena</button></div>
      </div>

      <div className="arena-frame">
        <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} aria-label="Circular Sumobot arena" />
        <div ref={playerVisualRef} className="arena-bot team-green"><BotVisual name={playerBotName} skill={playerSkill} appearance={playerAppearance} variant="arena" team="green" /><i className="direction-marker" /></div>
        <div ref={enemyVisualRef} className="arena-bot team-red"><BotVisual name={battleType === "pvai" ? "Pebble" : "Rival"} skill="stone" appearance={ENEMY_APPEARANCE} variant="arena" team="red" /><i className="direction-marker" /></div>
        <div className="battle-message">{message}</div>
        {hasStarted && <BotDiagnosticsPanels left={playerDiagnostics} right={enemyDiagnostics} temporary={practice} />}
        {!running && !hasStarted && (
          <button className="start-battle" type="button" onClick={startMatch}>
            Start best of 3
          </button>
        )}
        {!running && matchResult && matchTelemetry && matchReplay && <div className="match-finished-actions"><strong>{practice ? "Test complete" : "Match complete"}</strong><span>{practice ? "This test will not change rewards, rank, or script analytics." : "Claim the result to receive XP, gold, and campaign progress."}</span><div><button type="button" className="claim-reward" onClick={() => onMatchComplete(matchResult, matchTelemetry, matchReplay)}>{practice ? "Return to Lab" : "Claim rewards & exit"}</button><button type="button" onClick={startMatch}>Play again</button></div></div>}
      </div>

      <div className={`battle-controls arena-control-overlay ${mode} ${controlsOpen ? "open" : "collapsed"}`}>
        <div className="control-info">
          <button className="control-fold-toggle" type="button" aria-expanded={controlsOpen} aria-label={controlsOpen ? "Fold battle controls" : "Unfold battle controls"} onClick={() => setControlsOpen((value) => !value)}>{controlsOpen ? "v" : "^"}</button>
          <div><strong>{mode === "live" ? "Live Command" : mode === "script" ? "Script Pilot" : "Button Pilot"}</strong><small>{durationLabel} · Boost/Stone 3s · cooldown 10s</small></div>
          <code className={cooldowns.stun > 0 ? "stun-readout" : ""}>{cooldowns.stun > 0 ? `STUN ${cooldowns.stun.toFixed(1)}s` : lastAction}</code>
        </div>

        {mode === "buttons" && (
          <div className="action-pad">
            <button onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); startHolding("turnleft"); }} onPointerUp={() => stopHolding("turnleft")} onPointerCancel={() => stopHolding("turnleft")} onLostPointerCapture={() => stopHolding("turnleft")} aria-label="Hold to turn left">A<small>left</small></button>
            <button className="primary-action" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); startHolding("forward"); }} onPointerUp={() => stopHolding("forward")} onPointerCancel={() => stopHolding("forward")} onLostPointerCapture={() => stopHolding("forward")} aria-label="Hold to move forward">W<small>forward</small></button>
            <button onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); startHolding("turnright"); }} onPointerUp={() => stopHolding("turnright")} onPointerCancel={() => stopHolding("turnright")} onLostPointerCapture={() => stopHolding("turnright")} aria-label="Hold to turn right">D<small>right</small></button>
            <button className={`instant-action skill-action ${cooldowns.skill <= 0 && cooldowns.stone <= 0 ? "ready" : "cooling"}`} disabled={cooldowns.skill > 0 || cooldowns.stun > 0 || cooldowns.stone > 0} onClick={() => performAction("player", "skill")} aria-label="Use skill">Q<small>{cooldowns.skill > 0 ? `${cooldowns.skill.toFixed(1)}s` : cooldowns.stone > 0 ? "stone" : "ready"}</small></button>
            <button className={`instant-action dash-action ${cooldowns.dash <= 0 && cooldowns.stone <= 0 ? "ready" : "cooling"}`} disabled={cooldowns.dash > 0 || cooldowns.stun > 0 || cooldowns.stone > 0} onClick={() => performAction("player", "dash")} aria-label="Dash">E<small>{cooldowns.dash > 0 ? `${cooldowns.dash.toFixed(1)}s` : cooldowns.stone > 0 ? "stone" : "ready"}</small></button>
          </div>
        )}

        {mode === "live" && (
          <div className="terminal-panel">
            <button className="overlay-toggle" type="button" onClick={() => setTerminalOpen((open) => !open)}><span>{terminalOpen ? "v" : "^"}</span> Live terminal</button>
            {terminalOpen && <><div className="terminal-log" aria-live="polite">{commandLog.map((line, index) => <span key={`${line}-${index}`}>{line}</span>)}</div><div className="terminal-input"><span>&gt;</span><input value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => event.key === "Enter" && submitCommand()} placeholder="forward(0.5)" aria-label="Live command" /><button type="button" onClick={submitCommand}>Run</button></div></>}
          </div>
        )}

        {mode === "script" && (
          <div className="battle-script-panel">
            <button className="overlay-toggle" type="button" onClick={() => setScriptOpen((open) => !open)}><span>{scriptOpen ? "v" : "^"}</span> Temporary battle script</button>
            {scriptOpen && <><textarea value={temporaryScript} onChange={(event) => editTemporaryScript(event.target.value)} spellCheck={false} aria-label="Temporary in-battle script" /><div className="battle-script-apply"><small>{scriptStatus}</small><button type="button" onClick={applyTemporaryScript}>Apply</button></div></>}
          </div>
        )}
      </div>
    </section>
  );
}
