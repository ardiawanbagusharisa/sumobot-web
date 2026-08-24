import { getDatabase } from "@/lib/db/server";
import { ensureAuthSchema, type AuthUser } from "@/lib/auth/server";
import { marketItems } from "@/lib/game/prototype-data";
import { PRIMITIVE_SCRIPT } from "@/lib/game/rules";
import { defaultOnlineProfile, type StoredProfile } from "@/lib/profile/default";


export interface ProfileEnvelope { profile: StoredProfile; revision: number }

let schemaReady = false;


export async function ensureProfileSchema() {
  if (schemaReady) return;
  await ensureAuthSchema();
  const d1 = await getDatabase();
  await d1.prepare(`CREATE TABLE IF NOT EXISTS online_profiles (
    player_id TEXT PRIMARY KEY NOT NULL REFERENCES players(id),
    profile TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    imported_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
  schemaReady = true;
}

function boundedArray(value: unknown, maximum: number) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object").slice(-maximum) as Array<Record<string, unknown>> : [];
}

function normalizeProfile(value: unknown, economy?: { gold: number; xp: number }, preserve?: StoredProfile): StoredProfile {
  const input = value && typeof value === "object" ? value as Partial<StoredProfile> : {};
  const fallback = preserve ?? defaultOnlineProfile();
  const availableIds = new Set(marketItems.map((item) => item.id));
  const owned = preserve?.owned ?? (Array.isArray(input.owned) ? input.owned.filter((id): id is string => typeof id === "string" && availableIds.has(id as never)).slice(0, 100) : fallback.owned);
  const ownedSet = new Set(owned);
  const bots = boundedArray(input.bots, 3).map((bot) => {
    const loadout = bot.loadout && typeof bot.loadout === "object" ? bot.loadout as Record<string, unknown> : {};
    return {
      ...bot,
      id: typeof bot.id === "string" ? bot.id.slice(0, 80) : crypto.randomUUID(),
      name: typeof bot.name === "string" ? bot.name.slice(0, 24) : "Sumobot",
      skill: bot.skill === "stone" ? "stone" : "boost",
      scriptId: typeof bot.scriptId === "string" ? bot.scriptId.slice(0, 80) : null,
      loadout: Object.fromEntries(["wheel", "body", "face", "accessory"].map((slot) => {
        const item = typeof loadout[slot] === "string" && ownedSet.has(loadout[slot] as string) ? loadout[slot] : null;
        return [slot, item];
      })),
    };
  });
  return {
    bots: bots.length ? bots : fallback.bots,
    scripts: boundedArray(input.scripts, 3).map((script) => ({
      ...script,
      id: typeof script.id === "string" ? script.id.slice(0, 80) : crypto.randomUUID(),
      name: typeof script.name === "string" ? script.name.slice(0, 60) : "Strategy",
      source: typeof script.source === "string" ? script.source.slice(0, 40_000) : PRIMITIVE_SCRIPT,
    })),
    analytics: input.analytics && typeof input.analytics === "object" && !Array.isArray(input.analytics) ? input.analytics as Record<string, unknown[]> : {},
    battleHistory: boundedArray(input.battleHistory, 50),
    owned,
    gold: Math.max(0, Math.floor(economy?.gold ?? preserve?.gold ?? Number(input.gold ?? fallback.gold))),
    xp: Math.max(0, Math.floor(economy?.xp ?? preserve?.xp ?? Number(input.xp ?? fallback.xp))),
    campaignCompleted: preserve?.campaignCompleted ?? Boolean(input.campaignCompleted),
  };
}

export async function getOnlineProfile(playerId: string): Promise<ProfileEnvelope | null> {
  await ensureProfileSchema();
  const d1 = await getDatabase();
  const row = await d1.prepare("SELECT profile, revision FROM online_profiles WHERE player_id = ? LIMIT 1").bind(playerId).first<{ profile: string; revision: number }>();
  if (!row) return null;
  return { profile: normalizeProfile(JSON.parse(row.profile)), revision: Number(row.revision) };
}

export async function importOnlineProfile(user: AuthUser, candidate: unknown): Promise<ProfileEnvelope> {
  await ensureProfileSchema();
  const d1 = await getDatabase();
  const existing = await getOnlineProfile(user.id);
  if (existing) return existing;
  const player = await d1.prepare("SELECT total_xp AS xp, gold_balance AS gold FROM players WHERE id = ?").bind(user.id).first<{ xp: number; gold: number }>();
  const imported = normalizeProfile(candidate);
  if (player && (Number(player.xp) > 0 || Number(player.gold) > 0)) {
    imported.xp = Number(player.xp);
    imported.gold = Number(player.gold);
  }
  const now = new Date().toISOString();
  await d1.batch([
    d1.prepare("INSERT OR IGNORE INTO online_profiles (player_id, profile, revision, imported_at, updated_at) VALUES (?, ?, 1, ?, ?)").bind(user.id, JSON.stringify(imported), now, now),
    d1.prepare("UPDATE players SET total_xp = ?, gold_balance = ?, updated_at = ? WHERE id = ? AND total_xp = 0 AND gold_balance = 0").bind(imported.xp, imported.gold, now, user.id),
  ]);
  return (await getOnlineProfile(user.id)) ?? { profile: imported, revision: 1 };
}

export async function saveOnlineProfile(user: AuthUser, candidate: unknown, revision: number) {
  const current = await getOnlineProfile(user.id) ?? await importOnlineProfile(user, null);
  if (current.revision !== revision) return { conflict: true as const, ...current };
  const next = normalizeProfile(candidate, { gold: current.profile.gold, xp: current.profile.xp }, current.profile);
  const now = new Date().toISOString();
  const d1 = await getDatabase();
  const result = await d1.prepare("UPDATE online_profiles SET profile = ?, revision = revision + 1, updated_at = ? WHERE player_id = ? AND revision = ?")
    .bind(JSON.stringify(next), now, user.id, revision).run();
  if (!(result as { meta?: { changes?: number } }).meta?.changes) return { conflict: true as const, ...(await getOnlineProfile(user.id) ?? current) };
  return { conflict: false as const, profile: next, revision: revision + 1 };
}

export async function purchaseMarketItem(user: AuthUser, itemId: string) {
  const current = await getOnlineProfile(user.id) ?? await importOnlineProfile(user, null);
  const item = marketItems.find((entry) => entry.id === itemId);
  if (!item) return { error: "Unknown market item.", status: 404 as const };
  if (current.profile.owned.includes(itemId)) return { ...current, alreadyOwned: true };
  if (current.profile.gold < item.price) return { error: "Not enough gold yet.", status: 409 as const };
  const next = { ...current.profile, gold: current.profile.gold - item.price, owned: [...current.profile.owned, itemId] };
  const now = new Date().toISOString();
  const d1 = await getDatabase();
  const result = await d1.prepare("UPDATE online_profiles SET profile = ?, revision = revision + 1, updated_at = ? WHERE player_id = ? AND revision = ?")
    .bind(JSON.stringify(next), now, user.id, current.revision).run();
  if (!(result as { meta?: { changes?: number } }).meta?.changes) return { error: "Profile changed; try again.", status: 409 as const };
  await d1.prepare("UPDATE players SET gold_balance = ?, updated_at = ? WHERE id = ?").bind(next.gold, now, user.id).run();
  return { profile: next, revision: current.revision + 1, alreadyOwned: false };
}

export async function applyProfileReward(playerId: string, result: "win" | "draw" | "loss", reward: { xp: number; gold: number }, historyEntry?: Record<string, unknown>) {
  const current = await getOnlineProfile(playerId);
  if (!current) return null;
  const next = {
    ...current.profile,
    xp: current.profile.xp + reward.xp,
    gold: current.profile.gold + reward.gold,
    battleHistory: historyEntry ? [...current.profile.battleHistory, historyEntry].slice(-50) : current.profile.battleHistory,
  };
  return { current, next, result };
}
