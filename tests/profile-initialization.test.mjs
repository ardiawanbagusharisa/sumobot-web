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
const defaults = loadCommonJs("../lib/profile/default.ts", (request) => {
  if (request === "@/lib/game/rules") return rules;
  throw new Error(`Unexpected profile default dependency ${request}`);
});

test("new accounts receive the defined server-side starting profile", () => {
  const profile = defaults.defaultOnlineProfile();
  assert.equal(profile.xp, 320);
  assert.equal(profile.gold, 480);
  assert.deepEqual(profile.analytics, {});
  assert.deepEqual(profile.battleHistory, []);
  assert.equal(profile.campaignCompleted, false);
});
