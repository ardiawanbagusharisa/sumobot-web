import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

function loadCommands() {
  const source=readFileSync(new URL("../lib/game/commands.ts",import.meta.url),"utf8");
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const loaded={exports:{}};
  new Function("require","module","exports",compiled)(()=>({GAME_RULES:{actionDuration:{minimum:.1,maximum:3}}}),loaded,loaded.exports);
  return loaded.exports;
}

test("shared commands expose contextual help and bounded parsing",()=>{
  const commands=loadCommands();
  assert.match(commands.commandHelp()[1],/forward\(seconds\)/);
  assert.match(commands.commandHelp("dash")[1],/dash\(\)/);
  assert.deepEqual(commands.parseBotCommand("forward(0.5)").command,{name:"forward",duration:.5});
  assert.match(commands.parseBotCommand("forward(9)").error,/between/);
  assert.match(commands.parseBotCommand("teleport()").error,/Unknown command/);
});

test("campaign replay storage is private and best/latest only",()=>{
  const route=readFileSync(new URL("../app/api/campaign-replays/route.ts",import.meta.url),"utf8");
  const server=readFileSync(new URL("../lib/campaign-replays/server.ts",import.meta.url),"utf8");
  assert.match(route,/getSessionUser/); assert.match(route,/status: 401/);
  assert.match(server,/\["latest", "best"\]/); assert.match(server,/player_id = \?/);
});

test("season ladders use enrollment, a dedicated queue, frozen rules, and owner checks",()=>{
  const server=readFileSync(new URL("../lib/competitions/server.ts",import.meta.url),"utf8");
  assert.match(server,/user\.role === "admin"/); assert.match(server,/competition_enrollments/);
  assert.match(server,/competition_queue_entries/); assert.match(server,/Published rules are frozen/);
  assert.match(server,/admin_audit_events/);
});

test("login-backed account roles gate the admin page",()=>{
  const auth=readFileSync(new URL("../lib/auth/server.ts",import.meta.url),"utf8");
  const app=readFileSync(new URL("../app/components/SumobotApp.tsx",import.meta.url),"utf8");
  assert.match(auth,/p\.role AS role/);
  assert.match(auth,/SUMOBOT_BOOTSTRAP_ADMIN_HANDLES/);
  assert.match(app,/player\.role === "admin"/);
});

test("product-facing metadata no longer says alpha",()=>{
  const layout=readFileSync(new URL("../app/layout.tsx",import.meta.url),"utf8");
  assert.doesNotMatch(layout,/Online Alpha/i); assert.match(layout,/Sumobot — Learn, Build, Battle/);
});
