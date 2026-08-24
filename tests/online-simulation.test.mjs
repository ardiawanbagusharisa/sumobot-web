import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadCommonJs(path, requireModule) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", compiled)(requireModule, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

const rules = loadCommonJs("../lib/game/rules.ts", () => { throw new Error("rules.ts has no runtime imports"); });
const runtime = loadCommonJs("../lib/game/script-runtime.ts", (request) => {
  if (request === "./rules" || request === "@/lib/game/rules") return rules;
  throw new Error(`Unexpected runtime module ${request}`);
});
const simulation = loadCommonJs("../lib/online/simulation.ts", (request) => {
  if (request === "@/lib/game/rules") return rules;
  if (request === "@/lib/game/script-runtime") return runtime;
  throw new Error(`Unexpected simulation module ${request}`);
});

const appearance = { wheel: "#111", body: "#222", face: "#333", accessory: "#444" };
const bot = (id, skill = "boost") => ({ id, name: id, skill, scriptSource: rules.PRIMITIVE_SCRIPT, appearance });

test("game tick presets and custom values are normalized consistently", () => {
  assert.equal(rules.normalizeActionIntervalMs(100), 100);
  assert.equal(rules.normalizeActionIntervalMs(250), 250);
  assert.equal(rules.normalizeActionIntervalMs(500), 500);
  assert.equal(rules.normalizeActionIntervalMs("173"), 173);
  assert.equal(rules.normalizeActionIntervalMs(12), 50);
  assert.equal(rules.normalizeActionIntervalMs(9_999), 3000);
  assert.equal(rules.normalizeActionIntervalMs("invalid", 500), 500);
});

test("authoritative simulation accepts actions and records replay frames", () => {
  const startedAt = 10_000;
  const state = simulation.createOnlineMatch(startedAt, { playerId: "p1", bot: bot("Rivet") }, { playerId: "p2", bot: bot("Relay", "stone") });
  assert.equal(simulation.performOnlineAction(state, "host", "forward", .5, 100), true);
  simulation.advanceOnlineMatch(state, startedAt + 1000, "buttons", 60, 100);
  assert.ok(state.bots.host.x > simulation.ONLINE_ARENA.x - 115);
  assert.ok(state.replay.length >= 4);
  assert.ok(state.bots.host.telemetry.actionCounts.forward >= 1);
});

test("realtime button controls are sampled at each configured game tick", () => {
  for (const actionIntervalMs of [100, 250, 500, 173]) {
    const startedAt = 12_000;
    const state = simulation.createOnlineMatch(startedAt, { playerId: "p1", bot: bot("Rivet") }, { playerId: "p2", bot: bot("Relay") });
    const originalX = state.bots.host.x;
    simulation.advanceOnlineMatch(
      state,
      startedAt + 1_000,
      "buttons",
      60,
      actionIntervalMs,
      { host: { forward: true, turn: 0 }, guest: { forward: false, turn: 0 } },
    );

    assert.equal(state.bots.host.telemetry.actionCounts.forward, Math.floor(1_000 / actionIntervalMs) + 1, `${actionIntervalMs}ms tick count`);
    assert.ok(state.bots.host.x > originalX, `${actionIntervalMs}ms held input should move smoothly between decisions`);
  }
});

test("manual and live actions cannot bypass the configured game tick", () => {
  const startedAt = 14_000;
  const state = simulation.createOnlineMatch(startedAt, { playerId: "p1", bot: bot("Rivet") }, { playerId: "p2", bot: bot("Relay") });
  const first = simulation.performOnlineActionDetailed(state, "host", "dash", undefined, 250, { sequence: 1 });
  state.simulatedAt = startedAt + 249;
  const early = simulation.performOnlineActionDetailed(state, "host", "skill", undefined, 250, { sequence: 2 });
  state.simulatedAt = startedAt + 250;
  const onTick = simulation.performOnlineActionDetailed(state, "host", "skill", undefined, 250, { sequence: 3 });
  assert.equal(first.accepted, true);
  assert.deepEqual({ accepted: early.accepted, reason: early.reason }, { accepted: false, reason: "interval" });
  assert.equal(onTick.accepted, true);
});

test("rapid timed inputs are queued and acknowledged in order", () => {
  const startedAt = 15_000;
  const state = simulation.createOnlineMatch(startedAt, { playerId: "p1", bot: bot("Rivet") }, { playerId: "p2", bot: bot("Relay") });
  const first = simulation.performOnlineActionDetailed(state, "host", "forward", .3, 200, { queueIfThrottled: true, sequence: 1 });
  const second = simulation.performOnlineActionDetailed(state, "host", "turnright", .2, 200, { queueIfThrottled: true, sequence: 2 });

  assert.deepEqual({ accepted: first.accepted, queued: first.queued, sequence: first.sequence }, { accepted: true, queued: false, sequence: 1 });
  assert.deepEqual({ accepted: second.accepted, queued: second.queued, sequence: second.sequence }, { accepted: true, queued: true, sequence: 2 });
  assert.equal(state.bots.host.pendingActions.length, 1);

  simulation.advanceOnlineMatch(state, startedAt + 450, "buttons", 60, 200);
  assert.equal(state.bots.host.pendingActions.length, 0);
  assert.equal(state.bots.host.telemetry.actionCounts.turnright, 1);
});

test("script agents decide exactly on preset and custom game ticks", () => {
  const turningBot = (id) => ({ ...bot(id), scriptSource: "function decide(game) { return turnright(0.1); }" });
  for (const actionIntervalMs of [100, 250, 500, 173]) {
    const startedAt = 16_000;
    const state = simulation.createOnlineMatch(
      startedAt,
      { playerId: "p1", bot: turningBot("Rivet") },
      { playerId: "p2", bot: turningBot("Relay") },
    );
    simulation.advanceOnlineMatch(state, startedAt + 1_000, "script", 60, actionIntervalMs);
    const expected = Math.floor(1_000 / actionIntervalMs) + 1;
    assert.equal(state.bots.host.telemetry.actionCounts.turnright, expected, `${actionIntervalMs}ms host script count`);
    assert.equal(state.bots.guest.telemetry.actionCounts.turnright, expected, `${actionIntervalMs}ms guest script count`);
  }
});

test("script mode executes steering decisions and reports runtime errors", () => {
  const startedAt = 17_000;
  const state = simulation.createOnlineMatch(startedAt, { playerId: "p1", bot: bot("Rivet") }, { playerId: "p2", bot: bot("Relay") });
  state.bots.guest.y += 100;
  simulation.advanceOnlineMatch(state, startedAt + 350, "script", 60, 100);
  assert.ok(state.bots.host.telemetry.actionCounts.turnright > 0);
  assert.equal(state.bots.host.scriptError, null);

  state.bots.host.scriptSource = "function decide(game) { return missing(); }";
  state.bots.host.nextDecisionAt = state.simulatedAt;
  simulation.advanceOnlineMatch(state, state.simulatedAt + 150, "script", 60, 100);
  assert.match(state.bots.host.scriptError ?? "", /Unknown function/);
});

test("authoritative collisions stun and disorient bots like local gameplay", () => {
  const startedAt = 18_000;
  const state = simulation.createOnlineMatch(startedAt, { playerId: "p1", bot: bot("Rivet") }, { playerId: "p2", bot: bot("Relay") });
  state.bots.host.x = simulation.ONLINE_ARENA.x - 20;
  state.bots.guest.x = simulation.ONLINE_ARENA.x + 20;
  state.bots.host.vx = 180;
  state.bots.guest.vx = -120;
  state.bots.host.thrustUntil = startedAt + 1_000;
  state.bots.guest.turnUntil = startedAt + 1_000;

  simulation.advanceOnlineMatch(state, startedAt + 50, "script", 60, 100);

  assert.ok(state.bots.host.stunnedUntil > state.simulatedAt);
  assert.ok(state.bots.guest.stunnedUntil > state.simulatedAt);
  assert.notEqual(state.bots.host.spinVelocity, 0);
  assert.notEqual(state.bots.guest.spinVelocity, 0);
  assert.equal(state.bots.host.thrustUntil, state.simulatedAt);
  assert.equal(state.bots.guest.turnUntil, state.simulatedAt);

  simulation.advanceOnlineMatch(state, startedAt + 1_000, "script", 60, 100);
  const turns = state.bots.host.telemetry.actionCounts.turnleft + state.bots.host.telemetry.actionCounts.turnright
    + state.bots.guest.telemetry.actionCounts.turnleft + state.bots.guest.telemetry.actionCounts.turnright;
  assert.ok(turns > 0, "scripts should steer to recover from collision disorientation");
});

test("arena exit advances the best-of-three score", () => {
  const startedAt = 20_000;
  const state = simulation.createOnlineMatch(startedAt, { playerId: "p1", bot: bot("Rivet") }, { playerId: "p2", bot: bot("Relay") });
  state.bots.guest.x = simulation.ONLINE_ARENA.x + simulation.ONLINE_ARENA.radius + state.bots.guest.radius + 5;
  simulation.advanceOnlineMatch(state, startedAt + 50, "buttons", 60, 100);
  assert.equal(state.scores.host, 1);
  assert.equal(state.phase, "round-break");
});

test("disconnect produces an immediate authoritative forfeit", () => {
  const state = simulation.createOnlineMatch(30_000, { playerId: "p1", bot: bot("Rivet") }, { playerId: "p2", bot: bot("Relay") });
  simulation.forfeitOnlineMatch(state, "guest");
  assert.equal(state.phase, "complete");
  assert.equal(state.winnerSide, "guest");
  assert.equal(state.reason, "disconnect");
});
