CREATE TABLE IF NOT EXISTS `tma_workspaces` (
	`ws_key` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`bot_id` text DEFAULT '' NOT NULL,
	`bot_username` text DEFAULT '' NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_tma_workspaces_owner` ON `tma_workspaces` (`owner`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tma_links` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`user_id` text NOT NULL,
	`tg_user_id` text NOT NULL,
	`tg_username` text DEFAULT '' NOT NULL,
	`bot_id` text DEFAULT '' NOT NULL,
	`dm_notices` integer DEFAULT 0 NOT NULL,
	`dm_error` text DEFAULT '' NOT NULL,
	`created` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_tma_links_active_tg` ON `tma_links` (`owner`,`tg_user_id`) WHERE `revoked_at` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_tma_links_active_user` ON `tma_links` (`owner`,`user_id`) WHERE `revoked_at` IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tma_link_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tma_link_codes_expires` ON `tma_link_codes` (`expires_at`);
