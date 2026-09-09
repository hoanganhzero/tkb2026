CREATE TABLE `license_keys` (
	`key` text PRIMARY KEY NOT NULL,
	`duration_days` integer DEFAULT 365 NOT NULL,
	`max_activations` integer DEFAULT 1 NOT NULL,
	`used_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `license_keys_creator_idx` ON `license_keys` (`created_by`);--> statement-breakpoint
CREATE TABLE `user_accounts` (
	`email` text PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`school` text NOT NULL,
	`province` text DEFAULT '' NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`license_status` text DEFAULT 'trial' NOT NULL,
	`license_key` text,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
