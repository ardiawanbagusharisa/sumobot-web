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
