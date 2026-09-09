CREATE TABLE `public_shares` (
	`token` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`scope` text NOT NULL,
	`label` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `public_shares_owner_idx` ON `public_shares` (`owner_email`);