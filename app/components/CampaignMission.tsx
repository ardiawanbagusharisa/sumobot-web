"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BotAppearance } from "./BotVisual";
import { BotVisual } from "./BotVisual";
import type { CampaignAttempt, CampaignLevel } from "@/lib/game/campaign";
import { createScriptRuntime } from "@/lib/game/script-runtime";
import { GAME_RULES, type SkillType } from "@/lib/game/rules";

interface CampaignMissionProps {
  level: CampaignLevel;
  botName: string;
  botSkill: SkillType;
  botAppearance: BotAppearance;
  savedScript: string;
  previousBest?: { stars: number; seconds?: number; collisions?: number };
  onExit: () => void;
  onFinish: (attempt: CampaignAttempt) => void;
}

interface MobileUnit {
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  radius: number;
  thrustUntil: number;
  turnUntil: number;
  turnDirection: -1 | 0 | 1;
  dashReadyAt: number;
  skillReadyAt: number;
  skillUntil: number;
}

interface CollisionParticle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number; color: string }
interface TrailPoint { x: number; y: number; life: number; maxLife: number; color: string }

type MissionStatus = "briefing" | "running" | "success" | "failure";

const WIDTH = 760;
const HEIGHT = 440;
const ARENA_X = WIDTH / 2;
const ARENA_Y = HEIGHT / 2;
const ARENA_RADIUS = 188;
const BOT_SIZE = 58;

const ENEMY_APPEARANCE: BotAppearance = {
  wheel: "#4b1f2c",
  body: "#ff554f",
  face: "#fff1e8",
  accessory: "#ff554f",
  faceId: "face-focus",
  accessoryId: "acc-antenna",
};

function makeUnit(side: "player" | "enemy"): MobileUnit {
  return {
    x: side === "player" ? ARENA_X - 118 : ARENA_X + 112,
    y: ARENA_Y,
    angle: side === "player" ? 0 : Math.PI,
    vx: 0,
    vy: 0,
    radius: 25,
    thrustUntil: 0,
    turnUntil: 0,
    turnDirection: 0,
    dashReadyAt: 0,
    skillReadyAt: 0,
    skillUntil: 0,
  };
}

function normalizeAngle(angle: number) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function withinThresholds(
  target: CampaignLevel["star2"],
  metrics: { seconds: number; collisions: number; actions: number },
) {
  return (target.maxSeconds === undefined || metrics.seconds <= target.maxSeconds)
    && (target.maxCollisions === undefined || metrics.collisions <= target.maxCollisions)
    && (target.maxActions === undefined || metrics.actions <= target.maxActions);
}

function scoreAttempt(level: CampaignLevel, completed: boolean, seconds: number, collisions: number, actions: number) {
  if (!completed) return 0;
  return Math.max(100, Math.round(1400 - seconds * 8 - collisions * 45 - actions * 2 + level.chapter * 30));
}

export function CampaignMission({ level, botName, botSkill, botAppearance, savedScript, previousBest, onExit, onFinish }: CampaignMissionProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerVisualRef = useRef<HTMLDivElement>(null);
  const enemyVisualRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef(makeUnit("player"));
  const enemyRef = useRef(makeUnit("enemy"));
  const runningRef = useRef(false);
  const startedAtRef = useRef(0);
  const lastFrameRef = useRef(0);
  const nextPlayerDecisionRef = useRef(0);
  const nextEnemyDecisionRef = useRef(0);
  const nextHudRef = useRef(0);
  const checkpointRef = useRef(0);
  const collisionsRef = useRef(0);
  const actionsRef = useRef(0);
  const hintsRef = useRef(0);
  const lastObstacleCollisionRef = useRef(0);
  const lastImpactVfxAtRef = useRef(0);
  const collisionParticlesRef = useRef<CollisionParticle[]>([]);
  const wheelTrailsRef = useRef<TrailPoint[]>([]);
  const nextTrailAtRef = useRef(0);
  const commandQueueRef = useRef<Array<{ name: string; duration?: number }>>([]);
  const heldRef = useRef(new Set<"forward" | "turnleft" | "turnright">());
  const runtimeRef = useRef<ReturnType<typeof createScriptRuntime> | null>(null);
  const finishGuardRef = useRef(false);

  const [status, setStatus] = useState<MissionStatus>("briefing");
  const [message, setMessage] = useState("Review the mission briefing");
  const [timeLeft, setTimeLeft] = useState(level.durationSeconds);
  const [checkpoints, setCheckpoints] = useState(0);
  const [collisions, setCollisions] = useState(0);
  const [actions, setActions] = useState(0);
  const [command, setCommand] = useState("");
  const [commandLog, setCommandLog] = useState<string[]>(["Command deck online."]);
  const [script, setScript] = useState(level.starterSource ?? savedScript);
  const [scriptStatus, setScriptStatus] = useState(level.mode === "script" ? "Starter commented · remove // markers before submitting" : "Starter program ready");
  const [revealedHints, setRevealedHints] = useState(0);
  const [result, setResult] = useState<CampaignAttempt | null>(null);

  const performAction = useCallback((unit: MobileUnit, name: string, duration = 0.2, countPlayer = false) => {
    if (!runningRef.current) return false;
    const now = performance.now();
    const safeDuration = Math.min(3, Math.max(0.1, duration)) * 1000;
    const unitSkill: SkillType = countPlayer ? botSkill : "stone";
    if (name === "forward") unit.thrustUntil = Math.max(unit.thrustUntil, now + safeDuration);
    else if (name === "turnleft" || name === "turnright") {
      unit.turnDirection = name === "turnleft" ? -1 : 1;
      unit.turnUntil = now + safeDuration;
    } else if (name === "dash") {
      if (now < unit.dashReadyAt) return false;
      const boost = now < unit.skillUntil && unitSkill === "boost" ? GAME_RULES.skills.boostMultiplier : 1;
      unit.vx += Math.cos(unit.angle) * GAME_RULES.dash.force * boost;
      unit.vy += Math.sin(unit.angle) * GAME_RULES.dash.force * boost;
      unit.dashReadyAt = now + GAME_RULES.dash.cooldownSeconds * 1000;
    } else if (name === "skill") {
      if (now < unit.skillReadyAt) return false;
      unit.skillUntil = now + GAME_RULES.skills.durationSeconds * 1000;
      unit.skillReadyAt = now + GAME_RULES.skills.cooldownSeconds * 1000;
      if (unitSkill === "stone") { unit.vx = 0; unit.vy = 0; }
    } else return false;
    if (countPlayer) {
      actionsRef.current += 1;
      setActions(actionsRef.current);
    }
    return true;
  }, [botSkill]);

  const finishMission = useCallback((completed: boolean, reason: string) => {
    if (finishGuardRef.current) return;
    finishGuardRef.current = true;
    runningRef.current = false;
    const seconds = Math.min(level.durationSeconds, Math.max(0.1, (performance.now() - startedAtRef.current) / 1000));
    const metrics = { seconds, collisions: collisionsRef.current, actions: actionsRef.current };
    let stars: 0 | 1 | 2 | 3 = completed ? 1 : 0;
    if (completed && withinThresholds(level.star2, metrics)) stars = 2;
    if (completed && withinThresholds(level.star3, metrics)) stars = 3;
    const attempt: CampaignAttempt = {
      levelId: level.id,
      completed,
      stars,
      score: scoreAttempt(level, completed, seconds, collisionsRef.current, actionsRef.current),
      durationSeconds: seconds,
      collisions: collisionsRef.current,
      actions: actionsRef.current,
      checkpoints: checkpointRef.current,
      hintsViewed: hintsRef.current,
      code: level.mode === "script" ? script : undefined,
    };
    setTimeLeft(Math.max(0, level.durationSeconds - seconds));
    setResult(attempt);
    setStatus(completed ? "success" : "failure");
    setMessage(reason);
    onFinish(attempt);
  }, [level, onFinish, script]);

  const compileScript = useCallback(() => {
    try {
      runtimeRef.current = createScriptRuntime(script);
      runtimeRef.current.reset();
      setScriptStatus("Program compiled · ready to run");
      return true;
    } catch (error) {
      runtimeRef.current = null;
      setScriptStatus(error instanceof Error ? error.message : "Program could not be compiled");
      return false;
    }
  }, [script]);

  const startMission = useCallback(() => {
    playerRef.current = makeUnit("player");
    enemyRef.current = makeUnit("enemy");
    checkpointRef.current = 0;
    collisionsRef.current = 0;
    actionsRef.current = 0;
    lastObstacleCollisionRef.current = 0;
    lastImpactVfxAtRef.current = 0;
    collisionParticlesRef.current = [];
    wheelTrailsRef.current = [];
    nextTrailAtRef.current = 0;
    commandQueueRef.current = [];
    finishGuardRef.current = false;
    const now = performance.now();
    startedAtRef.current = now;
    lastFrameRef.current = now;
    nextPlayerDecisionRef.current = now;
    nextEnemyDecisionRef.current = now;
    nextHudRef.current = now;
    runningRef.current = true;
    setStatus("running");
    setResult(null);
    setTimeLeft(level.durationSeconds);
    setCheckpoints(0);
    setCollisions(0);
    setActions(0);
    setMessage(`${level.callSign} · mission running`);
  }, [level]);

  const submitScript = useCallback(() => {
    if (!compileScript()) return;
    startMission();
  }, [compileScript, startMission]);

  const returnToScriptEditor = useCallback(() => {
    runningRef.current = false;
    runtimeRef.current = null;
    setStatus("briefing");
    setResult(null);
    setMessage("Edit the program, then submit it to begin");
    setScriptStatus("Program stopped · submit again after editing");
  }, []);

  const queueCommands = useCallback(() => {
    const values = command.split(";").map((item) => item.trim().toLowerCase()).filter(Boolean);
    if (!values.length) return;
    const parsed: Array<{ name: string; duration?: number }> = [];
    for (const value of values) {
      const timed = value.match(/^(forward|turnleft|turnright)\((\d+(?:\.\d+)?)\)$/);
      const instant = value.match(/^(dash|skill)\(\)$/);
      if (timed) parsed.push({ name: timed[1], duration: Number(timed[2]) });
      else if (instant) parsed.push({ name: instant[1] });
      else {
        setCommandLog((items) => [...items.slice(-4), `> ${value}`, "Command rejected. Use help for syntax."]);
        return;
      }
    }
    commandQueueRef.current.push(...parsed);
    setCommandLog((items) => [...items.slice(-4), `> ${values.join("; ")}`, `${parsed.length} command${parsed.length === 1 ? "" : "s"} queued.`]);
    setCommand("");
  }, [command]);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (level.mode !== "buttons" || !runningRef.current) return;
      if (event.key.toLowerCase() === "w") heldRef.current.add("forward");
      if (event.key.toLowerCase() === "a") heldRef.current.add("turnleft");
      if (event.key.toLowerCase() === "d") heldRef.current.add("turnright");
      if (event.key.toLowerCase() === "e") performAction(playerRef.current, "dash", 0.2, true);
      if (event.key.toLowerCase() === "q") performAction(playerRef.current, "skill", 0.2, true);
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "w") heldRef.current.delete("forward");
      if (event.key.toLowerCase() === "a") heldRef.current.delete("turnleft");
      if (event.key.toLowerCase() === "d") heldRef.current.delete("turnright");
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    return () => { window.removeEventListener("keydown", keyDown); window.removeEventListener("keyup", keyUp); };
  }, [level.mode, performAction]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    let frame = 0;

    const spawnImpactVfx = (x: number, y: number) => {
      for (let index = 0; index < 12; index += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 65 + Math.random() * 135;
        const life = 0.28 + Math.random() * 0.28;
        collisionParticlesRef.current.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life, maxLife: life,
          size: 1.5 + Math.random() * 3,
          color: index % 3 === 0 ? "#f5f3ea" : index % 2 === 0 ? "#b8ff3d" : "#ff554f",
        });
      }
    };

    const updateUnit = (unit: MobileUnit, dt: number, now: number, skill: SkillType) => {
      if (skill === "stone" && now < unit.skillUntil) { unit.vx = 0; unit.vy = 0; return; }
      if (now < unit.turnUntil) unit.angle = normalizeAngle(unit.angle + unit.turnDirection * 2.8 * dt);
      if (now < unit.thrustUntil) {
        const multiplier = skill === "boost" && now < unit.skillUntil ? GAME_RULES.skills.boostMultiplier : 1;
        unit.vx += Math.cos(unit.angle) * 325 * multiplier * dt;
        unit.vy += Math.sin(unit.angle) * 325 * multiplier * dt;
      }
      const speed = Math.hypot(unit.vx, unit.vy);
      if (speed > 350) { unit.vx = unit.vx / speed * 350; unit.vy = unit.vy / speed * 350; }
      unit.vx *= Math.pow(0.18, dt);
      unit.vy *= Math.pow(0.18, dt);
      unit.x += unit.vx * dt;
      unit.y += unit.vy * dt;
    };

    const collideObstacles = (unit: MobileUnit, now: number, count: boolean) => {
      for (const obstacle of level.obstacles) {
        const closestX = Math.max(obstacle.x, Math.min(unit.x, obstacle.x + obstacle.width));
        const closestY = Math.max(obstacle.y, Math.min(unit.y, obstacle.y + obstacle.height));
        const dx = unit.x - closestX;
        const dy = unit.y - closestY;
        const distance = Math.hypot(dx, dy);
        if (distance >= unit.radius) continue;
        const nx = distance > 0.01 ? dx / distance : unit.x < obstacle.x + obstacle.width / 2 ? -1 : 1;
        const ny = distance > 0.01 ? dy / distance : 0;
        const overlap = unit.radius - distance + 1;
        unit.x += nx * overlap;
        unit.y += ny * overlap;
        unit.vx *= -0.28;
        unit.vy *= -0.28;
        if (now - lastImpactVfxAtRef.current > 240) {
          lastImpactVfxAtRef.current = now;
          spawnImpactVfx(closestX, closestY);
        }
        if (count && now - lastObstacleCollisionRef.current > 420) {
          lastObstacleCollisionRef.current = now;
          collisionsRef.current += 1;
        }
      }
    };

    const enemyDecision = (now: number) => {
      const enemy = enemyRef.current;
      const player = playerRef.current;
      const distanceFromCenter = Math.hypot(enemy.x - ARENA_X, enemy.y - ARENA_Y);
      let targetAngle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
      if (distanceFromCenter > ARENA_RADIUS * 0.76) targetAngle = Math.atan2(ARENA_Y - enemy.y, ARENA_X - enemy.x);
      if (level.enemy === "dodger" && Math.hypot(player.x - enemy.x, player.y - enemy.y) < 115) targetAngle += Math.PI / 2;
      const difference = normalizeAngle(targetAngle - enemy.angle);
      if (difference < -0.16) performAction(enemy, "turnleft", 0.12);
      else if (difference > 0.16) performAction(enemy, "turnright", 0.12);
      else if (level.enemy === "guard" && Math.hypot(player.x - enemy.x, player.y - enemy.y) < 100) performAction(enemy, "skill");
      else if (level.enemy === "rusher" && Math.hypot(player.x - enemy.x, player.y - enemy.y) < 145) performAction(enemy, "dash");
      else performAction(enemy, "forward", level.enemy === "passive" ? 0.12 : 0.22);
      nextEnemyDecisionRef.current = now + (level.enemyTickMs ?? 700);
    };

    const playerDecision = (now: number) => {
      const player = playerRef.current;
      if (level.mode === "buttons") heldRef.current.forEach((name) => performAction(player, name, level.playerTickMs / 1000 + 0.06, true));
      if (level.mode === "live") {
        const next = commandQueueRef.current.shift();
        if (next) performAction(player, next.name, next.duration, true);
      }
      if (level.mode === "script" && runtimeRef.current) {
        const target = level.checkpoints[Math.min(checkpointRef.current, Math.max(0, level.checkpoints.length - 1))] ?? { x: enemyRef.current.x, y: enemyRef.current.y };
        const enemy = enemyRef.current;
        const angleToCenter = normalizeAngle(Math.atan2(ARENA_Y - player.y, ARENA_X - player.x) - player.angle) * 180 / Math.PI;
        const enemyAngle = normalizeAngle(Math.atan2(enemy.y - player.y, enemy.x - player.x) - player.angle) * 180 / Math.PI;
        const targetAngle = normalizeAngle(Math.atan2(target.y - player.y, target.x - player.x) - player.angle) * 180 / Math.PI;
        try {
          const input = { game: {
            elapsed: Math.max(0, (now - startedAtRef.current) / 1000),
            arena: { radius: ARENA_RADIUS },
            self: { distanceFromCenter: Math.hypot(player.x - ARENA_X, player.y - ARENA_Y), angleToCenter, dashReady: now >= player.dashReadyAt, skillReady: now >= player.skillReadyAt, skill: botSkill },
            enemy: { distance: Math.hypot(enemy.x - player.x, enemy.y - player.y) / 80, angle: enemyAngle, stunned: false, stone: now < enemy.skillUntil },
            target: { distance: Math.hypot(target.x - player.x, target.y - player.y) / 80, angle: targetAngle, index: checkpointRef.current, remaining: Math.max(0, level.checkpoints.length - checkpointRef.current) },
            mission: { checkpoints: checkpointRef.current, totalCheckpoints: level.checkpoints.length, timeLeft: Math.max(0, level.durationSeconds - (now - startedAtRef.current) / 1000) },
          } };
          const action = runtimeRef.current.decide(input);
          if (action) performAction(player, action.name, action.duration, true);
          setScriptStatus("Program running");
        } catch (error) {
          setScriptStatus(error instanceof Error ? error.message : "Runtime error");
        }
      }
      nextPlayerDecisionRef.current = now + level.playerTickMs;
    };

    const loop = (now: number) => {
      const dt = Math.min(0.034, Math.max(0.001, (now - lastFrameRef.current) / 1000));
      lastFrameRef.current = now;
      const player = playerRef.current;
      const enemy = enemyRef.current;
      if (runningRef.current) {
        if (now >= nextPlayerDecisionRef.current) playerDecision(now);
        if (level.enemy && now >= nextEnemyDecisionRef.current) enemyDecision(now);
        updateUnit(player, dt, now, botSkill);
        updateUnit(enemy, dt, now, "stone");
        collideObstacles(player, now, true);
        if (level.enemy) collideObstacles(enemy, now, false);

        if (now >= nextTrailAtRef.current) {
          const addWheelTrails = (unit: MobileUnit, color: string) => {
            if (Math.hypot(unit.vx, unit.vy) < 18) return;
            const offsetX = -Math.sin(unit.angle) * 18;
            const offsetY = Math.cos(unit.angle) * 18;
            wheelTrailsRef.current.push(
              { x: unit.x + offsetX, y: unit.y + offsetY, life: 0.55, maxLife: 0.55, color },
              { x: unit.x - offsetX, y: unit.y - offsetY, life: 0.55, maxLife: 0.55, color },
            );
          };
          addWheelTrails(player, "#b8ff3d");
          if (level.enemy) addWheelTrails(enemy, "#ff554f");
          wheelTrailsRef.current = wheelTrailsRef.current.slice(-180);
          nextTrailAtRef.current = now + 42;
        }

        if (level.enemy) {
          const dx = enemy.x - player.x;
          const dy = enemy.y - player.y;
          const distance = Math.max(0.01, Math.hypot(dx, dy));
          const minimum = player.radius + enemy.radius;
          if (distance < minimum) {
            const nx = dx / distance;
            const ny = dy / distance;
            if (now - lastImpactVfxAtRef.current > 280) {
              lastImpactVfxAtRef.current = now;
              spawnImpactVfx((player.x + enemy.x) / 2, (player.y + enemy.y) / 2);
            }
            const overlap = minimum - distance;
            player.x -= nx * overlap * 0.5;
            player.y -= ny * overlap * 0.5;
            enemy.x += nx * overlap * 0.5;
            enemy.y += ny * overlap * 0.5;
            const impact = Math.max(100, Math.hypot(player.vx - enemy.vx, player.vy - enemy.vy));
            enemy.vx += nx * impact * 0.72;
            enemy.vy += ny * impact * 0.72;
            player.vx -= nx * impact * 0.28;
            player.vy -= ny * impact * 0.28;
            if (now - lastObstacleCollisionRef.current > 420) {
              lastObstacleCollisionRef.current = now;
              collisionsRef.current += 1;
            }
          }
        }

        const activeCheckpoint = level.checkpoints[checkpointRef.current];
        if (activeCheckpoint && Math.hypot(player.x - activeCheckpoint.x, player.y - activeCheckpoint.y) < player.radius + 24) {
          checkpointRef.current += 1;
          setCheckpoints(checkpointRef.current);
          setMessage(`Checkpoint ${checkpointRef.current}/${level.checkpoints.length} secured`);
          if (checkpointRef.current >= level.checkpoints.length && !level.enemy && level.kind !== "survival") finishMission(true, "Mission objectives complete");
        }

        const playerOut = Math.hypot(player.x - ARENA_X, player.y - ARENA_Y) > ARENA_RADIUS + player.radius;
        const enemyOut = Math.hypot(enemy.x - ARENA_X, enemy.y - ARENA_Y) > ARENA_RADIUS + enemy.radius;
        const elapsed = (now - startedAtRef.current) / 1000;
        const remaining = level.durationSeconds - elapsed;
        if (playerOut) finishMission(false, "Unit left the mission boundary");
        else if (level.kind === "duel" && enemyOut) finishMission(true, "Opponent removed from the arena");
        else if (level.collisionLimit !== undefined && collisionsRef.current > level.collisionLimit) finishMission(false, "Collision limit exceeded");
        else if (remaining <= 0) finishMission(level.kind === "survival", level.kind === "survival" ? "Survival objective complete" : "Mission timer expired");
        if (now >= nextHudRef.current) {
          setTimeLeft(Math.max(0, remaining));
          setCollisions(collisionsRef.current);
          setActions(actionsRef.current);
          nextHudRef.current = now + 120;
        }
      }

      const position = (element: HTMLDivElement | null, unit: MobileUnit, skill: SkillType) => {
        if (!element || !canvas) return;
        const sx = canvas.clientWidth / WIDTH;
        const sy = canvas.clientHeight / HEIGHT;
        element.style.left = `${unit.x * sx - BOT_SIZE / 2}px`;
        element.style.top = `${unit.y * sy - BOT_SIZE / 2}px`;
        element.style.transform = `rotate(${unit.angle}rad) scale(${(sx + sy) / 2})`;
        element.classList.toggle("stone-active", skill === "stone" && now < unit.skillUntil);
        element.classList.toggle("boost-active", skill === "boost" && now < unit.skillUntil);
      };
      position(playerVisualRef.current, player, botSkill);
      position(enemyVisualRef.current, enemy, "stone");

      context.clearRect(0, 0, WIDTH, HEIGHT);
      context.fillStyle = "#0b1020";
      context.fillRect(0, 0, WIDTH, HEIGHT);
      context.strokeStyle = "rgba(184,255,61,.075)";
      context.lineWidth = 1;
      for (let x = 0; x < WIDTH; x += 32) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, HEIGHT); context.stroke(); }
      for (let y = 0; y < HEIGHT; y += 32) { context.beginPath(); context.moveTo(0, y); context.lineTo(WIDTH, y); context.stroke(); }
      context.beginPath(); context.arc(ARENA_X, ARENA_Y, ARENA_RADIUS + 7, 0, Math.PI * 2); context.fillStyle = "#f2f0e8"; context.fill();
      context.beginPath(); context.arc(ARENA_X, ARENA_Y, ARENA_RADIUS, 0, Math.PI * 2); context.fillStyle = "#20283b"; context.fill(); context.strokeStyle = "#b8ff3d"; context.lineWidth = 4; context.stroke();
      context.save();
      wheelTrailsRef.current = wheelTrailsRef.current.filter((point) => {
        point.life -= dt;
        if (point.life <= 0) return false;
        context.globalAlpha = Math.pow(point.life / point.maxLife, 1.5) * 0.52;
        context.fillStyle = point.color;
        context.beginPath(); context.arc(point.x, point.y, 2.3, 0, Math.PI * 2); context.fill();
        return true;
      });
      context.restore();
      level.obstacles.forEach((obstacle) => {
        context.fillStyle = "#596176"; context.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
        context.strokeStyle = "#919bad"; context.lineWidth = 2; context.strokeRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
      });
      level.checkpoints.forEach((point, index) => {
        const active = index === checkpointRef.current;
        const done = index < checkpointRef.current;
        context.beginPath(); context.arc(point.x, point.y, active ? 24 : 18, 0, Math.PI * 2);
        context.fillStyle = done ? "rgba(184,255,61,.16)" : active ? "rgba(93,224,230,.28)" : "rgba(255,255,255,.06)"; context.fill();
        context.strokeStyle = done ? "#b8ff3d" : active ? "#5de0e6" : "#778196"; context.lineWidth = active ? 3 : 2; context.stroke();
        context.fillStyle = active ? "#5de0e6" : done ? "#b8ff3d" : "#9ba4b5"; context.font = "900 11px monospace"; context.textAlign = "center"; context.fillText(`${index + 1}`, point.x, point.y + 4);
      });
      context.save();
      collisionParticlesRef.current = collisionParticlesRef.current.filter((particle) => {
        particle.life -= dt;
        if (particle.life <= 0) return false;
        particle.x += particle.vx * dt; particle.y += particle.vy * dt;
        particle.vx *= Math.pow(0.07, dt); particle.vy *= Math.pow(0.07, dt);
        context.globalAlpha = particle.life / particle.maxLife;
        context.fillStyle = particle.color;
        context.beginPath(); context.arc(particle.x, particle.y, particle.size * (particle.life / particle.maxLife), 0, Math.PI * 2); context.fill();
        return true;
      });
      context.restore();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [botSkill, finishMission, level, performAction]);

  const revealHint = () => {
    const next = Math.min(level.hints.length, revealedHints + 1);
    setRevealedHints(next);
    hintsRef.current = Math.max(hintsRef.current, next);
  };

  return (
    <section className="campaign-mission-shell" aria-label={`${level.title} campaign mission`}>
      <header className="mission-command-header">
        <button type="button" onClick={onExit}>← Campaign path</button>
        <div><span>CH {level.chapter} · MISSION {level.order}</span><strong>{level.title}</strong></div>
        <div className="mission-live-stats"><span><small>TIME</small>{Math.ceil(timeLeft)}s</span><span><small>POINTS</small>{checkpoints}/{level.checkpoints.length}</span><span><small>CONTACT</small>{collisions}</span><span><small>ACTIONS</small>{actions}</span></div>
      </header>

      <div className="campaign-mission-layout">
        <div className="mission-arena-panel">
          <div className="mission-canvas-wrap">
            <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} />
            <div className="mission-unit player team-green" ref={playerVisualRef}><BotVisual name={botName} skill={botSkill} appearance={botAppearance} variant="arena" team="green" /><i className="mission-direction-marker" /></div>
            {level.enemy && <div className="mission-unit enemy team-red" ref={enemyVisualRef}><BotVisual name="Training rival" skill="stone" appearance={ENEMY_APPEARANCE} variant="arena" team="red" /><i className="mission-direction-marker" /></div>}
            {status !== "running" && <div className={`mission-state-card ${status}`}>
              {status === "briefing" ? <><span className="eyebrow">{level.callSign} protocol</span><h2>{level.briefing}</h2><p>{level.outcome}</p>{level.mode === "script" ? <p><strong>Remove the // comment markers, then select Submit & run below.</strong></p> : <button type="button" onClick={startMission}>Start mission →</button>}</> : <><span className="eyebrow">{status === "success" ? "Mission complete" : "Training result"}</span><h2>{message}</h2>{result && <div className="mission-result-stars" aria-label={`${result.stars} stars`}><strong>{"★".repeat(result.stars)}{"☆".repeat(3 - result.stars)}</strong><span>{Math.round(result.durationSeconds)}s · {result.collisions} contacts · {result.actions} actions</span></div>}<div><button type="button" onClick={level.mode === "script" ? returnToScriptEditor : startMission}>{level.mode === "script" ? "Edit & resubmit" : "Run again"}</button><button type="button" onClick={onExit}>Return to path</button></div></>}
            </div>}
          </div>
          <div className="mission-status-strip"><strong>{message}</strong><span>{level.playerTickMs} ms pilot tick{level.enemyTickMs ? ` · ${level.enemyTickMs} ms rival tick` : ""}</span></div>

          {level.mode === "buttons" && <div className="campaign-control-pad">
            {(["turnleft", "forward", "turnright"] as const).map((name) => <button key={name} type="button" onPointerDown={() => heldRef.current.add(name)} onPointerUp={() => heldRef.current.delete(name)} onPointerLeave={() => heldRef.current.delete(name)}><strong>{name === "forward" ? "W" : name === "turnleft" ? "A" : "D"}</strong><small>{name.replace("turn", "")}</small></button>)}
            <button type="button" onClick={() => performAction(playerRef.current, "skill", 0.2, true)}><strong>Q</strong><small>skill</small></button>
            <button type="button" onClick={() => performAction(playerRef.current, "dash", 0.2, true)}><strong>E</strong><small>dash</small></button>
          </div>}

          {level.mode === "live" && <div className="campaign-terminal">
            <div>{commandLog.map((line, index) => <span key={`${line}-${index}`}>{line}</span>)}</div>
            <label><span>&gt;</span><input value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => event.key === "Enter" && queueCommands()} placeholder="forward(0.5); turnleft(0.3)" /><button type="button" onClick={queueCommands}>Queue</button></label>
          </div>}

          {level.mode === "script" && <div className="campaign-code-panel">
            <div><span>MISSION PROGRAM</span><strong className={scriptStatus.includes("compiled") || scriptStatus.includes("running") ? "ready" : ""}>{scriptStatus}</strong></div>
            <textarea value={script} onChange={(event) => { setScript(event.target.value); setScriptStatus("Changes waiting to submit"); }} disabled={status === "running"} spellCheck={false} aria-label="Campaign mission program" />
            <button type="button" onClick={submitScript} disabled={status === "running"}>{status === "running" ? "Program running" : "Submit & run"}</button>
          </div>}
        </div>

        <aside className="mission-brief-panel">
          <span className="eyebrow">Training objective</span>
          <h2>{level.concept}</h2>
          <p>{level.outcome}</p>
          <div className="mission-objectives">{level.objectives.map((objective, index) => <span key={objective} className={index < checkpoints ? "done" : ""}><i>{index + 1}</i>{objective}</span>)}</div>
          <div className="mission-star-criteria"><span><b>★</b> Complete the core objective</span><span><b>★★</b> {level.star2.label}</span><span><b>★★★</b> {level.star3.label}</span></div>
          <div className="mission-reward"><small>FIRST COMPLETION</small><strong>{level.reward.xp} XP · {level.reward.gold} gold</strong></div>
          <div className="mission-hints"><div><span>Guidance channel</span><button type="button" onClick={revealHint} disabled={revealedHints >= level.hints.length}>{revealedHints ? "Next hint" : "Request hint"}</button></div>{level.hints.slice(0, revealedHints).map((hint, index) => <p key={hint}><b>H{index + 1}</b>{hint}</p>)}</div>
          {previousBest && <div className="mission-personal-best"><small>PERSONAL BEST</small><strong>{previousBest.stars}★ {previousBest.seconds ? `· ${Math.round(previousBest.seconds)}s` : ""}</strong><span>{previousBest.collisions ?? 0} contacts</span></div>}
        </aside>
      </div>
    </section>
  );
}

