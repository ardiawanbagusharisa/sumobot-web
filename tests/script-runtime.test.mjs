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
  if (request === "./rules") return rules;
  throw new Error(`Unexpected module ${request}`);
});

const game = (overrides = {}) => ({
  elapsed: 1,
  arena: { radius: 205 },
  self: { distanceFromCenter: 30, angleToCenter: 0, dashReady: true, skillReady: true, skill: "boost" },
  enemy: { distance: 3, angle: 0, stunned: false, stone: false },
  ...overrides,
});

test("primitive DSL template executes familiar if/return code", () => {
  const strategy = runtime.createScriptRuntime(rules.PRIMITIVE_SCRIPT);
  assert.deepEqual(strategy.decide({ game: game({ enemy: { distance: 3, angle: 20, stunned: false, stone: false } }) }), { name: "turnright", duration: 0.1 });
  assert.deepEqual(strategy.decide({ game: game() }), { name: "forward", duration: 0.2 });
});

test("FSM template keeps script-defined state between ticks", () => {
  const strategy = runtime.createScriptRuntime(rules.FSM_SCRIPT);
  const closeEnemy = { distance: 1, angle: 0, stunned: false, stone: false };
  assert.deepEqual(strategy.decide({ game: game({ enemy: closeEnemy }) }), { name: "skill" });
  assert.deepEqual(strategy.decide({ game: game({ self: { distanceFromCenter: 30, angleToCenter: 0, dashReady: true, skillReady: false, skill: "boost" }, enemy: closeEnemy }) }), { name: "dash" });
});

test("script state snapshots survive an authoritative server handoff", () => {
  const firstWorker = runtime.createScriptRuntime(rules.FSM_SCRIPT);
  const closeEnemy = { distance: 1, angle: 0, stunned: false, stone: false };
  assert.deepEqual(firstWorker.decide({ game: game({ enemy: closeEnemy }) }), { name: "skill" });
  const snapshot = firstWorker.snapshot();
  assert.equal(snapshot.state, "attack");

  const nextWorker = runtime.createScriptRuntime(rules.FSM_SCRIPT);
  nextWorker.restore(snapshot);
  assert.deepEqual(nextWorker.decide({ game: game({ self: { distanceFromCenter: 30, angleToCenter: 0, dashReady: true, skillReady: false, skill: "boost" }, enemy: closeEnemy }) }), { name: "dash" });
});

test("legacy JSON strategies migrate without discarding their rules", () => {
  const legacy = JSON.stringify({ version: 1, initialState: "pilot", states: { pilot: [
    { when: "game.enemy.angle > 8", do: "turnright(0.1)" },
    { do: "forward(0.3)" },
  ] } });
  const source = runtime.migrateLegacyJsonScript(legacy);
  const strategy = runtime.createScriptRuntime(source);
  assert.match(source, /Automatically migrated/);
  assert.deepEqual(strategy.decide({ game: game({ enemy: { distance: 3, angle: 20, stunned: false, stone: false } }) }), { name: "turnright", duration: 0.1 });
});
