import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const players = sqliteTable("players", {
  id: text("id").primaryKey(),
  handle: text("handle").notNull(),
  displayName: text("display_name").notNull(),
  level: integer("level").notNull().default(1),
  totalXp: integer("total_xp").notNull().default(0),
  goldBalance: integer("gold_balance").notNull().default(0),
  unlockedModes: text("unlocked_modes", { mode: "json" }).$type<string[]>().notNull().default(["buttons"]),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("idx_players_handle").on(table.handle)]);

export const authCredentials = sqliteTable("auth_credentials", {
  playerId: text("player_id").primaryKey().references(() => players.id),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  passwordIterations: integer("password_iterations").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const authSessions = sqliteTable("auth_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  playerId: text("player_id").notNull().references(() => players.id),
  expiresAt: integer("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_auth_sessions_player").on(table.playerId)]);

export const prototypeMatchRecords = sqliteTable("prototype_match_records", {
  id: text("id").primaryKey(),
  playerId: text("player_id").notNull().references(() => players.id),
  playerHandle: text("player_handle").notNull(),
  botId: text("bot_id").notNull(),
  botName: text("bot_name").notNull(),
  controlMode: text("control_mode", { enum: ["buttons", "live", "script"] }).notNull(),
  battleMode: text("battle_mode", { enum: ["pvai", "pvp"] }).notNull(),
  result: text("result", { enum: ["win", "draw", "loss"] }).notNull(),
  rankPoints: real("rank_points").notNull(),
  telemetry: text("telemetry", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  replay: text("replay", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  playedAt: text("played_at").notNull(),
}, (table) => [
  index("idx_prototype_matches_rank").on(table.battleMode, table.controlMode, table.playerId, table.botId),
  index("idx_prototype_matches_played").on(table.playedAt),
]);

export const featuredReplays = sqliteTable("featured_replays", {
  slot: text("slot").primaryKey(),
  matchRecordId: text("match_record_id").notNull().references(() => prototypeMatchRecords.id),
  replay: text("replay", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  result: text("result", { enum: ["win", "draw", "loss"] }).notNull(),
  playedAt: text("played_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const botProfiles = sqliteTable("bot_profiles", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => players.id),
  name: text("name").notNull(),
  defaultControlMode: text("default_control_mode", { enum: ["buttons", "live", "script"] }).notNull().default("buttons"),
  skillType: text("skill_type", { enum: ["boost", "stone"] }).notNull().default("boost"),
  activeVersionId: text("active_version_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("idx_bot_profiles_owner").on(table.ownerId)]);

export const botVersions = sqliteTable("bot_versions", {
  id: text("id").primaryKey(),
  botProfileId: text("bot_profile_id").notNull().references(() => botProfiles.id),
  version: integer("version").notNull(),
  scriptSource: text("script_source"),
  scriptHash: text("script_hash"),
  status: text("status", { enum: ["draft", "validated", "active", "retired"] }).notNull().default("draft"),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("idx_bot_versions_profile_version").on(table.botProfileId, table.version)]);

export const marketItems = sqliteTable("market_items", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slot: text("slot", { enum: ["wheel", "body", "face", "accessory"] }).notNull(),
  rarity: text("rarity").notNull(),
  goldPrice: integer("gold_price").notNull(),
  assetKey: text("asset_key").notNull(),
  isAvailable: integer("is_available", { mode: "boolean" }).notNull().default(true),
});

export const playerInventory = sqliteTable("player_inventory", {
  id: text("id").primaryKey(),
  playerId: text("player_id").notNull().references(() => players.id),
  marketItemId: text("market_item_id").notNull().references(() => marketItems.id),
  acquisitionSource: text("acquisition_source").notNull(),
  acquiredAt: text("acquired_at").notNull(),
}, (table) => [uniqueIndex("idx_inventory_player_item").on(table.playerId, table.marketItemId)]);

export const botLoadouts = sqliteTable("bot_loadouts", {
  botProfileId: text("bot_profile_id").primaryKey().references(() => botProfiles.id),
  wheelItemId: text("wheel_item_id").references(() => marketItems.id),
  bodyItemId: text("body_item_id").references(() => marketItems.id),
  faceItemId: text("face_item_id").references(() => marketItems.id),
  accessoryItemId: text("accessory_item_id").references(() => marketItems.id),
  updatedAt: text("updated_at").notNull(),
});

export const currencyLedger = sqliteTable("currency_ledger", {
  id: text("id").primaryKey(),
  playerId: text("player_id").notNull().references(() => players.id),
  amount: integer("amount").notNull(),
  reason: text("reason", { enum: ["match_reward", "campaign_reward", "market_purchase", "admin"] }).notNull(),
  referenceId: text("reference_id"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_currency_ledger_player_created").on(table.playerId, table.createdAt)]);

export const campaignNodes = sqliteTable("campaign_nodes", {
  id: text("id").primaryKey(),
  chapter: integer("chapter").notNull(),
  position: integer("position").notNull(),
  title: text("title").notNull(),
  controlMode: text("control_mode", { enum: ["buttons", "live", "script"] }).notNull(),
  prerequisiteNodeId: text("prerequisite_node_id"),
  objectives: text("objectives", { mode: "json" }).$type<Array<Record<string, unknown>>>().notNull(),
  rewardXp: integer("reward_xp").notNull().default(0),
  rewardGold: integer("reward_gold").notNull().default(0),
}, (table) => [uniqueIndex("idx_campaign_nodes_chapter_position").on(table.chapter, table.position)]);

export const campaignProgress = sqliteTable("campaign_progress", {
  id: text("id").primaryKey(),
  playerId: text("player_id").notNull().references(() => players.id),
  nodeId: text("node_id").notNull().references(() => campaignNodes.id),
  status: text("status", { enum: ["available", "active", "completed"] }).notNull(),
  bestScore: real("best_score"),
  attempts: integer("attempts").notNull().default(0),
  completedAt: text("completed_at"),
}, (table) => [uniqueIndex("idx_campaign_progress_player_node").on(table.playerId, table.nodeId)]);

export const matches = sqliteTable("matches", {
  id: text("id").primaryKey(),
  lobbyCode: text("lobby_code"),
  controlMode: text("control_mode", { enum: ["buttons", "live", "script"] }).notNull(),
  ranked: integer("ranked", { mode: "boolean" }).notNull().default(false),
  rulesetVersion: text("ruleset_version").notNull(),
  status: text("status", { enum: ["awaiting", "countdown", "live", "completed", "cancelled"] }).notNull(),
  winnerParticipantId: text("winner_participant_id"),
  startedAt: text("started_at"),
  endedAt: text("ended_at"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_matches_mode_status").on(table.controlMode, table.status)]);

export const matchParticipants = sqliteTable("match_participants", {
  id: text("id").primaryKey(),
  matchId: text("match_id").notNull().references(() => matches.id),
  playerId: text("player_id").notNull().references(() => players.id),
  botProfileId: text("bot_profile_id").notNull().references(() => botProfiles.id),
  botVersionId: text("bot_version_id").references(() => botVersions.id),
  side: text("side", { enum: ["left", "right"] }).notNull(),
  skillType: text("skill_type", { enum: ["boost", "stone"] }).notNull(),
  result: text("result", { enum: ["win", "draw", "loss"] }),
  rankPointsAwarded: real("rank_points_awarded").notNull().default(0),
  xpAwarded: integer("xp_awarded").notNull().default(0),
  goldAwarded: integer("gold_awarded").notNull().default(0),
}, (table) => [uniqueIndex("idx_match_participants_match_side").on(table.matchId, table.side)]);

export const matchRounds = sqliteTable("match_rounds", {
  id: text("id").primaryKey(),
  matchId: text("match_id").notNull().references(() => matches.id),
  roundNumber: integer("round_number").notNull(),
  durationMs: integer("duration_ms").notNull(),
  winnerParticipantId: text("winner_participant_id"),
  resultReason: text("result_reason", { enum: ["arena_exit", "draw_timeout", "double_exit"] }).notNull(),
}, (table) => [uniqueIndex("idx_match_rounds_match_round").on(table.matchId, table.roundNumber)]);

export const leaderboardEntries = sqliteTable("leaderboard_entries", {
  id: text("id").primaryKey(),
  seasonId: text("season_id").notNull(),
  controlMode: text("control_mode", { enum: ["buttons", "live", "script"] }).notNull(),
  botProfileId: text("bot_profile_id").notNull().references(() => botProfiles.id),
  points: real("points").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  draws: integer("draws").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("idx_leaderboard_season_mode_bot").on(table.seasonId, table.controlMode, table.botProfileId)]);

export const replayArtifacts = sqliteTable("replay_artifacts", {
  matchId: text("match_id").primaryKey().references(() => matches.id),
  schemaVersion: integer("schema_version").notNull(),
  manifestKey: text("manifest_key").notNull(),
  checksum: text("checksum").notNull(),
  frameCount: integer("frame_count").notNull(),
  createdAt: text("created_at").notNull(),
});

export const analyticsSummaries = sqliteTable("analytics_summaries", {
  id: text("id").primaryKey(),
  matchId: text("match_id").notNull().references(() => matches.id),
  participantId: text("participant_id").notNull().references(() => matchParticipants.id),
  summary: text("summary", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  actionBuckets: text("action_buckets", { mode: "json" }).$type<Array<Record<string, number>>>().notNull(),
  collisionBuckets: text("collision_buckets", { mode: "json" }).$type<Array<Record<string, number>>>().notNull(),
  trajectoryGrid: text("trajectory_grid", { mode: "json" }).$type<number[]>().notNull(),
  processedAt: text("processed_at").notNull(),
}, (table) => [uniqueIndex("idx_analytics_match_participant").on(table.matchId, table.participantId)]);
