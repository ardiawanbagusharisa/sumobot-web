import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadCommonJs(path) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", compiled)(() => ({}), loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

const polling = loadCommonJs("../lib/online/polling.ts");

test("room list and lobby polling pauses in hidden tabs", () => {
  assert.equal(polling.roomListPollDelay(true), 5_000);
  assert.equal(polling.roomListPollDelay(false), null);
  assert.equal(polling.roomPollDelay("waiting", "discovering", true), 750);
  assert.equal(polling.roomPollDelay("countdown", "connecting", false), null);
});

test("realtime health checks are infrequent without slowing compatibility gameplay", () => {
  assert.equal(polling.roomPollDelay("live", "realtime", true), 15_000);
  assert.equal(polling.roomPollDelay("live", "compatibility", true), 120);
  assert.equal(polling.roomPollDelay("live", "compatibility", false), 120);
  assert.equal(polling.roomPollDelay("live", "reconnecting", true), 750);
  assert.equal(polling.roomPollDelay("completed", "realtime", true), null);
});

const baseSynchronizationState = {
  status: "waiting",
  lastSeenAt: 9_000,
  guestPresent: true,
  hostReady: false,
  guestReady: false,
  hostSetupDeadline: 20_000,
  guestSetupDeadline: 20_000,
  countdownStartedAt: null,
  realtimeStartedAt: null,
  hasMatchState: false,
};

test("room reads persist only for heartbeats and state transitions", () => {
  assert.equal(polling.roomSynchronizationNeedsPersistence(baseSynchronizationState, 10_000), false);
  assert.equal(polling.roomSynchronizationNeedsPersistence(baseSynchronizationState, 12_000), true);
  assert.equal(polling.roomSynchronizationNeedsPersistence({ ...baseSynchronizationState, hostSetupDeadline: 10_000 }, 10_000), true);
  assert.equal(polling.roomSynchronizationNeedsPersistence({ ...baseSynchronizationState, hostReady: true, guestReady: true }, 10_000), true);
  assert.equal(polling.roomSynchronizationNeedsPersistence({ ...baseSynchronizationState, status: "countdown", countdownStartedAt: 5_000 }, 10_000), true);
});

test("compatibility simulation persists every gameplay step while realtime does not", () => {
  const live = { ...baseSynchronizationState, status: "live", guestPresent: true, hasMatchState: true };
  assert.equal(polling.roomSynchronizationNeedsPersistence(live, 10_000), true);
  assert.equal(polling.roomSynchronizationNeedsPersistence({ ...live, realtimeStartedAt: 9_500 }, 10_000), false);
});
