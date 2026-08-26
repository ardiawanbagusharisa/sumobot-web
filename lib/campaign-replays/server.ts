import { getDatabase } from "@/lib/db/server";
import type { AuthUser } from "@/lib/auth/server";
import type { CampaignReplayData } from "@/lib/game/campaign-replay";

let ready = false;

interface ReplayBucket { put(key: string, value: string): Promise<unknown>; get(key: string): Promise<{ text(): Promise<string> } | null> }

async function storage(): Promise<ReplayBucket> {
  const runtime = await import("cloudflare:workers");
  return runtime.env.REPLAYS as unknown as ReplayBucket;
}

async function ensureSchema() {
  if (ready) return;
  const db = await getDatabase();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS campaign_replays (
      id TEXT PRIMARY KEY NOT NULL,
      player_id TEXT NOT NULL,
      level_id TEXT NOT NULL,
      slot TEXT NOT NULL,
      content_version INTEGER NOT NULL,
      completed INTEGER NOT NULL,
      stars INTEGER NOT NULL,
      duration_seconds REAL NOT NULL,
      object_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_replays_player_level_slot ON campaign_replays(player_id, level_id, slot)"),
  ]);
  ready = true;
}

function validReplay(value: unknown): value is CampaignReplayData {
  if (!value || typeof value !== "object") return false;
  const replay = value as Partial<CampaignReplayData>;
  return replay.kind === "campaign" && replay.schemaVersion === 1 && Boolean(replay.mission?.levelId)
    && Array.isArray(replay.frames) && replay.frames.length > 1 && replay.frames.length <= 10_000
    && Array.isArray(replay.events) && replay.events.length <= 2_000;
}

export async function saveCampaignReplay(user: AuthUser, value: unknown) {
  if (!validReplay(value)) return { error: "Invalid campaign replay.", status: 400 as const };
  await ensureSchema();
  const db = await getDatabase();
  const bucket = await storage();
  const now = new Date().toISOString();
  const levelId = value.mission.levelId;
  const existingBest = await db.prepare("SELECT stars, duration_seconds AS duration FROM campaign_replays WHERE player_id = ? AND level_id = ? AND slot = 'best' LIMIT 1").bind(user.id, levelId).first<{ stars: number; duration: number }>();
  const isBest = !existingBest || value.result.stars > existingBest.stars || (value.result.stars === existingBest.stars && value.result.seconds < existingBest.duration);
  const slots = isBest ? ["latest", "best"] : ["latest"];
  for (const slot of slots) {
    const id = crypto.randomUUID();
    const key = `campaign/${user.id}/${levelId}/${slot}.json`;
    await bucket.put(key, JSON.stringify(value));
    await db.prepare(`INSERT INTO campaign_replays
      (id, player_id, level_id, slot, content_version, completed, stars, duration_seconds, object_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(player_id, level_id, slot) DO UPDATE SET
        id = excluded.id, content_version = excluded.content_version, completed = excluded.completed,
        stars = excluded.stars, duration_seconds = excluded.duration_seconds, object_key = excluded.object_key, updated_at = excluded.updated_at`)
      .bind(id, user.id, levelId, slot, value.mission.contentVersion, value.result.completed ? 1 : 0, value.result.stars, value.result.seconds, key, now, now).run();
  }
  return { saved: true, slots };
}

export async function getCampaignReplay(user: AuthUser, levelId: string, slot: "best" | "latest") {
  await ensureSchema();
  const db = await getDatabase();
  const row = await db.prepare("SELECT object_key AS objectKey FROM campaign_replays WHERE player_id = ? AND level_id = ? AND slot = ? LIMIT 1").bind(user.id, levelId, slot).first<{ objectKey: string }>();
  if (!row) return null;
  const object = await (await storage()).get(row.objectKey);
  if (!object) return null;
  return JSON.parse(await object.text()) as CampaignReplayData;
}

export async function listCampaignReplayMetadata(user: AuthUser) {
  await ensureSchema();
  const db = await getDatabase();
  const result = await db.prepare(`SELECT level_id AS levelId, slot, content_version AS contentVersion,
    completed, stars, duration_seconds AS durationSeconds, updated_at AS updatedAt
    FROM campaign_replays WHERE player_id = ? ORDER BY updated_at DESC LIMIT 72`).bind(user.id).all();
  return result.results;
}
