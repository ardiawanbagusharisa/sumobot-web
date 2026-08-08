import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      DB: undefined,
      REPLAYS: undefined,
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Sumobot application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Sumobot — Learn, Build, Battle<\/title>/i);
  assert.match(html, /CODE YOUR BOT/i);
  assert.match(html, /LEAD THE BOARD/i);
  assert.match(html, /Analyze the replays, build the bots, and code a real portfolio/i);
  assert.match(html, /ANALYZE \| BUILD \| CODE/i);
  assert.match(html, />Login</i);
  assert.doesNotMatch(html, /BUILD · TEST · PROVE|Replay \+ live diagnostics|Pilot login/i);
  assert.doesNotMatch(html, /Awaiting challengers|Rookie Driver|Sign in, choose a room/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});
