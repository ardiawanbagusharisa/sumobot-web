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
  const service=readFileSync(new URL("../lib/competitions/service.ts",import.meta.url),"utf8");
  assert.match(service,/user\.role === "admin"/); assert.match(service,/competition_enrollments/);
  assert.match(service,/competition_queue_entries/); assert.match(service,/Published rules are frozen/);
  assert.match(service,/admin_audit_events/);
});

test("login-backed account roles gate the admin page",()=>{
  const auth=readFileSync(new URL("../lib/auth/server.ts",import.meta.url),"utf8");
  const app=readFileSync(new URL("../app/components/SumobotApp.tsx",import.meta.url),"utf8");
  assert.match(auth,/p\.role AS role/);
  assert.match(auth,/SUMOBOT_BOOTSTRAP_ADMIN_HANDLES/);
  assert.match(app,/player\.role === "admin"/);
});

test("live competitions use a single-mode, private-capable, eight-player round robin",()=>{
  const center=readFileSync(new URL("../app/components/CompetitionCenter.tsx",import.meta.url),"utf8");
  const service=readFileSync(new URL("../lib/competitions/service.ts",import.meta.url),"utf8");
  assert.match(center,/60 seconds to accept/); assert.match(center,/Choose an opponent/); assert.match(center,/Season standings/);
  assert.match(center,/Competition code/); assert.match(service,/const MAX_COMPETITORS = 8/);
  assert.match(service,/const ACCEPTANCE_SECONDS = 60/); assert.match(service,/access_code_hash/);
  assert.match(service,/controlModes: \[controlMode\]/);
  assert.match(service,/challengeOpponent/); assert.match(service,/status='assigned'/);
});

test("competitions auto-start, refresh live state, auto-detect standby, and return after battles",()=>{
  const service=readFileSync(new URL("../lib/competitions/service.ts",import.meta.url),"utf8");
  const center=readFileSync(new URL("../app/components/CompetitionCenter.tsx",import.meta.url),"utf8");
  const realtime=readFileSync(new URL("../app/components/RealtimeBattleRoom.tsx",import.meta.url),"utf8");
  const app=readFileSync(new URL("../app/components/SumobotApp.tsx",import.meta.url),"utf8");
  assert.match(service,/reconcileCompetitionLifecycle/); assert.match(service,/competition.auto_active/);
  assert.match(center,/setInterval\(\(\)=>void refresh\(\),3000\)/); assert.match(center,/automaticStandbyKey/);
  assert.match(realtime,/autoReturnSeconds/); assert.match(realtime,/Returning to Seasons/);
  assert.match(app,/competitionBattle\?30:undefined/); assert.match(app,/setView\("competitions"\)/);
});

test("competition room insert keeps twenty columns aligned with twenty SQL values",()=>{
  const online=readFileSync(new URL("../lib/online/server.ts",import.meta.url),"utf8");
  const helper=online.slice(online.indexOf("export async function createCompetitionOnlineRoom"));
  const match=helper.match(/INSERT INTO online_rooms\s*\(([^)]+)\)\s*VALUES \(([^)]+)\)/);
  assert.ok(match,"competition room insert not found");
  assert.equal(match[1].split(",").length,20); assert.equal(match[2].split(",").length,20);
});

test("competition standings count completed matches and ignore disconnect forfeits",()=>{
  const results=readFileSync(new URL("../lib/competitions/results.ts",import.meta.url),"utf8");
  assert.match(results,/completionReason === "disconnect"/);
  assert.match(results,/status='pending'/); assert.match(results,/return;/);
  assert.match(results,/INSERT OR IGNORE INTO competition_results/);
});

test("competition roster persists all enrolled players and admin deletion cleans dependent records",()=>{
  const service=readFileSync(new URL("../lib/competitions/service.ts",import.meta.url),"utf8");
  const center=readFileSync(new URL("../app/components/CompetitionCenter.tsx",import.meta.url),"utf8");
  const admin=readFileSync(new URL("../app/components/CompetitionAdmin.tsx",import.meta.url),"utf8");
  assert.match(service,/Enrollment is the durable roster/); assert.match(service,/FROM competition_enrollments e LEFT JOIN players/);
  assert.match(center,/competition-player-status/); assert.match(service,/export async function adminDelete/);
  assert.match(service,/DELETE FROM competition_pairings/); assert.match(admin,/removeCompetition/); assert.match(admin,/>Delete</);
});

test("each competition card owns its roster and standings, including archived seasons",()=>{
  const center=readFileSync(new URL("../app/components/CompetitionCenter.tsx",import.meta.url),"utf8");
  const route=readFileSync(new URL("../app/api/competitions/route.ts",import.meta.url),"utf8");
  const service=readFileSync(new URL("../lib/competitions/service.ts",import.meta.url),"utf8");
  assert.match(center,/competition-board-card/); assert.match(center,/Final standings/); assert.doesNotMatch(center,/competition-live-room/);
  assert.match(route,/cards==="1"/); assert.match(route,/Object\.fromEntries/);
  assert.match(service,/closed:\["archived"\]/); assert.match(service,/competition.auto_closed/); assert.match(service,/awardCompetitionRewards/);
  assert.match(service,/sealCompetition/);
  const transition=service.slice(service.indexOf("export async function adminTransition"),service.indexOf("async function awardCompetitionRewards"));
  assert.doesNotMatch(transition,/DELETE FROM competition_enrollments/);
});

test("competition rewards include podium and participation gold and XP",()=>{
  const types=readFileSync(new URL("../lib/competitions/types.ts",import.meta.url),"utf8");
  const service=readFileSync(new URL("../lib/competitions/service.ts",import.meta.url),"utf8");
  assert.match(types,/first: CompetitionPrize/); assert.match(types,/participation: CompetitionPrize/);
  assert.match(service,/competition_reward_claims/); assert.match(service,/awardCompetitionRewards/);
});

test("product-facing metadata no longer says alpha",()=>{
  const layout=readFileSync(new URL("../app/layout.tsx",import.meta.url),"utf8");
  assert.doesNotMatch(layout,/Online Alpha/i); assert.match(layout,/Sumobot — Learn, Build, Battle/);
});

test("season cards show issued rewards and collapsed authoritative replay lists",()=>{
  const center=readFileSync(new URL("../app/components/CompetitionCenter.tsx",import.meta.url),"utf8");
  const service=readFileSync(new URL("../lib/competitions/service.ts",import.meta.url),"utf8");
  const app=readFileSync(new URL("../app/components/SumobotApp.tsx",import.meta.url),"utf8");
  assert.match(center,/Rewards issued/); assert.match(center,/<details className="competition-replay-panel">/);
  assert.match(center,/Watch replay/); assert.match(service,/competition_reward_claims rc/);
  assert.match(service,/prototype_match_records pm/); assert.match(service,/This replay is private to registered competitors/);
  assert.match(app,/Competition ·/); assert.match(app,/Regular battle · PvAI/); assert.match(app,/Regular battle · PvP/);
});
