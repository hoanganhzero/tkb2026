ALTER TABLE `school_profiles` ADD `grades_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `school_profiles` ADD `periods_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `school_profiles` ADD `assignments_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `school_profiles` ADD `homerooms_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `school_profiles` ADD `config_json` text DEFAULT '{}' NOT NULL;