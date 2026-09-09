CREATE TABLE `timetables` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`name` text NOT NULL,
	`assignments_json` text NOT NULL,
	`schedule_json` text NOT NULL,
	`unresolved_json` text DEFAULT '[]' NOT NULL,
	`lesson_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `timetables_owner_updated_idx` ON `timetables` (`owner_email`,`updated_at`);