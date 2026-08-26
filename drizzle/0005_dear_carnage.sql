CREATE TABLE `admin_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_player_id` text NOT NULL,
	`action` text NOT NULL,
	`target_id` text NOT NULL,
	`details_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`admin_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `campaign_replays` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`level_id` text NOT NULL,
	`slot` text NOT NULL,
	`content_version` integer NOT NULL,
	`completed` integer NOT NULL,
	`stars` integer NOT NULL,
	`duration_seconds` real NOT NULL,
	`object_key` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_campaign_replays_player_level_slot` ON `campaign_replays` (`player_id`,`level_id`,`slot`);--> statement-breakpoint
CREATE TABLE `competition_enrollments` (
	`competition_id` text NOT NULL,
	`player_id` text NOT NULL,
	`enrolled_at` text NOT NULL,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_competition_enrollment` ON `competition_enrollments` (`competition_id`,`player_id`);--> statement-breakpoint
CREATE TABLE `competition_queue_entries` (
	`competition_id` text NOT NULL,
	`player_id` text NOT NULL,
	`bot_id` text NOT NULL,
	`control_mode` text NOT NULL,
	`status` text NOT NULL,
	`joined_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_competition_queue_player` ON `competition_queue_entries` (`competition_id`,`player_id`);--> statement-breakpoint
CREATE TABLE `competition_results` (
	`id` text PRIMARY KEY NOT NULL,
	`competition_id` text NOT NULL,
	`match_id` text NOT NULL,
	`player_id` text NOT NULL,
	`result` text NOT NULL,
	`points` real NOT NULL,
	`played_at` text NOT NULL,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_competition_result_match_player` ON `competition_results` (`competition_id`,`match_id`,`player_id`);--> statement-breakpoint
CREATE INDEX `idx_competition_results_standings` ON `competition_results` (`competition_id`,`player_id`);--> statement-breakpoint
CREATE TABLE `competitions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`status` text NOT NULL,
	`registration_opens_at` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`rules_version` integer NOT NULL,
	`rules_json` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_competitions_status_dates` ON `competitions` (`status`,`starts_at`,`ends_at`);