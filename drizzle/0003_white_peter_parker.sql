CREATE TABLE `online_profiles` (
	`player_id` text PRIMARY KEY NOT NULL,
	`profile` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`imported_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `online_reward_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`player_id` text NOT NULL,
	`result` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `online_rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_online_reward_room_player` ON `online_reward_claims` (`room_id`,`player_id`);--> statement-breakpoint
CREATE TABLE `online_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`is_private` integer DEFAULT false NOT NULL,
	`access_code_hash` text,
	`status` text DEFAULT 'waiting' NOT NULL,
	`control_mode` text NOT NULL,
	`round_seconds` integer NOT NULL,
	`action_interval_ms` integer NOT NULL,
	`host_player_id` text NOT NULL,
	`guest_player_id` text,
	`host_player` text NOT NULL,
	`guest_player` text,
	`host_ready` integer DEFAULT false NOT NULL,
	`guest_ready` integer DEFAULT false NOT NULL,
	`host_setup_deadline` integer,
	`guest_setup_deadline` integer,
	`countdown_started_at` integer,
	`match_state` text,
	`winner_player_id` text,
	`completion_reason` text,
	`last_host_seen_at` integer NOT NULL,
	`last_guest_seen_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`host_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`guest_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`winner_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_online_rooms_status_updated` ON `online_rooms` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_online_rooms_access_code` ON `online_rooms` (`access_code_hash`);