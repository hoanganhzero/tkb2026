CREATE TABLE `school_profiles` (
	`owner_email` text PRIMARY KEY NOT NULL,
	`school_name` text DEFAULT 'Trường của tôi' NOT NULL,
	`school_year` text DEFAULT '2026-2027' NOT NULL,
	`campuses_json` text DEFAULT '[]' NOT NULL,
	`teachers_json` text DEFAULT '[]' NOT NULL,
	`classes_json` text DEFAULT '[]' NOT NULL,
	`subjects_json` text DEFAULT '[]' NOT NULL,
	`rooms_json` text DEFAULT '[]' NOT NULL,
	`updated_at` text NOT NULL
);
