CREATE TABLE `featured_replays` (
	`slot` text PRIMARY KEY NOT NULL,
	`match_record_id` text NOT NULL,
	`replay` text NOT NULL,
	`result` text NOT NULL,
	`played_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`match_record_id`) REFERENCES `prototype_match_records`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `prototype_match_records` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`player_handle` text NOT NULL,
	`bot_id` text NOT NULL,
	`bot_name` text NOT NULL,
	`control_mode` text NOT NULL,
	`battle_mode` text NOT NULL,
	`result` text NOT NULL,
	`rank_points` real NOT NULL,
	`telemetry` text NOT NULL,
	`replay` text NOT NULL,
	`played_at` text NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_prototype_matches_rank` ON `prototype_match_records` (`battle_mode`,`control_mode`,`player_id`,`bot_id`);--> statement-breakpoint
CREATE INDEX `idx_prototype_matches_played` ON `prototype_match_records` (`played_at`);