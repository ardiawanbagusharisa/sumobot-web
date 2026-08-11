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

test("authoritative simulation accepts actions and records replay frames", () => {
  const startedAt = 10_000;
  const state = simulation.createOnlineMatch(startedAt, { playerId: "p1", bot: bot("Rivet") }, { playerId: "p2", bot: bot("Relay", "stone") });
  assert.equal(simulation.performOnlineAction(state, "host", "forward", .5, 100), true);
  simulation.advanceOnlineMatch(state, startedAt + 1000, "buttons", 60, 100);
  assert.ok(state.bots.host.x > simulation.ONLINE_ARENA.x - 115);
  assert.ok(state.replay.length >= 4);
  assert.ok(state.bots.host.telemetry.actionCounts.forward >= 1);
});

test("continuous button state is applied at realtime tick intervals", () => {
  const startedAt = 12_000;
  const state = simulation.createOnlineMatch(startedAt, { playerId: "p1", bot: bot("Rivet") }, { playerId: "p2", bot: bot("Relay") });
  const originalX = state.bots.host.x;

  for (let tick = 1; tick <= 15; tick += 1) {
    simulation.applyOnlineControlState(state, "host", { forward: true, turn: 1 });
    simulation.advanceOnlineMatch(state, startedAt + Math.round(tick * 1000 / 30), "buttons", 60, 100);
  }

  assert.ok(state.bots.host.x > originalX, "held forward input should move on every server tick");
  assert.ok(state.bots.host.angle > 0, "held turn input should rotate smoothly");
  assert.equal(state.simulatedAt, startedAt + 500);
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
