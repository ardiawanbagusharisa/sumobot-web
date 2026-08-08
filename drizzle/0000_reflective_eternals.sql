CREATE TABLE `analytics_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`summary` text NOT NULL,
	`action_buckets` text NOT NULL,
	`collision_buckets` text NOT NULL,
	`trajectory_grid` text NOT NULL,
	`processed_at` text NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`participant_id`) REFERENCES `match_participants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_analytics_match_participant` ON `analytics_summaries` (`match_id`,`participant_id`);--> statement-breakpoint
CREATE TABLE `bot_loadouts` (
	`bot_profile_id` text PRIMARY KEY NOT NULL,
	`wheel_item_id` text,
	`body_item_id` text,
	`face_item_id` text,
	`accessory_item_id` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`bot_profile_id`) REFERENCES `bot_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`wheel_item_id`) REFERENCES `market_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`body_item_id`) REFERENCES `market_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`face_item_id`) REFERENCES `market_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accessory_item_id`) REFERENCES `market_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bot_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`default_control_mode` text DEFAULT 'buttons' NOT NULL,
	`skill_type` text DEFAULT 'boost' NOT NULL,
	`active_version_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_bot_profiles_owner` ON `bot_profiles` (`owner_id`);--> statement-breakpoint
CREATE TABLE `bot_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_profile_id` text NOT NULL,
	`version` integer NOT NULL,
	`script_source` text,
	`script_hash` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`bot_profile_id`) REFERENCES `bot_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_bot_versions_profile_version` ON `bot_versions` (`bot_profile_id`,`version`);--> statement-breakpoint
CREATE TABLE `campaign_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`chapter` integer NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`control_mode` text NOT NULL,
	`prerequisite_node_id` text,
	`objectives` text NOT NULL,
	`reward_xp` integer DEFAULT 0 NOT NULL,
	`reward_gold` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_campaign_nodes_chapter_position` ON `campaign_nodes` (`chapter`,`position`);--> statement-breakpoint
CREATE TABLE `campaign_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`node_id` text NOT NULL,
	`status` text NOT NULL,
	`best_score` real,
	`attempts` integer DEFAULT 0 NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`node_id`) REFERENCES `campaign_nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_campaign_progress_player_node` ON `campaign_progress` (`player_id`,`node_id`);--> statement-breakpoint
CREATE TABLE `currency_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`reference_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_currency_ledger_player_created` ON `currency_ledger` (`player_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `leaderboard_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`season_id` text NOT NULL,
	`control_mode` text NOT NULL,
	`bot_profile_id` text NOT NULL,
	`points` real DEFAULT 0 NOT NULL,
	`wins` integer DEFAULT 0 NOT NULL,
	`draws` integer DEFAULT 0 NOT NULL,
	`losses` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`bot_profile_id`) REFERENCES `bot_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_leaderboard_season_mode_bot` ON `leaderboard_entries` (`season_id`,`control_mode`,`bot_profile_id`);--> statement-breakpoint
CREATE TABLE `market_items` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slot` text NOT NULL,
	`rarity` text NOT NULL,
	`gold_price` integer NOT NULL,
	`asset_key` text NOT NULL,
	`is_available` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `match_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`player_id` text NOT NULL,
	`bot_profile_id` text NOT NULL,
	`bot_version_id` text,
	`side` text NOT NULL,
	`skill_type` text NOT NULL,
	`result` text,
	`rank_points_awarded` real DEFAULT 0 NOT NULL,
	`xp_awarded` integer DEFAULT 0 NOT NULL,
	`gold_awarded` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bot_profile_id`) REFERENCES `bot_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bot_version_id`) REFERENCES `bot_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_match_participants_match_side` ON `match_participants` (`match_id`,`side`);--> statement-breakpoint
CREATE TABLE `match_rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`round_number` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`winner_participant_id` text,
	`result_reason` text NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_match_rounds_match_round` ON `match_rounds` (`match_id`,`round_number`);--> statement-breakpoint
CREATE TABLE `matches` (
	`id` text PRIMARY KEY NOT NULL,
	`lobby_code` text,
	`control_mode` text NOT NULL,
	`ranked` integer DEFAULT false NOT NULL,
	`ruleset_version` text NOT NULL,
	`status` text NOT NULL,
	`winner_participant_id` text,
	`started_at` text,
	`ended_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_matches_mode_status` ON `matches` (`control_mode`,`status`);--> statement-breakpoint
CREATE TABLE `player_inventory` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`market_item_id` text NOT NULL,
	`acquisition_source` text NOT NULL,
	`acquired_at` text NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`market_item_id`) REFERENCES `market_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_player_item` ON `player_inventory` (`player_id`,`market_item_id`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`display_name` text NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`total_xp` integer DEFAULT 0 NOT NULL,
	`gold_balance` integer DEFAULT 0 NOT NULL,
	`unlocked_modes` text DEFAULT '["buttons"]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_players_handle` ON `players` (`handle`);--> statement-breakpoint
CREATE TABLE `replay_artifacts` (
	`match_id` text PRIMARY KEY NOT NULL,
	`schema_version` integer NOT NULL,
	`manifest_key` text NOT NULL,
	`checksum` text NOT NULL,
	`frame_count` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
PRAGMA optimize;
