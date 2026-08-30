CREATE TABLE `competition_pairings` (
	`id` text PRIMARY KEY NOT NULL,
	`competition_id` text NOT NULL,
	`player_a_id` text NOT NULL,
	`player_b_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`acceptance_expires_at` integer,
	`player_a_accepted_at` integer,
	`player_b_accepted_at` integer,
	`room_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_a_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_b_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`room_id`) REFERENCES `online_rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_competition_pair_unique` ON `competition_pairings` (`competition_id`,`player_a_id`,`player_b_id`);--> statement-breakpoint
CREATE INDEX `idx_competition_pairings_player_a` ON `competition_pairings` (`competition_id`,`player_a_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_competition_pairings_player_b` ON `competition_pairings` (`competition_id`,`player_b_id`,`status`);--> statement-breakpoint
CREATE TABLE `competition_reward_claims` (
	`competition_id` text NOT NULL,
	`player_id` text NOT NULL,
	`placement` integer,
	`gold` integer NOT NULL,
	`xp` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_competition_reward_claim` ON `competition_reward_claims` (`competition_id`,`player_id`);--> statement-breakpoint
ALTER TABLE `competition_queue_entries` ADD `bot_json` text;--> statement-breakpoint
ALTER TABLE `competition_queue_entries` ADD `pairing_id` text;--> statement-breakpoint
ALTER TABLE `competitions` ADD `is_private` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `competitions` ADD `access_code_hash` text;--> statement-breakpoint
ALTER TABLE `competitions` ADD `max_players` integer DEFAULT 8 NOT NULL;