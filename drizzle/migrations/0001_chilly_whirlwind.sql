ALTER TABLE `schedules` ADD `type` text DEFAULT 'weekly' NOT NULL;--> statement-breakpoint
ALTER TABLE `schedules` ADD `days_of_week` text;--> statement-breakpoint
ALTER TABLE `schedules` ADD `interval_days` integer;--> statement-breakpoint
ALTER TABLE `schedules` ADD `next_fire_at` integer;--> statement-breakpoint
ALTER TABLE `schedules` DROP COLUMN `day_of_week`;