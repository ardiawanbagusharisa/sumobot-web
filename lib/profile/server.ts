import { getDatabase } from "@/lib/db/server";
import { ensureAuthSchema, type AuthUser } from "@/lib/auth/server";
import { marketItems } from "@/lib/game/prototype-data";
import { PLAYER_SCRIPT_LIMIT, PRIMITIVE_SCRIPT } from "@/lib/game/rules";
import { campaignChapters, campaignLevels, levelsForChapter, type CampaignAttempt } from "@/lib/game/campaign";
import { parseBotScript } from "@/lib/game/script-runtime";
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

function normalizeCampaignProgress(value: unknown, preserve?: StoredProfile["campaignProgress"]) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const validIds = new Set(campaignLevels.map((level) => level.id));
  return Object.fromEntries(Object.entries(input).filter(([id, item]) => validIds.has(id) && item && typeof item === "object").map(([id, item]) => {
    const entry = item as Record<string, unknown>;
    const previous = preserve?.[id] ?? {};
    const stars = Math.max(0, Math.min(3, Math.floor(Number(entry.bestStars ?? previous.bestStars ?? 0))));
    const status = stars >= 3 ? "mastered" : stars >= 1 ? "completed" : entry.status === "active" ? "active" : "available";
    return [id, {
      levelId: id,
      status,
      attempts: Math.max(0, Math.min(10_000, Math.floor(Number(entry.attempts ?? previous.attempts ?? 0)))),
      bestStars: stars,
      bestScore: Math.max(0, Number(entry.bestScore ?? previous.bestScore ?? 0)),
      firstAttemptSeconds: Number(entry.firstAttemptSeconds ?? previous.firstAttemptSeconds) || undefined,
      bestAttemptSeconds: Number(entry.bestAttemptSeconds ?? previous.bestAttemptSeconds) || undefined,
      bestCollisions: Number(entry.bestCollisions ?? previous.bestCollisions) || 0,
      bestActions: Number(entry.bestActions ?? previous.bestActions) || 0,
      hintsViewed: Math.max(0, Math.min(10, Math.floor(Number(entry.hintsViewed ?? previous.hintsViewed ?? 0)))),
      lastCode: typeof entry.lastCode === "string" ? entry.lastCode.slice(0, 40_000) : previous.lastCode,
      completedAt: typeof entry.completedAt === "string" ? entry.completedAt.slice(0, 80) : previous.completedAt,
      rewardsClaimed: Boolean(previous.rewardsClaimed || entry.rewardsClaimed),
      completedLessonSteps: Array.isArray(entry.completedLessonSteps) ? entry.completedLessonSteps.filter((item): item is string => typeof item === "string").slice(0, 12) : previous.completedLessonSteps,
      masteryScore: Math.max(0, Math.min(100, Number(entry.masteryScore ?? previous.masteryScore ?? 0))),
      improvementPercent: Math.max(-100, Math.min(100, Number(entry.improvementPercent ?? previous.improvementPercent ?? 0))),
    }];
  }));
}

function normalizedLicenses(value: unknown, preserve?: string[]) {
  const valid = new Set(campaignChapters.map((chapter) => String(chapter.number)));
  return Array.from(new Set([...(preserve ?? []), ...(Array.isArray(value) ? value : [])].filter((item): item is string => typeof item === "string" && valid.has(item))));
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
    scripts: boundedArray(input.scripts, PLAYER_SCRIPT_LIMIT).map((script) => ({
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
    campaignCompleted: Boolean(preserve?.campaignCompleted || input.campaignCompleted),
    campaignProgress: normalizeCampaignProgress(input.campaignProgress, preserve?.campaignProgress),
    campaignLicenses: normalizedLicenses(input.campaignLicenses, preserve?.campaignLicenses),
  };
}

export async function getOnlineProfile(playerId: string): Promise<ProfileEnvelope | null> {
  await ensureProfileSchema();
  const d1 = await getDatabase();
  const row = await d1.prepare("SELECT profile, revision FROM online_profiles WHERE player_id = ? LIMIT 1").bind(playerId).first<{ profile: string; revision: number }>();
  if (!row) return null;
  const profile=normalizeProfile(JSON.parse(row.profile));
  const competitions=await d1.prepare(`SELECT cp.room_id AS roomId,c.id AS competitionId,c.title AS competitionTitle FROM competition_pairings cp INNER JOIN competitions c ON c.id=cp.competition_id WHERE cp.player_a_id=? OR cp.player_b_id=?`).bind(playerId,playerId).all<{roomId:string|null;competitionId:string;competitionTitle:string}>();
  if(competitions.results.length)profile.battleHistory=profile.battleHistory.map((entry)=>{
    if(entry.competitionId)return entry;
    const match=competitions.results.find((item)=>item.roomId&&entry.id===`match-${item.roomId}-${playerId}`);
    return match?{...entry,competitionId:match.competitionId,competitionTitle:match.competitionTitle}:entry;
  });
  return { profile, revision: Number(row.revision) };
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

export async function claimCampaignLevel(user: AuthUser, levelId: string, attemptValue: unknown) {
  const level = campaignLevels.find((entry) => entry.id === levelId);
  if (!level) return { error: "Unknown campaign mission.", status: 404 as const };
  const attempt = attemptValue && typeof attemptValue === "object" ? attemptValue as Partial<CampaignAttempt> : {};
  if (!attempt.completed) return { error: "The mission objective was not completed.", status: 400 as const };
  const durationRaw = Number(attempt.durationSeconds);
  const collisionsRaw = Number(attempt.collisions);
  const actionsRaw = Number(attempt.actions);
  const checkpointsRaw = Math.max(0, Math.floor(Number(attempt.checkpoints ?? 0)));
  if (![durationRaw, collisionsRaw, actionsRaw].every(Number.isFinite) || durationRaw < 0.1 || durationRaw > level.durationSeconds + 1) return { error: "Campaign evidence is outside the mission bounds.", status: 400 as const };
  if (level.checkpoints.length && checkpointsRaw < level.checkpoints.length) return { error: "Required checkpoints were not completed.", status: 400 as const };
  if (level.kind === "survival" && durationRaw < level.durationSeconds - 1) return { error: "The survival timer was not completed.", status: 400 as const };
  const maximumActions = Math.ceil(level.durationSeconds * 1000 / Math.max(50, level.playerTickMs)) * 5 + 10;
  if (actionsRaw < 0 || actionsRaw > maximumActions || collisionsRaw < 0 || collisionsRaw > 10_000) return { error: "Campaign telemetry could not be verified.", status: 400 as const };
  if (level.mode === "script") {
    if (typeof attempt.code !== "string" || !attempt.code.trim() || attempt.code.length > 40_000) return { error: "A valid mission program is required.", status: 400 as const };
    try { parseBotScript(attempt.code); } catch { return { error: "The submitted mission program does not compile.", status: 400 as const }; }
  }
  const current = await getOnlineProfile(user.id) ?? await importOnlineProfile(user, null);
  const previous = current.profile.campaignProgress[level.id] ?? {};
  const previousStars = Math.max(0, Number(previous.bestStars ?? 0));
  const duration = Math.max(0.1, Math.min(level.durationSeconds, durationRaw));
  const collisions = Math.max(0, Math.floor(collisionsRaw));
  const actions = Math.max(0, Math.floor(actionsRaw));
  const within = (target: typeof level.star2) => (target.maxSeconds === undefined || duration <= target.maxSeconds) && (target.maxCollisions === undefined || collisions <= target.maxCollisions) && (target.maxActions === undefined || actions <= target.maxActions);
  const stars = within(level.star3) ? 3 : within(level.star2) ? 2 : 1;
  const completedSteps = Array.isArray(attempt.completedLessonSteps) ? attempt.completedLessonSteps.filter((id): id is string => typeof id === "string" && level.lessonSteps.some((step) => step.id === id)) : [];
  const errorCount = Array.isArray(attempt.runtimeErrors) ? Math.min(20, attempt.runtimeErrors.length) : 0;
  const independence = Math.max(0, 1 - Number(attempt.hintsViewed ?? 0) / Math.max(1, level.hints.length));
  const masteryScore = Math.round(stars / 3 * 55 + independence * 20 + Math.max(0, 1 - errorCount / 5) * 15 + completedSteps.length / level.lessonSteps.length * 10);
  const firstReward = !previous.rewardsClaimed;
  const nextProgress: StoredProfile["campaignProgress"] = {
    ...current.profile.campaignProgress,
    [level.id]: {
      ...previous,
      levelId: level.id,
      status: Math.max(previousStars, stars) >= 3 ? "mastered" : "completed",
      attempts: Math.max(1, Number(previous.attempts ?? 0) + 1),
      bestStars: Math.max(previousStars, stars),
      bestScore: Math.max(Number(previous.bestScore ?? 0), Number(attempt.score ?? 0)),
      firstAttemptSeconds: Number(previous.firstAttemptSeconds ?? duration),
      bestAttemptSeconds: Math.min(Number(previous.bestAttemptSeconds ?? duration), duration),
      bestCollisions: Math.min(Number(previous.bestCollisions ?? collisions), collisions),
      bestActions: Math.min(Number(previous.bestActions ?? actions), actions),
      hintsViewed: Math.max(Number(previous.hintsViewed ?? 0), Number(attempt.hintsViewed ?? 0)),
      lastCode: typeof attempt.code === "string" ? attempt.code.slice(0, 40_000) : previous.lastCode,
      completedAt: typeof previous.completedAt === "string" ? previous.completedAt : new Date().toISOString(),
      rewardsClaimed: true,
      completedLessonSteps: Array.from(new Set([...(Array.isArray(previous.completedLessonSteps) ? previous.completedLessonSteps : []), ...completedSteps])),
      masteryScore: Math.max(Number(previous.masteryScore ?? 0), masteryScore),
      improvementPercent: previous.firstAttemptSeconds ? Math.round((Number(previous.firstAttemptSeconds) - Math.min(Number(previous.bestAttemptSeconds ?? duration), duration)) / Number(previous.firstAttemptSeconds) * 100) : 0,
    },
  };
  const chapterKey = String(level.chapter);
  const chapterCompleted = levelsForChapter(level.chapter).every((entry) => Number(nextProgress[entry.id]?.bestStars ?? 0) >= 1);
  const firstLicense = chapterCompleted && !current.profile.campaignLicenses.includes(chapterKey);
  const chapter = campaignChapters[level.chapter - 1];
  const reward = {
    xp: (firstReward ? level.reward.xp : 0) + (firstLicense ? chapter.bonus.xp : 0),
    gold: (firstReward ? level.reward.gold : 0) + (firstLicense ? chapter.bonus.gold : 0),
  };
  const licenses = firstLicense ? [...current.profile.campaignLicenses, chapterKey] : current.profile.campaignLicenses;
  const next: StoredProfile = {
    ...current.profile,
    campaignProgress: nextProgress,
    campaignLicenses: licenses,
    campaignCompleted: campaignLevels.every((entry) => Number(nextProgress[entry.id]?.bestStars ?? 0) >= 1),
    xp: current.profile.xp + reward.xp,
    gold: current.profile.gold + reward.gold,
  };
  const now = new Date().toISOString();
  const d1 = await getDatabase();
  const result = await d1.prepare("UPDATE online_profiles SET profile = ?, revision = revision + 1, updated_at = ? WHERE player_id = ? AND revision = ?")
    .bind(JSON.stringify(next), now, user.id, current.revision).run();
  if (!(result as { meta?: { changes?: number } }).meta?.changes) return { error: "Profile changed; run the claim again.", status: 409 as const };
  await d1.prepare("UPDATE players SET total_xp = ?, gold_balance = ?, updated_at = ? WHERE id = ?").bind(next.xp, next.gold, now, user.id).run();
  return { profile: next, revision: current.revision + 1, reward, firstReward, license: firstLicense ? chapter : null };
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
