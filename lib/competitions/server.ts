import type { AuthUser } from "@/lib/auth/server";
import { getDatabase } from "@/lib/db/server";
import { DEFAULT_COMPETITION_RULES, type CompetitionRuleSet, type CompetitionStatus } from "./types";

let ready = false;
async function ensureSchema() {
  if (ready) return;
  const db = await getDatabase();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS competitions (
      id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL,
      registration_opens_at TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
      rules_version INTEGER NOT NULL, rules_json TEXT NOT NULL, created_by TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS competition_enrollments (
      competition_id TEXT NOT NULL, player_id TEXT NOT NULL, enrolled_at TEXT NOT NULL,
      PRIMARY KEY (competition_id, player_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS competition_queue_entries (
      competition_id TEXT NOT NULL, player_id TEXT NOT NULL, bot_id TEXT NOT NULL, control_mode TEXT NOT NULL,
      status TEXT NOT NULL, joined_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (competition_id, player_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS competition_results (
      id TEXT PRIMARY KEY NOT NULL, competition_id TEXT NOT NULL, match_id TEXT NOT NULL,
      player_id TEXT NOT NULL, result TEXT NOT NULL, points REAL NOT NULL, played_at TEXT NOT NULL,
      UNIQUE (competition_id, match_id, player_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS admin_audit_events (
      id TEXT PRIMARY KEY NOT NULL, admin_player_id TEXT NOT NULL, action TEXT NOT NULL,
      target_id TEXT NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_competitions_status_dates ON competitions(status, starts_at, ends_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_competition_results_standings ON competition_results(competition_id, player_id)"),
  ]);
  ready = true;
}

export function isCompetitionAdmin(user: AuthUser) {
  return user.role === "admin";
}

function validateRules(value: unknown): CompetitionRuleSet {
  const input = value && typeof value === "object" ? value as Partial<CompetitionRuleSet> : {};
  const modes = Array.isArray(input.controlModes) ? input.controlModes.filter((mode): mode is "buttons" | "live" | "script" => ["buttons", "live", "script"].includes(String(mode))) : [];
  const round = [30, 60, 120].includes(Number(input.roundSeconds)) ? Number(input.roundSeconds) as 30 | 60 | 120 : DEFAULT_COMPETITION_RULES.roundSeconds;
  return {
    controlModes: modes.length ? [...new Set(modes)] : DEFAULT_COMPETITION_RULES.controlModes,
    roundSeconds: round,
    actionIntervalMs: Math.max(100, Math.min(1000, Math.floor(Number(input.actionIntervalMs ?? 250)))),
    arenaRadius: Math.max(150, Math.min(210, Math.floor(Number(input.arenaRadius ?? 188)))),
    matchLimit: Math.max(1, Math.min(100, Math.floor(Number(input.matchLimit ?? 20)))),
    scoring: {
      win: Math.max(0, Math.min(20, Number(input.scoring?.win ?? 3))),
      draw: Math.max(0, Math.min(20, Number(input.scoring?.draw ?? 1))),
      loss: Math.max(0, Math.min(20, Number(input.scoring?.loss ?? 0))),
    },
    tieBreakers: ["wins", "fewestLosses", "matches"],
    rewards: {
      first: Math.max(0, Math.min(10000, Math.floor(Number(input.rewards?.first ?? 500)))),
      second: Math.max(0, Math.min(10000, Math.floor(Number(input.rewards?.second ?? 300)))),
      third: Math.max(0, Math.min(10000, Math.floor(Number(input.rewards?.third ?? 150)))),
    },
  };
}

export async function listCompetitions(user?: AuthUser | null) {
  await ensureSchema(); const db = await getDatabase();
  const rows = await db.prepare(`SELECT c.*, CASE WHEN e.player_id IS NULL THEN 0 ELSE 1 END AS enrolled
    FROM competitions c LEFT JOIN competition_enrollments e ON e.competition_id = c.id AND e.player_id = ?
    WHERE c.status != 'draft' OR c.created_by = ? ORDER BY c.starts_at DESC LIMIT 30`).bind(user?.id ?? "", user?.id ?? "").all<Record<string, unknown>>();
  return rows.results.map((row) => ({
    id: row.id, title: row.title, description: row.description, status: row.status,
    registrationOpensAt: row.registration_opens_at, startsAt: row.starts_at, endsAt: row.ends_at,
    rulesVersion: row.rules_version, rules: JSON.parse(String(row.rules_json)), enrolled: Boolean(row.enrolled),
    createdAt: row.created_at, updatedAt: row.updated_at,
  }));
}

export async function enroll(user: AuthUser, competitionId: string) {
  await ensureSchema(); const db = await getDatabase(); const now = new Date().toISOString();
  const competition = await db.prepare("SELECT status, registration_opens_at AS opens, starts_at AS starts, ends_at AS ends FROM competitions WHERE id = ?").bind(competitionId).first<{ status: string; opens: string; starts: string; ends: string }>();
  if (!competition || !["registration", "active"].includes(competition.status)) return { error: "Competition registration is not open.", status: 409 as const };
  if (now < competition.opens || now > competition.ends) return { error: "Competition is outside its registration window.", status: 409 as const };
  await db.prepare("INSERT OR IGNORE INTO competition_enrollments (competition_id, player_id, enrolled_at) VALUES (?, ?, ?)").bind(competitionId, user.id, now).run();
  return { enrolled: true };
}

export async function enterQueue(user: AuthUser, competitionId: string, botId: string, mode: string) {
  await ensureSchema(); const db = await getDatabase(); const now = new Date().toISOString();
  const row = await db.prepare(`SELECT c.status, c.starts_at AS starts, c.ends_at AS ends, c.rules_json AS rules
    FROM competitions c INNER JOIN competition_enrollments e ON e.competition_id = c.id
    WHERE c.id = ? AND e.player_id = ?`).bind(competitionId, user.id).first<{ status: string; starts: string; ends: string; rules: string }>();
  if (!row || row.status !== "active" || now < row.starts || now > row.ends) return { error: "This competition queue is not active.", status: 409 as const };
  const rules = JSON.parse(row.rules) as CompetitionRuleSet;
  if (!rules.controlModes.includes(mode as never)) return { error: "That control mode is not eligible.", status: 400 as const };
  await db.prepare(`INSERT INTO competition_queue_entries (competition_id, player_id, bot_id, control_mode, status, joined_at, updated_at)
    VALUES (?, ?, ?, ?, 'waiting', ?, ?) ON CONFLICT(competition_id, player_id) DO UPDATE SET
    bot_id = excluded.bot_id, control_mode = excluded.control_mode, status = 'waiting', updated_at = excluded.updated_at`)
    .bind(competitionId, user.id, botId.slice(0, 80), mode, now, now).run();
  return { queued: true, queue: "competition" };
}

export async function standings(competitionId: string) {
  await ensureSchema(); const db = await getDatabase();
  const rows = await db.prepare(`SELECT r.player_id AS playerId, p.display_name AS displayName,
    SUM(r.points) AS points, SUM(CASE WHEN r.result='win' THEN 1 ELSE 0 END) AS wins,
    SUM(CASE WHEN r.result='draw' THEN 1 ELSE 0 END) AS draws,
    SUM(CASE WHEN r.result='loss' THEN 1 ELSE 0 END) AS losses, COUNT(*) AS matches
    FROM competition_results r INNER JOIN players p ON p.id = r.player_id WHERE r.competition_id = ?
    GROUP BY r.player_id, p.display_name ORDER BY points DESC, wins DESC, losses ASC, matches ASC LIMIT 200`).bind(competitionId).all<Record<string, unknown>>();
  return rows.results.map((row, index) => ({ ...row, rank: index + 1 }));
}

export async function adminSave(user: AuthUser, input: Record<string, unknown>) {
  if (!isCompetitionAdmin(user)) return { error: "Owner access required.", status: 403 as const };
  await ensureSchema(); const db = await getDatabase(); const now = new Date().toISOString();
  const id = typeof input.id === "string" && input.id ? input.id.slice(0, 80) : crypto.randomUUID();
  const existing = await db.prepare("SELECT status, rules_version AS version FROM competitions WHERE id = ?").bind(id).first<{ status: CompetitionStatus; version: number }>();
  if (existing && existing.status !== "draft") return { error: "Published rules are frozen. Create a new competition revision.", status: 409 as const };
  const title = String(input.title ?? "").trim().slice(0, 80);
  if (title.length < 3) return { error: "A competition title is required.", status: 400 as const };
  const startsAt = new Date(String(input.startsAt)).toISOString(), endsAt = new Date(String(input.endsAt)).toISOString();
  if (endsAt <= startsAt) return { error: "End time must be after start time.", status: 400 as const };
  const opensAt = new Date(String(input.registrationOpensAt ?? now)).toISOString();
  const rules = validateRules(input.rules);
  await db.prepare(`INSERT INTO competitions (id,title,description,status,registration_opens_at,starts_at,ends_at,rules_version,rules_json,created_by,created_at,updated_at)
    VALUES (?,?,?,'draft',?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,
    registration_opens_at=excluded.registration_opens_at,starts_at=excluded.starts_at,ends_at=excluded.ends_at,rules_json=excluded.rules_json,updated_at=excluded.updated_at`)
    .bind(id,title,String(input.description??"").slice(0,500),opensAt,startsAt,endsAt,existing?.version??1,JSON.stringify(rules),user.id,now,now).run();
  await audit(db,user,"competition.save",id,{ title }); return { saved: true, id };
}

export async function adminTransition(user: AuthUser, id: string, status: CompetitionStatus) {
  if (!isCompetitionAdmin(user)) return { error: "Owner access required.", status: 403 as const };
  const allowed: CompetitionStatus[] = ["registration","active","closed","cancelled","archived"];
  if (!allowed.includes(status)) return { error: "Invalid status transition.", status: 400 as const };
  await ensureSchema(); const db=await getDatabase(); const now=new Date().toISOString();
  await db.prepare("UPDATE competitions SET status = ?, updated_at = ? WHERE id = ?").bind(status,now,id).run();
  await audit(db,user,`competition.${status}`,id,{}); return { updated:true };
}
async function audit(db: Awaited<ReturnType<typeof getDatabase>>, user: AuthUser, action: string, target: string, details: object) {
  await db.prepare("INSERT INTO admin_audit_events (id,admin_player_id,action,target_id,details_json,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(),user.id,action,target,JSON.stringify(details),new Date().toISOString()).run();
}
