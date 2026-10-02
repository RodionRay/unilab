CREATE TABLE IF NOT EXISTS `account_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`account_id` text NOT NULL,
	`type` text NOT NULL,
	`context` text NOT NULL,
	`wait_sec` integer,
	`reason` text DEFAULT '' NOT NULL,
	`at` text NOT NULL,
	`dedupe_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_account_events_dedupe` ON `account_events` (`owner`,`dedupe_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_account_events_owner_account_at` ON `account_events` (`owner`,`account_id`,`at`);
