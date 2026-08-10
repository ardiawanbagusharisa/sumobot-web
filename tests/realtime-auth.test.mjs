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

const auth = loadCommonJs("../lib/online/realtime-auth.ts");
const secret = "test-only-shared-secret";

test("realtime tickets authenticate the exact room, player, and bootstrap", async () => {
  const claims = {
    roomId: "ROOM42",
    playerId: "player-1",
    side: "host",
    bootstrapHash: "bootstrap-hash",
    expiresAt: Date.now() + 30_000,
  };
  const ticket = await auth.signRealtimeTicket(claims, secret);
  assert.deepEqual(await auth.verifyRealtimeTicket(ticket, secret), claims);
  assert.equal(await auth.verifyRealtimeTicket(`${ticket}tampered`, secret), null);
  assert.equal(await auth.verifyRealtimeTicket("bad.invalid-base64%%%", secret), null);
});

test("completion proofs reject altered match results", async () => {
  const state = { phase: "complete", winnerSide: "host", scores: { host: 2, guest: 0 } };
  const proof = await auth.createCompletionProof("ROOM42", state, secret);
  assert.equal(await auth.verifyCompletionProof("ROOM42", state, proof, secret), true);
  assert.equal(await auth.verifyCompletionProof("ROOM42", { ...state, winnerSide: "guest" }, proof, secret), false);
  assert.equal(await auth.verifyCompletionProof("ROOM42", state, { ...proof, signature: "invalid%%%" }, secret), false);
});
