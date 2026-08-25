import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadCampaign() {
  const source = readFileSync(new URL("../lib/game/campaign.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", compiled)(() => { throw new Error("campaign.ts has no runtime imports"); }, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

const campaign = loadCampaign();

test("campaign defines six licenses with six missions each", () => {
  assert.equal(campaign.campaignChapters.length, 6);
  assert.equal(campaign.campaignLevels.length, 36);
  assert.equal(new Set(campaign.campaignLevels.map((level) => level.id)).size, 36);
  for (const chapter of campaign.campaignChapters) {
    assert.equal(campaign.levelsForChapter(chapter.number).length, 6);
    assert.ok(chapter.bonus.xp > 0);
    assert.ok(chapter.bonus.gold > 0);
    assert.ok(chapter.badge);
  }
});

test("every mission is playable, rewarded, and has assessment guidance", () => {
  for (const level of campaign.campaignLevels) {
    assert.ok(["buttons", "live", "script"].includes(level.mode), level.id);
    assert.ok(level.durationSeconds > 0, level.id);
    assert.ok(level.playerTickMs >= 50, level.id);
    assert.ok(level.reward.xp > 0 && level.reward.gold > 0, level.id);
    assert.ok(level.objectives.length > 0, level.id);
    assert.ok(level.hints.length > 0, level.id);
    assert.ok(level.star2.label && level.star3.label, level.id);
    if (level.mode === "script") assert.match(level.starterSource, /function decide\(game\)/, level.id);
  }
});

test("campaign unlocks sequentially from the first mission", () => {
  const [first, second] = campaign.campaignLevels;
  assert.equal(campaign.levelIsUnlocked(first, {}), true);
  assert.equal(campaign.levelIsUnlocked(second, {}), false);
  const progress = { [first.id]: { bestStars: 1 } };
  assert.equal(campaign.levelIsUnlocked(second, progress), true);
});


test("live command missions provide double execution time", () => {
  const durations = Object.fromEntries(campaign.campaignLevels.filter((level) => level.mode === "live").map((level) => [level.id, level.durationSeconds]));
  assert.deepEqual(durations, { "2-1": 70, "2-2": 70, "2-3": 70, "2-4": 60, "2-5": 70, "2-6": 90 });
});

test("script campaign starters require active uncommenting", () => {
  for (const level of campaign.campaignLevels.filter((entry) => entry.chapter >= 3)) {
    assert.equal(level.mode, "script", level.id);
    assert.ok(level.starterSource.split("\n").every((line) => line.startsWith("//")), level.id);
  }
});

test("homepage replay pool excludes campaign and malformed logs", () => {
  const matchSource = readFileSync(new URL("../lib/matches/server.ts", import.meta.url), "utf8");
  const appSource = readFileSync(new URL("../app/components/SumobotApp.tsx", import.meta.url), "utf8");
  assert.ok(matchSource.includes("WHERE campaign = 0 AND battle_mode IN ('pvai', 'pvp')"));
  assert.match(matchSource, /validFrames/);
  assert.match(appSource, /entry.campaign === false/);
});
