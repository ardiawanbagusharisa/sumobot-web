import type { AuthUser } from "@/lib/auth/server";
import { getDatabase } from "@/lib/db/server";
import type { ControlMode, MatchResult } from "@/lib/game/rules";
import type { OnlineBotSelection } from "@/lib/online/types";
import { createCompetitionOnlineRoom } from "@/lib/online/server";
import { getOnlineProfile } from "@/lib/profile/server";
import {
  DEFAULT_COMPETITION_RULES,
  type Competition,
  type CompetitionDetail,
  type CompetitionPrize,
  type CompetitionRuleSet,
  type CompetitionStanding,
  type CompetitionStatus,
} from "./types";

const MAX_COMPETITORS = 8;
const ACCEPTANCE_SECONDS = 60;
const PRESENCE_MS = 18_000;
let ready = false;

function changes(result: unknown) {
  return Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.trim().toLowerCase()));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function ensureCompetitionSchema() {
  if (ready) return;
  const db = await getDatabase();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS competitions (
      id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL,
      is_private INTEGER NOT NULL DEFAULT 0, access_code_hash TEXT, max_players INTEGER NOT NULL DEFAULT 8,
      registration_opens_at TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
      rules_version INTEGER NOT NULL, rules_json TEXT NOT NULL, created_by TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS competition_enrollments (
      competition_id TEXT NOT NULL, player_id TEXT NOT NULL, enrolled_at TEXT NOT NULL,
      PRIMARY KEY (competition_id, player_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS competition_queue_entries (
      competition_id TEXT NOT NULL, player_id TEXT NOT NULL, bot_id TEXT NOT NULL, bot_json TEXT,
      control_mode TEXT NOT NULL, status TEXT NOT NULL, pairing_id TEXT,
      joined_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (competition_id, player_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS competition_pairings (
      id TEXT PRIMARY KEY NOT NULL, competition_id TEXT NOT NULL, player_a_id TEXT NOT NULL, player_b_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', acceptance_expires_at INTEGER,
      player_a_accepted_at INTEGER, player_b_accepted_at INTEGER, room_id TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE (competition_id, player_a_id, player_b_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS competition_results (
      id TEXT PRIMARY KEY NOT NULL, competition_id TEXT NOT NULL, match_id TEXT NOT NULL,
      player_id TEXT NOT NULL, result TEXT NOT NULL, points REAL NOT NULL, played_at TEXT NOT NULL,
      UNIQUE (competition_id, match_id, player_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS competition_reward_claims (
      competition_id TEXT NOT NULL, player_id TEXT NOT NULL, placement INTEGER,
      gold INTEGER NOT NULL, xp INTEGER NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (competition_id, player_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS admin_audit_events (
      id TEXT PRIMARY KEY NOT NULL, admin_player_id TEXT NOT NULL, action TEXT NOT NULL,
      target_id TEXT NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_competitions_status_dates ON competitions(status, starts_at, ends_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_competition_pairings_player_a ON competition_pairings(competition_id, player_a_id, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_competition_pairings_player_b ON competition_pairings(competition_id, player_b_id, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_competition_results_standings ON competition_results(competition_id, player_id)"),
  ]);
  const competitionColumns = await db.prepare("PRAGMA table_info(competitions)").all<{ name: string }>();
  for (const [name, sql] of [
    ["is_private", "ALTER TABLE competitions ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0"],
    ["access_code_hash", "ALTER TABLE competitions ADD COLUMN access_code_hash TEXT"],
    ["max_players", "ALTER TABLE competitions ADD COLUMN max_players INTEGER NOT NULL DEFAULT 8"],
  ] as const) if (!competitionColumns.results.some((column) => column.name === name)) await db.prepare(sql).run();
  const queueColumns = await db.prepare("PRAGMA table_info(competition_queue_entries)").all<{ name: string }>();
  for (const [name, sql] of [
    ["bot_json", "ALTER TABLE competition_queue_entries ADD COLUMN bot_json TEXT"],
    ["pairing_id", "ALTER TABLE competition_queue_entries ADD COLUMN pairing_id TEXT"],
  ] as const) if (!queueColumns.results.some((column) => column.name === name)) await db.prepare(sql).run();
  await db.prepare("PRAGMA optimize").run();
  ready = true;
}

export function isCompetitionAdmin(user: AuthUser) {
  return user.role === "admin";
}

function prize(value: unknown, fallback: CompetitionPrize): CompetitionPrize {
  const input = value && typeof value === "object" ? value as Partial<CompetitionPrize> : {};
  return {
    gold: Math.max(0, Math.min(100_000, Math.floor(Number(input.gold ?? fallback.gold)))),
    xp: Math.max(0, Math.min(100_000, Math.floor(Number(input.xp ?? fallback.xp)))),
  };
}

function normalizeRules(value: unknown): CompetitionRuleSet {
  const input = value && typeof value === "object" ? value as Partial<CompetitionRuleSet> : {};
  const requestedModes = Array.isArray(input.controlModes) ? input.controlModes : [];
  const controlMode = requestedModes.find((mode): mode is ControlMode => ["buttons", "live", "script"].includes(String(mode))) ?? DEFAULT_COMPETITION_RULES.controlModes[0];
  const roundSeconds = [30, 60, 120].includes(Number(input.roundSeconds)) ? Number(input.roundSeconds) as 30 | 60 | 120 : DEFAULT_COMPETITION_RULES.roundSeconds;
  const rewardsInput = input.rewards && typeof input.rewards === "object" ? input.rewards as Partial<CompetitionRuleSet["rewards"]> : {};
  return {
    controlModes: [controlMode],
    roundSeconds,
    actionIntervalMs: Math.max(100, Math.min(1000, Math.floor(Number(input.actionIntervalMs ?? 250)))),
    arenaRadius: Math.max(150, Math.min(210, Math.floor(Number(input.arenaRadius ?? 188)))),
    matchLimit: MAX_COMPETITORS - 1,
    scoring: {
      win: Math.max(0, Math.min(20, Number(input.scoring?.win ?? 3))),
      draw: Math.max(0, Math.min(20, Number(input.scoring?.draw ?? 1))),
      loss: Math.max(0, Math.min(20, Number(input.scoring?.loss ?? 0))),
    },
    tieBreakers: ["wins", "fewestLosses", "matches"],
    rewards: {
      first: prize(rewardsInput.first, DEFAULT_COMPETITION_RULES.rewards.first),
      second: prize(rewardsInput.second, DEFAULT_COMPETITION_RULES.rewards.second),
      third: prize(rewardsInput.third, DEFAULT_COMPETITION_RULES.rewards.third),
      participation: prize(rewardsInput.participation, DEFAULT_COMPETITION_RULES.rewards.participation),
    },
  };
}

function mapCompetition(row: Record<string, unknown>): Competition {
  return {
    id: String(row.id), title: String(row.title), description: String(row.description), status: row.status as CompetitionStatus,
    isPrivate: Boolean(row.is_private), maxPlayers: Number(row.max_players ?? MAX_COMPETITORS), competitorCount: Number(row.competitor_count ?? 0),
    registrationOpensAt: String(row.registration_opens_at), startsAt: String(row.starts_at), endsAt: String(row.ends_at),
    rulesVersion: Number(row.rules_version), rules: normalizeRules(JSON.parse(String(row.rules_json))), enrolled: Boolean(row.enrolled),
    queued: Boolean(row.queued), queuedMode: row.queued_mode as ControlMode | undefined,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

async function sealCompetition(db: Awaited<ReturnType<typeof getDatabase>>, competitionId: string, now: string) {
  await db.batch([
    db.prepare("UPDATE competition_pairings SET status='pending',acceptance_expires_at=NULL,player_a_accepted_at=NULL,player_b_accepted_at=NULL,updated_at=? WHERE competition_id=? AND status IN ('assigned','launching')").bind(now,competitionId),
    db.prepare("UPDATE competition_queue_entries SET status='cancelled',pairing_id=NULL,updated_at=? WHERE competition_id=?").bind(now,competitionId),
  ]);
}

async function reconcileCompetitionLifecycle(competitionId?: string) {
  const db=await getDatabase(),now=new Date().toISOString();
  const scope=competitionId?" AND id=?":"";
  const starting=competitionId
    ?await db.prepare("SELECT id,created_by AS createdBy FROM competitions WHERE status='registration' AND starts_at<=? AND ends_at>?"+scope).bind(now,now,competitionId).all<{id:string;createdBy:string}>()
    :await db.prepare("SELECT id,created_by AS createdBy FROM competitions WHERE status='registration' AND starts_at<=? AND ends_at>?").bind(now,now).all<{id:string;createdBy:string}>();
  for(const row of starting.results){
    const roster=await db.prepare("SELECT COUNT(*) AS count FROM competition_enrollments WHERE competition_id=?").bind(row.id).first<{count:number}>();
    if(Number(roster?.count??0)<2)continue;
    const started=await db.prepare("UPDATE competitions SET status='active',updated_at=? WHERE id=? AND status='registration' AND starts_at<=? AND ends_at>?").bind(now,row.id,now,now).run();
    if(changes(started)){await generatePairings(row.id);await db.prepare("INSERT INTO admin_audit_events (id,admin_player_id,action,target_id,details_json,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(),row.createdBy,"competition.auto_active",row.id,"{}",now).run()}
  }
  const ending=competitionId
    ?await db.prepare("SELECT id,created_by AS createdBy FROM competitions WHERE status IN ('registration','active') AND ends_at<=?"+scope).bind(now,competitionId).all<{id:string;createdBy:string}>()
    :await db.prepare("SELECT id,created_by AS createdBy FROM competitions WHERE status IN ('registration','active') AND ends_at<=?").bind(now).all<{id:string;createdBy:string}>();
  for(const row of ending.results){
    const closed=await db.prepare("UPDATE competitions SET status='closed',updated_at=? WHERE id=? AND status IN ('registration','active') AND ends_at<=?").bind(now,row.id,now).run();
    if(changes(closed)){await sealCompetition(db,row.id,now);await awardCompetitionRewards(row.id);await db.prepare("INSERT INTO admin_audit_events (id,admin_player_id,action,target_id,details_json,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(),row.createdBy,"competition.auto_closed",row.id,"{}",now).run()}
  }
}

export async function listCompetitions(user?: AuthUser | null) {
  await ensureCompetitionSchema();
  await reconcileCompetitionLifecycle();
  const db = await getDatabase();
  const userId = user?.id ?? "";
  const rows = await db.prepare(`SELECT c.*,
      (SELECT COUNT(*) FROM competition_enrollments ce WHERE ce.competition_id = c.id) AS competitor_count,
      CASE WHEN e.player_id IS NULL THEN 0 ELSE 1 END AS enrolled,
      CASE WHEN q.status IN ('waiting','assigned','matched') THEN 1 ELSE 0 END AS queued,
      q.control_mode AS queued_mode
    FROM competitions c
    LEFT JOIN competition_enrollments e ON e.competition_id = c.id AND e.player_id = ?
    LEFT JOIN competition_queue_entries q ON q.competition_id = c.id AND q.player_id = ?
    WHERE c.status != 'draft' OR c.created_by = ?
    ORDER BY c.starts_at DESC LIMIT 30`).bind(userId, userId, userId).all<Record<string, unknown>>();
  return rows.results.map(mapCompetition);
}

export async function standings(competitionId: string): Promise<CompetitionStanding[]> {
  await ensureCompetitionSchema();
  const db = await getDatabase();
  const rows = await db.prepare(`SELECT r.player_id AS playerId, p.display_name AS displayName,
    SUM(r.points) AS points, SUM(CASE WHEN r.result='win' THEN 1 ELSE 0 END) AS wins,
    SUM(CASE WHEN r.result='draw' THEN 1 ELSE 0 END) AS draws,
    SUM(CASE WHEN r.result='loss' THEN 1 ELSE 0 END) AS losses, COUNT(*) AS matches
    FROM competition_results r INNER JOIN players p ON p.id = r.player_id WHERE r.competition_id = ?
    GROUP BY r.player_id, p.display_name ORDER BY points DESC, wins DESC, losses ASC, matches DESC LIMIT 200`).bind(competitionId).all<Record<string, unknown>>();
  return rows.results.map((row, index) => ({
    playerId: String(row.playerId), displayName: String(row.displayName), points: Number(row.points), wins: Number(row.wins),
    draws: Number(row.draws), losses: Number(row.losses), matches: Number(row.matches), rank: index + 1,
  }));
}

export async function enroll(user: AuthUser, competitionId: string, accessCode?: string) {
  await ensureCompetitionSchema();
  const db = await getDatabase();
  const now = new Date().toISOString();
  const competition = await db.prepare(`SELECT status, is_private AS isPrivate, access_code_hash AS accessCodeHash,
    registration_opens_at AS opens, starts_at AS starts, ends_at AS ends, max_players AS maxPlayers
    FROM competitions WHERE id = ?`).bind(competitionId).first<{ status: string; isPrivate: number; accessCodeHash: string | null; opens: string; starts: string; ends: string; maxPlayers: number }>();
  if (!competition || competition.status !== "registration") return { error: "Registration is closed; the roster freezes when the event starts.", status: 409 as const };
  if (now < competition.opens || now >= competition.starts || now > competition.ends) return { error: "Competition registration is outside its available window.", status: 409 as const };
  if (competition.isPrivate && (!accessCode || await sha256(accessCode) !== competition.accessCodeHash)) return { error: "Incorrect private competition code.", status: 403 as const };
  const result = await db.prepare(`INSERT OR IGNORE INTO competition_enrollments (competition_id, player_id, enrolled_at)
    SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM competition_enrollments WHERE competition_id = ?) < ?`)
    .bind(competitionId, user.id, now, competitionId, Math.min(MAX_COMPETITORS, Number(competition.maxPlayers))).run();
  if (!changes(result)) {
    const existing = await db.prepare("SELECT 1 AS found FROM competition_enrollments WHERE competition_id = ? AND player_id = ?").bind(competitionId, user.id).first();
    if (!existing) return { error: `This competition is full (${MAX_COMPETITORS} players).`, status: 409 as const };
  }
  return { enrolled: true };
}

async function expireAssignments(competitionId: string) {
  const db = await getDatabase();
  const now = Date.now();
  const expired = await db.prepare("SELECT id FROM competition_pairings WHERE competition_id = ? AND status = 'assigned' AND acceptance_expires_at <= ?").bind(competitionId, now).all<{ id: string }>();
  for (const pairing of expired.results) {
    await db.batch([
      db.prepare("UPDATE competition_pairings SET status='pending', acceptance_expires_at=NULL, player_a_accepted_at=NULL, player_b_accepted_at=NULL, updated_at=? WHERE id=? AND status='assigned'").bind(new Date(now).toISOString(), pairing.id),
      db.prepare("UPDATE competition_queue_entries SET status='waiting', pairing_id=NULL, updated_at=? WHERE competition_id=? AND pairing_id=?").bind(new Date(now).toISOString(), competitionId, pairing.id),
    ]);
  }
}

export async function standby(user: AuthUser, competitionId: string, botValue: unknown) {
  await ensureCompetitionSchema();
  const db = await getDatabase();
  const now = new Date().toISOString();
  const competition = await db.prepare(`SELECT c.status,c.ends_at AS ends,c.rules_json AS rules
    FROM competitions c INNER JOIN competition_enrollments e ON e.competition_id=c.id
    WHERE c.id=? AND e.player_id=?`).bind(competitionId, user.id).first<{ status: string; ends: string; rules: string }>();
  if (!competition || competition.status !== "active" || now > competition.ends) return { error: "This event is not accepting standby players.", status: 409 as const };
  const bot = botValue && typeof botValue === "object" ? botValue as Partial<OnlineBotSelection> : null;
  if (!bot || typeof bot.id !== "string" || !bot.id || typeof bot.name !== "string") return { error: "Select a valid bot before going on standby.", status: 400 as const };
  const rules = normalizeRules(JSON.parse(competition.rules));
  const mode = rules.controlModes[0];
  await db.prepare(`INSERT INTO competition_queue_entries (competition_id,player_id,bot_id,bot_json,control_mode,status,pairing_id,joined_at,updated_at)
    VALUES (?,?,?,?,?,'waiting',NULL,?,?) ON CONFLICT(competition_id,player_id) DO UPDATE SET
    bot_id=excluded.bot_id,bot_json=excluded.bot_json,control_mode=excluded.control_mode,
    status=CASE WHEN competition_queue_entries.status IN ('assigned','matched') THEN competition_queue_entries.status ELSE 'waiting' END,
    pairing_id=CASE WHEN competition_queue_entries.status IN ('assigned','matched') THEN competition_queue_entries.pairing_id ELSE NULL END,
    updated_at=excluded.updated_at`).bind(competitionId,user.id,bot.id.slice(0,80),JSON.stringify(bot),mode,now,now).run();
  await expireAssignments(competitionId);
  return { waiting: true };
}

export async function competitionDetail(user: AuthUser | null, competitionId: string): Promise<CompetitionDetail> {
  await ensureCompetitionSchema();
  await reconcileCompetitionLifecycle(competitionId);
  if (user) await expireAssignments(competitionId);
  const db = await getDatabase();
  // Enrollment is the durable roster. Heartbeats only affect the status shown for each player.
  const competitors = await db.prepare(`SELECT e.player_id AS playerId,COALESCE(p.display_name,p.handle,e.player_id) AS displayName,e.enrolled_at AS enrolledAt,
      (SELECT COUNT(*) FROM competition_results r WHERE r.competition_id=e.competition_id AND r.player_id=e.player_id) AS matches,
      CASE WHEN q.status IN ('waiting','assigned','matched') AND q.updated_at>=? THEN 1 ELSE 0 END AS waiting
    FROM competition_enrollments e LEFT JOIN players p ON p.id=e.player_id
    LEFT JOIN competition_queue_entries q ON q.competition_id=e.competition_id AND q.player_id=e.player_id
    WHERE e.competition_id=? ORDER BY e.enrolled_at,e.player_id`).bind(new Date(Date.now()-PRESENCE_MS).toISOString(), competitionId).all<Record<string, unknown>>();
  const pairCounts = await db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed FROM competition_pairings WHERE competition_id=?").bind(competitionId).first<{ total: number; completed: number | null }>();
  const rewardRows = await db.prepare(`SELECT rc.player_id AS playerId,COALESCE(p.display_name,p.handle,rc.player_id) AS displayName,
      rc.placement,rc.gold,rc.xp FROM competition_reward_claims rc LEFT JOIN players p ON p.id=rc.player_id
      WHERE rc.competition_id=? ORDER BY CASE WHEN rc.placement IS NULL THEN 999 ELSE rc.placement END,displayName`).bind(competitionId).all<Record<string, unknown>>();
  const replayRows = await db.prepare(`SELECT pm.id,pa.display_name AS playerAName,pb.display_name AS playerBName,pm.result,pm.played_at AS playedAt,pm.replay
      FROM competition_pairings cp INNER JOIN players pa ON pa.id=cp.player_a_id INNER JOIN players pb ON pb.id=cp.player_b_id
      LEFT JOIN prototype_match_records pm ON pm.id='match-'||cp.room_id||'-'||cp.player_a_id
      WHERE cp.competition_id=? AND cp.status='completed' AND cp.room_id IS NOT NULL ORDER BY pm.played_at DESC,cp.updated_at DESC`).bind(competitionId).all<Record<string, unknown>>();
  const activePairs = await db.prepare("SELECT player_a_id AS playerAId,player_b_id AS playerBId,status,player_a_accepted_at AS acceptedA,player_b_accepted_at AS acceptedB FROM competition_pairings WHERE competition_id=? AND status IN ('assigned','launching','live')").bind(competitionId).all<{playerAId:string;playerBId:string;status:string;acceptedA:number|null;acceptedB:number|null}>();
  const completedResults = user ? await db.prepare(`SELECT CASE WHEN cp.player_a_id=? THEN cp.player_b_id ELSE cp.player_a_id END AS opponentId,r.result AS myResult
    FROM competition_pairings cp INNER JOIN competition_results r ON r.match_id=cp.room_id AND r.player_id=?
    WHERE cp.competition_id=? AND cp.status='completed' AND (cp.player_a_id=? OR cp.player_b_id=?)`).bind(user.id,user.id,competitionId,user.id,user.id).all<{opponentId:string;myResult:MatchResult}>() : {results:[] as Array<{opponentId:string;myResult:MatchResult}>};
  let assignment: CompetitionDetail["assignment"] = null;
  let waiting = false;
  if (user) {
    const queue = await db.prepare("SELECT status,updated_at AS updatedAt FROM competition_queue_entries WHERE competition_id=? AND player_id=?").bind(competitionId,user.id).first<{status:string;updatedAt:string}>();
    waiting = Boolean(queue?.status === "waiting" && queue.updatedAt >= new Date(Date.now()-PRESENCE_MS).toISOString());
    const row = await db.prepare(`SELECT cp.id AS pairingId,cp.status,cp.acceptance_expires_at AS acceptanceExpiresAt,
      cp.player_a_id AS playerAId,cp.player_b_id AS playerBId,cp.player_a_accepted_at AS playerAAcceptedAt,
      cp.player_b_accepted_at AS playerBAcceptedAt,cp.room_id AS roomId,p.display_name AS opponentName
      FROM competition_pairings cp INNER JOIN players p ON p.id=CASE WHEN cp.player_a_id=? THEN cp.player_b_id ELSE cp.player_a_id END
      WHERE cp.competition_id=? AND (cp.player_a_id=? OR cp.player_b_id=?) AND cp.status IN ('assigned','launching','live')
      ORDER BY cp.updated_at DESC LIMIT 1`).bind(user.id,competitionId,user.id,user.id).first<Record<string, unknown>>();
    if (row) {
      const isA = row.playerAId === user.id;
      assignment = {
        pairingId: String(row.pairingId), opponentId: String(isA ? row.playerBId : row.playerAId), opponentName: String(row.opponentName),
        status: row.status === "live" ? "live" : "assigned", acceptanceExpiresAt: row.acceptanceExpiresAt ? Number(row.acceptanceExpiresAt) : null,
        acceptedByMe: Boolean(isA ? row.playerAAcceptedAt : row.playerBAcceptedAt), acceptedByOpponent: Boolean(isA ? row.playerBAcceptedAt : row.playerAAcceptedAt),
        roomId: row.roomId ? String(row.roomId) : null,
      };
    }
  }
  const activeByPlayer = new Map<string,(typeof activePairs.results)[number]>();
  for (const pair of activePairs.results) { activeByPlayer.set(pair.playerAId,pair); activeByPlayer.set(pair.playerBId,pair); }
  const resultByOpponent = new Map(completedResults.results.map((result)=>[result.opponentId,result.myResult]));
  return {
    competitors: competitors.results.map((row) => {
      const playerId=String(row.playerId),present=Boolean(row.waiting),activePair=activeByPlayer.get(playerId);
      let status: CompetitionDetail["competitors"][number]["status"] = present ? "standby" : "offline";
      if (playerId===user?.id) status="self";
      else if (resultByOpponent.has(playerId)) { const result=resultByOpponent.get(playerId); status=result==="win"?"won":result==="loss"?"lost":"draw"; }
      else if (activePair) {
        const involvesMe=activePair.playerAId===user?.id||activePair.playerBId===user?.id;
        if (!involvesMe||activePair.status!=="assigned") status="in-game";
        else { const acceptedByMe=activePair.playerAId===user?.id?Boolean(activePair.acceptedA):Boolean(activePair.acceptedB); status=acceptedByMe?"invited":"invites-you"; }
      }
      return {playerId,displayName:String(row.displayName),enrolledAt:String(row.enrolledAt),matches:Number(row.matches),waiting:present,status,canChallenge:Boolean(user&&waiting&&status==="standby")};
    }),
    standings: await standings(competitionId), assignment, waiting, completedPairings:Number(pairCounts?.completed ?? 0), totalPairings:Number(pairCounts?.total ?? 0),
    rewards: rewardRows.results.map((row)=>({playerId:String(row.playerId),displayName:String(row.displayName),placement:row.placement===null?null:Number(row.placement),gold:Number(row.gold),xp:Number(row.xp)})),
    replays: replayRows.results.map((row)=>({id:String(row.id??""),playerAName:String(row.playerAName),playerBName:String(row.playerBName),result:(row.result??"draw") as MatchResult,playedAt:String(row.playedAt??""),available:typeof row.replay==="string"&&row.replay.includes('"frames"')})),
  };
}

export async function competitionReplay(user: AuthUser | null, competitionId: string, replayId: string) {
  await ensureCompetitionSchema();
  const db=await getDatabase();
  const competition=await db.prepare("SELECT is_private AS isPrivate FROM competitions WHERE id=?").bind(competitionId).first<{isPrivate:number}>();
  if(!competition)return {error:"Competition not found.",status:404 as const};
  if(competition.isPrivate){
    if(!user)return {error:"Sign in to watch this private competition replay.",status:401 as const};
    const allowed=user.role==="admin"||Boolean(await db.prepare("SELECT 1 AS found FROM competition_enrollments WHERE competition_id=? AND player_id=?").bind(competitionId,user.id).first());
    if(!allowed)return {error:"This replay is private to registered competitors.",status:403 as const};
  }
  const row=await db.prepare(`SELECT pm.replay,pm.result,pm.played_at AS playedAt FROM competition_pairings cp
    INNER JOIN prototype_match_records pm ON pm.id=? AND pm.id='match-'||cp.room_id||'-'||cp.player_a_id
    WHERE cp.competition_id=? AND cp.status='completed' LIMIT 1`).bind(replayId,competitionId).first<{replay:string;result:MatchResult;playedAt:string}>();
  if(!row)return {error:"Replay not found.",status:404 as const};
  try{
    const replay=JSON.parse(row.replay) as Record<string,unknown>;
    if(!Array.isArray(replay.frames)||replay.frames.length<2)return {error:"This match has no playable replay.",status:404 as const};
    return {replay,result:row.result,playedAt:row.playedAt};
  }catch{return {error:"This replay could not be read.",status:500 as const}}
}

export async function challengeOpponent(user: AuthUser, competitionId: string, opponentId: string) {
  await ensureCompetitionSchema();
  await expireAssignments(competitionId);
  if (!opponentId || opponentId === user.id) return { error:"Choose another competitor.",status:400 as const };
  const db=await getDatabase(),nowMs=Date.now(),now=new Date(nowMs).toISOString(),cutoff=new Date(nowMs-PRESENCE_MS).toISOString();
  const competition=await db.prepare("SELECT status,ends_at AS ends FROM competitions WHERE id=?").bind(competitionId).first<{status:string;ends:string}>();
  if (!competition||competition.status!=="active"||now>competition.ends) return {error:"This live event has ended.",status:409 as const};
  const pair=await db.prepare("SELECT id,player_a_id AS playerAId,player_b_id AS playerBId,status FROM competition_pairings WHERE competition_id=? AND ((player_a_id=? AND player_b_id=?) OR (player_a_id=? AND player_b_id=?)) LIMIT 1").bind(competitionId,user.id,opponentId,opponentId,user.id).first<{id:string;playerAId:string;playerBId:string;status:string}>();
  if (!pair) return {error:"That opponent is not in this competition.",status:404 as const};
  if (pair.status==="completed") return {error:"You have already completed this matchup.",status:409 as const};
  if (pair.status!=="pending") return {error:"This matchup already has an active invitation or battle.",status:409 as const};
  const claimed=await db.prepare("UPDATE competition_queue_entries SET status='assigned',pairing_id=?,updated_at=? WHERE competition_id=? AND player_id IN (?,?) AND status='waiting' AND updated_at>=?").bind(pair.id,now,competitionId,user.id,opponentId,cutoff).run();
  if (changes(claimed)!==2) {
    await db.prepare("UPDATE competition_queue_entries SET status='waiting',pairing_id=NULL,updated_at=? WHERE competition_id=? AND pairing_id=?").bind(now,competitionId,pair.id).run();
    return {error:"That player is offline or already handling another invitation.",status:409 as const};
  }
  const acceptedColumn=pair.playerAId===user.id?"player_a_accepted_at":"player_b_accepted_at";
  const offered=await db.prepare(`UPDATE competition_pairings SET status='assigned',acceptance_expires_at=?,${acceptedColumn}=?,updated_at=? WHERE id=? AND status='pending'`).bind(nowMs+ACCEPTANCE_SECONDS*1000,nowMs,now,pair.id).run();
  if (!changes(offered)) {
    await db.prepare("UPDATE competition_queue_entries SET status='waiting',pairing_id=NULL,updated_at=? WHERE competition_id=? AND pairing_id=?").bind(now,competitionId,pair.id).run();
    return {error:"Another invitation reached one of you first.",status:409 as const};
  }
  return {invited:true,pairingId:pair.id,acceptanceExpiresAt:nowMs+ACCEPTANCE_SECONDS*1000};
}

export async function acceptAssignment(user: AuthUser, competitionId: string, pairingId: string) {
  await ensureCompetitionSchema();
  await expireAssignments(competitionId);
  const db = await getDatabase();
  const now = Date.now();
  const pair = await db.prepare("SELECT cp.player_a_id AS playerAId,cp.player_b_id AS playerBId,cp.status,cp.acceptance_expires_at AS expires,c.status AS competitionStatus,c.ends_at AS ends FROM competition_pairings cp INNER JOIN competitions c ON c.id=cp.competition_id WHERE cp.id=? AND cp.competition_id=?").bind(pairingId,competitionId).first<{playerAId:string;playerBId:string;status:string;expires:number|null;competitionStatus:string;ends:string}>();
  if (!pair || pair.competitionStatus!=="active" || new Date(pair.ends).getTime()<=now) return {error:"This competition has ended; the invitation no longer counts.",status:409 as const};
  if (![pair.playerAId,pair.playerBId].includes(user.id) || pair.status !== "assigned" || !pair.expires || pair.expires <= now) return { error:"This assignment expired; stay on standby for another offer.",status:409 as const };
  const column = pair.playerAId === user.id ? "player_a_accepted_at" : "player_b_accepted_at";
  await db.prepare(`UPDATE competition_pairings SET ${column}=?,updated_at=? WHERE id=? AND status='assigned'`).bind(now,new Date(now).toISOString(),pairingId).run();
  const accepted = await db.prepare("SELECT player_a_accepted_at AS a,player_b_accepted_at AS b FROM competition_pairings WHERE id=?").bind(pairingId).first<{a:number|null;b:number|null}>();
  if (!accepted?.a || !accepted.b) return { accepted:true };
  const claim = await db.prepare("UPDATE competition_pairings SET status='launching',updated_at=? WHERE id=? AND status='assigned'").bind(new Date(now).toISOString(),pairingId).run();
  if (!changes(claim)) return { accepted:true };
  const context = await db.prepare(`SELECT c.rules_json AS rules,qa.bot_json AS botA,qb.bot_json AS botB,
      pa.id AS aId,pa.handle AS aHandle,pa.display_name AS aName,pa.role AS aRole,
      pb.id AS bId,pb.handle AS bHandle,pb.display_name AS bName,pb.role AS bRole
    FROM competition_pairings cp INNER JOIN competitions c ON c.id=cp.competition_id
    INNER JOIN competition_queue_entries qa ON qa.competition_id=cp.competition_id AND qa.player_id=cp.player_a_id
    INNER JOIN competition_queue_entries qb ON qb.competition_id=cp.competition_id AND qb.player_id=cp.player_b_id
    INNER JOIN players pa ON pa.id=cp.player_a_id INNER JOIN players pb ON pb.id=cp.player_b_id
    WHERE cp.id=?`).bind(pairingId).first<Record<string, unknown>>();
  if (!context?.botA || !context.botB) {
    await resetPairing(db,competitionId,pairingId);
    return { error:"A competitor bot is no longer available; both players were returned to standby.",status:409 as const };
  }
  const rules = normalizeRules(JSON.parse(String(context.rules)));
  const host: AuthUser = { id:String(context.aId),handle:String(context.aHandle),displayName:String(context.aName),role:context.aRole === "admin" ? "admin" : "player" };
  const guest: AuthUser = { id:String(context.bId),handle:String(context.bHandle),displayName:String(context.bName),role:context.bRole === "admin" ? "admin" : "player" };
  const created = await createCompetitionOnlineRoom(host,guest,JSON.parse(String(context.botA)),JSON.parse(String(context.botB)),rules.controlModes[0],rules.roundSeconds,rules.actionIntervalMs);
  if ("error" in created) {
    await resetPairing(db,competitionId,pairingId);
    return created;
  }
  await db.batch([
    db.prepare("UPDATE competition_pairings SET status='live',room_id=?,updated_at=? WHERE id=?").bind(created.roomId,new Date().toISOString(),pairingId),
    db.prepare("UPDATE competition_queue_entries SET status='matched',updated_at=? WHERE competition_id=? AND pairing_id=?").bind(new Date().toISOString(),competitionId,pairingId),
  ]);
  return { accepted:true,roomId:created.roomId,mode:rules.controlModes[0] };
}

async function resetPairing(db: Awaited<ReturnType<typeof getDatabase>>, competitionId: string, pairingId: string) {
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE competition_pairings SET status='pending',acceptance_expires_at=NULL,player_a_accepted_at=NULL,player_b_accepted_at=NULL,room_id=NULL,updated_at=? WHERE id=?").bind(now,pairingId),
    db.prepare("UPDATE competition_queue_entries SET status='waiting',pairing_id=NULL,updated_at=? WHERE competition_id=? AND pairing_id=?").bind(now,competitionId,pairingId),
  ]);
}

export async function adminSave(user: AuthUser, input: Record<string, unknown>) {
  if (!isCompetitionAdmin(user)) return { error:"Owner access required.",status:403 as const };
  await ensureCompetitionSchema();
  const db = await getDatabase();
  const now = new Date().toISOString();
  const id = typeof input.id === "string" && input.id ? input.id.slice(0,80) : crypto.randomUUID();
  const existing = await db.prepare("SELECT status,rules_version AS version,access_code_hash AS codeHash FROM competitions WHERE id=?").bind(id).first<{status:CompetitionStatus;version:number;codeHash:string|null}>();
  if (existing && existing.status !== "draft") return { error:"Published rules are frozen. Create a new competition revision.",status:409 as const };
  const title = String(input.title ?? "").trim().slice(0,80);
  if (title.length < 3) return { error:"A competition title is required.",status:400 as const };
  const startsAt = new Date(String(input.startsAt)).toISOString();
  const endsAt = new Date(String(input.endsAt)).toISOString();
  const opensAt = new Date(String(input.registrationOpensAt ?? now)).toISOString();
  if (!(opensAt < startsAt && startsAt < endsAt)) return { error:"Registration must open before the event starts, and the end must be later.",status:400 as const };
  const isPrivate = Boolean(input.isPrivate);
  const accessCode = String(input.accessCode ?? "").trim();
  if (isPrivate && !existing?.codeHash && (accessCode.length < 4 || accessCode.length > 24)) return { error:"Private competition codes must be 4-24 characters.",status:400 as const };
  const codeHash = isPrivate ? (accessCode ? await sha256(accessCode) : existing?.codeHash) : null;
  const rules = normalizeRules(input.rules);
  await db.prepare(`INSERT INTO competitions (id,title,description,status,is_private,access_code_hash,max_players,registration_opens_at,starts_at,ends_at,rules_version,rules_json,created_by,created_at,updated_at)
    VALUES (?,?,?,'draft',?,?,8,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,
    is_private=excluded.is_private,access_code_hash=excluded.access_code_hash,registration_opens_at=excluded.registration_opens_at,
    starts_at=excluded.starts_at,ends_at=excluded.ends_at,rules_json=excluded.rules_json,updated_at=excluded.updated_at`)
    .bind(id,title,String(input.description??"").slice(0,500),isPrivate?1:0,codeHash,opensAt,startsAt,endsAt,existing?.version??1,JSON.stringify(rules),user.id,now,now).run();
  await audit(db,user,"competition.save",id,{title,isPrivate,mode:rules.controlModes[0]});
  return { saved:true,id };
}

async function generatePairings(competitionId: string) {
  const db = await getDatabase();
  const roster = await db.prepare("SELECT player_id AS playerId FROM competition_enrollments WHERE competition_id=? ORDER BY player_id").bind(competitionId).all<{playerId:string}>();
  const now = new Date().toISOString();
  const statements = [];
  for (let a=0;a<roster.results.length;a+=1) for (let b=a+1;b<roster.results.length;b+=1) {
    const playerA=roster.results[a].playerId,playerB=roster.results[b].playerId;
    statements.push(db.prepare("INSERT OR IGNORE INTO competition_pairings (id,competition_id,player_a_id,player_b_id,status,created_at,updated_at) VALUES (?,?,?,?,'pending',?,?)").bind(`${competitionId}:${playerA}:${playerB}`,competitionId,playerA,playerB,now,now));
  }
  if (statements.length) await db.batch(statements);
}

export async function adminDelete(user: AuthUser, id: string) {
  if (!isCompetitionAdmin(user)) return {error:"Owner access required.",status:403 as const};
  await ensureCompetitionSchema();
  const db=await getDatabase();
  const existing=await db.prepare("SELECT title FROM competitions WHERE id=?").bind(id).first<{title:string}>();
  if (!existing) return {error:"Competition not found.",status:404 as const};
  await db.batch([
    db.prepare("DELETE FROM competition_results WHERE competition_id=?").bind(id),
    db.prepare("DELETE FROM competition_reward_claims WHERE competition_id=?").bind(id),
    db.prepare("DELETE FROM competition_queue_entries WHERE competition_id=?").bind(id),
    db.prepare("DELETE FROM competition_pairings WHERE competition_id=?").bind(id),
    db.prepare("DELETE FROM competition_enrollments WHERE competition_id=?").bind(id),
    db.prepare("DELETE FROM competitions WHERE id=?").bind(id),
  ]);
  await audit(db,user,"competition.delete",id,{title:existing.title});
  return {deleted:true};
}

export async function adminTransition(user: AuthUser, id: string, status: CompetitionStatus) {
  if (!isCompetitionAdmin(user)) return { error:"Owner access required.",status:403 as const };
  await ensureCompetitionSchema();
  const db=await getDatabase();
  const current=await db.prepare("SELECT status FROM competitions WHERE id=?").bind(id).first<{status:CompetitionStatus}>();
  if (!current) return { error:"Competition not found.",status:404 as const };
  const allowed: Partial<Record<CompetitionStatus,CompetitionStatus[]>> = { draft:["registration","cancelled"],registration:["active","cancelled"],active:["closed","cancelled"],closed:["archived"] };
  if (!allowed[current.status]?.includes(status)) return { error:`Cannot move ${current.status} to ${status}.`,status:409 as const };
  const now=new Date().toISOString();
  if (status === "active") {
    const roster=await db.prepare("SELECT COUNT(*) AS count FROM competition_enrollments WHERE competition_id=?").bind(id).first<{count:number}>();
    if (Number(roster?.count??0)<2) return { error:"At least two registered competitors are required to start.",status:409 as const };
    await db.prepare("UPDATE competitions SET status='active',starts_at=CASE WHEN starts_at>? THEN ? ELSE starts_at END,updated_at=? WHERE id=?").bind(now,now,now,id).run();
    await generatePairings(id);
  } else {
    await db.prepare("UPDATE competitions SET status=?,updated_at=? WHERE id=?").bind(status,now,id).run();
    if (status === "closed") { await sealCompetition(db,id,now);await awardCompetitionRewards(id); }
  }
  await audit(db,user,`competition.${status}`,id,{});
  return { updated:true };
}

async function awardCompetitionRewards(competitionId: string) {
  const db=await getDatabase();
  const competition=await db.prepare("SELECT rules_json AS rules FROM competitions WHERE id=?").bind(competitionId).first<{rules:string}>();
  if (!competition) return;
  const rules=normalizeRules(JSON.parse(competition.rules));
  const ranked=await standings(competitionId);
  const placement=new Map(ranked.slice(0,3).map((row)=>[row.playerId,row.rank]));
  const roster=await db.prepare("SELECT player_id AS playerId FROM competition_enrollments WHERE competition_id=?").bind(competitionId).all<{playerId:string}>();
  const now=new Date().toISOString();
  for (const row of roster.results) {
    const rank=placement.get(row.playerId);
    const champion=rank===1?rules.rewards.first:rank===2?rules.rewards.second:rank===3?rules.rewards.third:{gold:0,xp:0};
    const reward={gold:rules.rewards.participation.gold+champion.gold,xp:rules.rewards.participation.xp+champion.xp};
    const current=await getOnlineProfile(row.playerId);
    if (!current) continue;
    const next={...current.profile,gold:current.profile.gold+reward.gold,xp:current.profile.xp+reward.xp};
    await db.batch([
      db.prepare("UPDATE online_profiles SET profile=?,revision=revision+1,updated_at=? WHERE player_id=? AND NOT EXISTS (SELECT 1 FROM competition_reward_claims WHERE competition_id=? AND player_id=?)").bind(JSON.stringify(next),now,row.playerId,competitionId,row.playerId),
      db.prepare("UPDATE players SET gold_balance=gold_balance+?,total_xp=total_xp+?,updated_at=? WHERE id=? AND NOT EXISTS (SELECT 1 FROM competition_reward_claims WHERE competition_id=? AND player_id=?)").bind(reward.gold,reward.xp,now,row.playerId,competitionId,row.playerId),
      db.prepare("INSERT OR IGNORE INTO competition_reward_claims (competition_id,player_id,placement,gold,xp,created_at) VALUES (?,?,?,?,?,?)").bind(competitionId,row.playerId,rank??null,reward.gold,reward.xp,now),
    ]);
  }
}

async function audit(db: Awaited<ReturnType<typeof getDatabase>>, user: AuthUser, action: string, target: string, details: object) {
  await db.prepare("INSERT INTO admin_audit_events (id,admin_player_id,action,target_id,details_json,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(),user.id,action,target,JSON.stringify(details),new Date().toISOString()).run();
}
