CREATE TABLE `catalog_items` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`published` integer DEFAULT 1 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `catalog_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
