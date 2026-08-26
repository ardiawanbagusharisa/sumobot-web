import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const players = sqliteTable("players", {
  id: text("id").primaryKey(),
  handle: text("handle").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["player", "admin"] }).notNull().default("player"),
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

export const onlineProfiles = sqliteTable("online_profiles", {
  playerId: text("player_id").primaryKey().references(() => players.id),
  profile: text("profile", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  revision: integer("revision").notNull().default(1),
  importedAt: text("imported_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const onlineRooms = sqliteTable("online_rooms", {
  id: text("id").primaryKey(),
  isPrivate: integer("is_private", { mode: "boolean" }).notNull().default(false),
  accessCodeHash: text("access_code_hash"),
  status: text("status", { enum: ["waiting", "countdown", "live", "completed"] }).notNull().default("waiting"),
  controlMode: text("control_mode", { enum: ["buttons", "live", "script"] }).notNull(),
  roundSeconds: integer("round_seconds").notNull(),
  actionIntervalMs: integer("action_interval_ms").notNull(),
  hostPlayerId: text("host_player_id").notNull().references(() => players.id),
  guestPlayerId: text("guest_player_id").references(() => players.id),
  hostPlayer: text("host_player", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  guestPlayer: text("guest_player", { mode: "json" }).$type<Record<string, unknown>>(),
  hostReady: integer("host_ready", { mode: "boolean" }).notNull().default(false),
  guestReady: integer("guest_ready", { mode: "boolean" }).notNull().default(false),
  hostSetupDeadline: integer("host_setup_deadline"),
  guestSetupDeadline: integer("guest_setup_deadline"),
  countdownStartedAt: integer("countdown_started_at"),
  realtimeStartedAt: integer("realtime_started_at"),
  matchState: text("match_state", { mode: "json" }).$type<Record<string, unknown>>(),
  winnerPlayerId: text("winner_player_id").references(() => players.id),
  completionReason: text("completion_reason", { enum: ["arena_exit", "draw_timeout", "disconnect"] }),
  lastHostSeenAt: integer("last_host_seen_at").notNull(),
  lastGuestSeenAt: integer("last_guest_seen_at"),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  completedAt: text("completed_at"),
}, (table) => [
  index("idx_online_rooms_status_updated").on(table.status, table.updatedAt),
  index("idx_online_rooms_access_code").on(table.accessCodeHash),
]);

export const onlineRewardClaims = sqliteTable("online_reward_claims", {
  id: text("id").primaryKey(),
  roomId: text("room_id").notNull().references(() => onlineRooms.id),
  playerId: text("player_id").notNull().references(() => players.id),
  result: text("result", { enum: ["win", "draw", "loss"] }).notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("idx_online_reward_room_player").on(table.roomId, table.playerId)]);


export const campaignReplays = sqliteTable("campaign_replays", {
  id: text("id").primaryKey(), playerId: text("player_id").notNull().references(() => players.id),
  levelId: text("level_id").notNull(), slot: text("slot", { enum: ["best", "latest"] }).notNull(),
  contentVersion: integer("content_version").notNull(), completed: integer("completed", { mode: "boolean" }).notNull(),
  stars: integer("stars").notNull(), durationSeconds: real("duration_seconds").notNull(), objectKey: text("object_key").notNull(),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("idx_campaign_replays_player_level_slot").on(table.playerId, table.levelId, table.slot)]);

export const competitions = sqliteTable("competitions", {
  id: text("id").primaryKey(), title: text("title").notNull(), description: text("description").notNull(),
  status: text("status", { enum: ["draft","registration","active","closed","cancelled","archived"] }).notNull(),
  registrationOpensAt: text("registration_opens_at").notNull(), startsAt: text("starts_at").notNull(), endsAt: text("ends_at").notNull(),
  rulesVersion: integer("rules_version").notNull(), rules: text("rules_json", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  createdBy: text("created_by").notNull().references(() => players.id), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (table) => [index("idx_competitions_status_dates").on(table.status, table.startsAt, table.endsAt)]);

export const competitionEnrollments = sqliteTable("competition_enrollments", {
  competitionId: text("competition_id").notNull().references(() => competitions.id), playerId: text("player_id").notNull().references(() => players.id), enrolledAt: text("enrolled_at").notNull(),
}, (table) => [uniqueIndex("idx_competition_enrollment").on(table.competitionId, table.playerId)]);

export const competitionQueueEntries = sqliteTable("competition_queue_entries", {
  competitionId: text("competition_id").notNull().references(() => competitions.id), playerId: text("player_id").notNull().references(() => players.id),
  botId: text("bot_id").notNull(), controlMode: text("control_mode", { enum: ["buttons","live","script"] }).notNull(),
  status: text("status", { enum: ["waiting","matched","cancelled"] }).notNull(), joinedAt: text("joined_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("idx_competition_queue_player").on(table.competitionId, table.playerId)]);

export const competitionResults = sqliteTable("competition_results", {
  id: text("id").primaryKey(), competitionId: text("competition_id").notNull().references(() => competitions.id),
  matchId: text("match_id").notNull(), playerId: text("player_id").notNull().references(() => players.id),
  result: text("result", { enum: ["win","draw","loss"] }).notNull(), points: real("points").notNull(), playedAt: text("played_at").notNull(),
}, (table) => [uniqueIndex("idx_competition_result_match_player").on(table.competitionId, table.matchId, table.playerId), index("idx_competition_results_standings").on(table.competitionId, table.playerId)]);

export const adminAuditEvents = sqliteTable("admin_audit_events", {
  id: text("id").primaryKey(), adminPlayerId: text("admin_player_id").notNull().references(() => players.id),
  action: text("action").notNull(), targetId: text("target_id").notNull(), details: text("details_json", { mode: "json" }).$type<Record<string, unknown>>().notNull(), createdAt: text("created_at").notNull(),
});
