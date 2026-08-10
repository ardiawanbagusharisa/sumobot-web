import { getDatabase } from "@/lib/db/server";
import { ensureAuthSchema, type AuthUser } from "@/lib/auth/server";
import { HOME_DEMO_META, HOME_DEMO_REPLAY } from "@/lib/game/demo-replay";
import { CAMPAIGN_REWARD_RULES, MATCH_OUTCOME_RULES } from "@/lib/game/rules";
import { getOnlineProfile, importOnlineProfile } from "@/lib/profile/server";

type ControlMode = "buttons" | "live" | "script";
type BattleMode = "pvai" | "pvp";
type MatchResult = "win" | "draw" | "loss";

export interface MatchSubmission {
  id: string;
  botId: string;
  botName: string;
  scriptId?: string | null;
  controlMode: ControlMode;
  battleMode: BattleMode;
  result: MatchResult;
  telemetry: Record<string, unknown>;
  replay: Record<string, unknown>;
  playedAt: string;
  campaign?: boolean;
}

export interface DatabaseLeaderboardEntry {
  playerId: string;
  player: string;
  botId: string;
  bot: string;
  mode: ControlMode;
  battleMode: BattleMode;
  wins: number;
  draws: number;
  losses: number;
  points: number;
}

let schemaReady = false;

export async function ensureMatchSchema() {
  if (schemaReady) return;
  await ensureAuthSchema();
  const d1 = await getDatabase();
  await d1.batch([
    d1.prepare(`CREATE TABLE IF NOT EXISTS prototype_match_records (
      id TEXT PRIMARY KEY NOT NULL,
      player_id TEXT NOT NULL REFERENCES players(id),
      player_handle TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      bot_name TEXT NOT NULL,
      control_mode TEXT NOT NULL,
      battle_mode TEXT NOT NULL,
      result TEXT NOT NULL,
      rank_points REAL NOT NULL,
      telemetry TEXT NOT NULL,
      replay TEXT NOT NULL,
      played_at TEXT NOT NULL
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS idx_prototype_matches_rank ON prototype_match_records(battle_mode, control_mode, player_id, bot_id)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS idx_prototype_matches_played ON prototype_match_records(played_at)"),
    d1.prepare(`CREATE TABLE IF NOT EXISTS featured_replays (
      slot TEXT PRIMARY KEY NOT NULL,
      match_record_id TEXT NOT NULL REFERENCES prototype_match_records(id),
      replay TEXT NOT NULL,
      result TEXT NOT NULL,
      played_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
  ]);
  const featuredPool = await d1.prepare("SELECT slot FROM featured_replays WHERE slot LIKE 'home-%'").all<{ slot: string }>();
  if (featuredPool.results.length < 3) {
    const now = new Date().toISOString();
    const replayJson = JSON.stringify(HOME_DEMO_REPLAY);
    await d1.batch([
      d1.prepare(`INSERT OR IGNORE INTO players
        (id, handle, display_name, level, total_xp, gold_balance, unlocked_modes, created_at, updated_at)
        VALUES ('system-featured', 'sumobot', 'Sumobot Arena', 1, 0, 0, '["buttons"]', ?, ?)`)
        .bind(now, now),
      d1.prepare(`INSERT OR IGNORE INTO prototype_match_records
        (id, player_id, player_handle, bot_id, bot_name, control_mode, battle_mode, result, rank_points, telemetry, replay, played_at)
        VALUES ('match-featured-demo', 'system-featured', 'sumobot', 'vector-demo', 'Vector', 'buttons', 'pvai', 'win', 1, '{}', ?, ?)`)
        .bind(replayJson, HOME_DEMO_META.playedAt),
    ]);
    const recent = await d1.prepare(`SELECT id, replay, result, played_at AS playedAt
      FROM prototype_match_records WHERE player_id != 'system-featured'
      ORDER BY played_at DESC LIMIT 3`).all<{ id: string; replay: string; result: MatchResult; playedAt: string }>();
    const seeds = recent.results.length ? recent.results : [{ id: "match-featured-demo", replay: replayJson, result: "win" as const, playedAt: HOME_DEMO_META.playedAt }];
    await d1.batch(seeds.map((row, index) => d1.prepare(`INSERT INTO featured_replays
      (slot, match_record_id, replay, result, played_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(slot) DO UPDATE SET match_record_id = excluded.match_record_id, replay = excluded.replay,
      result = excluded.result, played_at = excluded.played_at, updated_at = excluded.updated_at`)
      .bind(`home-${index + 1}`, row.id, row.replay, row.result, row.playedAt, now)));
  }
  schemaReady = true;
}

export async function recordMatch(user: AuthUser, submission: MatchSubmission) {
  await ensureMatchSchema();
  const d1 = await getDatabase();
  const replayJson = JSON.stringify(submission.replay);
  const telemetryJson = JSON.stringify(submission.telemetry);
  const rule = MATCH_OUTCOME_RULES[submission.result];
  const points = rule.rankPoints;
  const updatedAt = new Date().toISOString();
  const current = await getOnlineProfile(user.id) ?? await importOnlineProfile(user, null);
  const campaignBonus = Boolean(submission.campaign && !current.profile.campaignCompleted);
  const rewards = {
    xp: rule.rewards.xp + (campaignBonus ? CAMPAIGN_REWARD_RULES.firstCompletion.xp : 0),
    gold: rule.rewards.gold + (campaignBonus ? CAMPAIGN_REWARD_RULES.firstCompletion.gold : 0),
  };
  const historyEntry = {
    id: submission.id,
    result: submission.result,
    mode: submission.controlMode,
    battleType: submission.battleMode,
    botId: submission.botId,
    scriptId: submission.controlMode === "script" ? submission.scriptId ?? null : null,
    playedAt: submission.playedAt,
    telemetry: submission.telemetry,
    replay: submission.replay,
  };
  const nextAnalytics = submission.controlMode === "script" && submission.scriptId
    ? { ...current.profile.analytics, [submission.scriptId]: [...(current.profile.analytics[submission.scriptId] ?? []).filter((entry) => entry && typeof entry === "object" && (entry as { id?: unknown }).id !== submission.id), { id: submission.id, result: submission.result, playedAt: submission.playedAt, telemetry: submission.telemetry }].slice(-30) }
    : current.profile.analytics;
  const nextProfile = {
    ...current.profile,
    xp: current.profile.xp + rewards.xp,
    gold: current.profile.gold + rewards.gold,
    campaignCompleted: current.profile.campaignCompleted || campaignBonus,
    analytics: nextAnalytics,
    battleHistory: [...current.profile.battleHistory.filter((entry) => entry.id !== submission.id), historyEntry].slice(-50),
  };
  const pool = await d1.prepare("SELECT slot FROM featured_replays WHERE slot LIKE 'home-%' ORDER BY updated_at ASC").all<{ slot: string }>();
  const targetSlot = pool.results.length < 3 ? `home-${pool.results.length + 1}` : pool.results[0].slot;
  await d1.batch([
    d1.prepare(`UPDATE online_profiles SET profile = ?, revision = revision + 1, updated_at = ?
      WHERE player_id = ? AND NOT EXISTS (SELECT 1 FROM prototype_match_records WHERE id = ?)`)
      .bind(JSON.stringify(nextProfile), updatedAt, user.id, submission.id),
    d1.prepare(`UPDATE players SET total_xp = total_xp + ?, gold_balance = gold_balance + ?, updated_at = ?
      WHERE id = ? AND NOT EXISTS (SELECT 1 FROM prototype_match_records WHERE id = ?)`)
      .bind(rewards.xp, rewards.gold, updatedAt, user.id, submission.id),
    d1.prepare(`INSERT INTO prototype_match_records
      (id, player_id, player_handle, bot_id, bot_name, control_mode, battle_mode, result, rank_points, telemetry, replay, played_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(submission.id, user.id, user.handle, submission.botId, submission.botName, submission.controlMode, submission.battleMode, submission.result, points, telemetryJson, replayJson, submission.playedAt),
    d1.prepare(`INSERT INTO featured_replays (slot, match_record_id, replay, result, played_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(slot) DO UPDATE SET match_record_id = excluded.match_record_id, replay = excluded.replay,
      result = excluded.result, played_at = excluded.played_at, updated_at = excluded.updated_at`)
      .bind(targetSlot, submission.id, replayJson, submission.result, submission.playedAt, updatedAt),
  ]);
  return { id: submission.id, points, rewards, profile: nextProfile, revision: current.revision + 1 };
}

export async function getFeaturedReplays() {
  await ensureMatchSchema();
  const d1 = await getDatabase();
  const rows = await d1.prepare(`SELECT replay, result, played_at AS playedAt
    FROM featured_replays WHERE slot LIKE 'home-%' ORDER BY slot LIMIT 3`)
    .all<{ replay: string; result: MatchResult; playedAt: string }>();
  return rows.results.map((row) => ({ replay: JSON.parse(row.replay) as Record<string, unknown>, result: row.result, playedAt: row.playedAt }));
}

export async function getLeaderboard() {
  await ensureMatchSchema();
  const d1 = await getDatabase();
  const rows = await d1.prepare(`SELECT
      player_id AS playerId,
      player_handle AS player,
      bot_id AS botId,
      bot_name AS bot,
      control_mode AS mode,
      battle_mode AS battleMode,
      SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN result = 'draw' THEN 1 ELSE 0 END) AS draws,
      SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) AS losses,
      SUM(rank_points) AS points
    FROM prototype_match_records
    WHERE player_id != 'system-featured'
    GROUP BY player_id, player_handle, bot_id, bot_name, control_mode, battle_mode
    ORDER BY points DESC, wins DESC, player_handle ASC`)
    .all<DatabaseLeaderboardEntry>();
  return rows.results.map((row) => ({ ...row, wins: Number(row.wins), draws: Number(row.draws), losses: Number(row.losses), points: Number(row.points) }));
}

export function validateMatchSubmission(value: unknown): MatchSubmission | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<MatchSubmission>;
  if (typeof item.id !== "string" || !/^match-[a-zA-Z0-9-]{6,80}$/.test(item.id)) return null;
  if (typeof item.botId !== "string" || item.botId.length > 80 || typeof item.botName !== "string" || item.botName.length < 1 || item.botName.length > 24) return null;
  if (item.scriptId !== undefined && item.scriptId !== null && (typeof item.scriptId !== "string" || item.scriptId.length > 80)) return null;
  if (!item.controlMode || !["buttons", "live", "script"].includes(item.controlMode)) return null;
  if (item.battleMode !== "pvai" || !item.result || !["win", "draw", "loss"].includes(item.result)) return null;
  if (!item.telemetry || typeof item.telemetry !== "object" || !item.replay || typeof item.replay !== "object") return null;
  const replayJson = JSON.stringify(item.replay);
  if (replayJson.length > 750_000) return null;
  if (typeof item.playedAt !== "string" || item.playedAt.length > 80) return null;
  if (item.campaign !== undefined && typeof item.campaign !== "boolean") return null;
  return item as MatchSubmission;
}
