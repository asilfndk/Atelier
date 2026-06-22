CREATE TABLE `check_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`in_stock` integer,
	`price` real,
	`checked_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `tracked_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`check_interval_cron` text DEFAULT '*/15 * * * *' NOT NULL,
	`autolaunch` integer DEFAULT false NOT NULL,
	`notify_stock` integer DEFAULT true NOT NULL,
	`notify_price` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tracked_products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`url` text NOT NULL,
	`brand` text NOT NULL,
	`product_id` text NOT NULL,
	`name` text,
	`image_url` text,
	`target_size` text,
	`target_color` text,
	`track_stock` integer DEFAULT true NOT NULL,
	`track_price` integer DEFAULT false NOT NULL,
	`last_price` real,
	`last_in_stock` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_checked_at` integer
);
