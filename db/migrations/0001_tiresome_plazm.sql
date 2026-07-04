PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tracked_products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`url` text NOT NULL,
	`brand` text NOT NULL,
	`product_id` text NOT NULL,
	`name` text,
	`image_url` text,
	`target_size` text,
	`target_color` text,
	`track_stock` integer DEFAULT true NOT NULL,
	`track_price` integer DEFAULT true NOT NULL,
	`last_price` real,
	`last_in_stock` integer,
	`lowest_price` real,
	`last_sizes` text,
	`last_colors` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_checked_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_tracked_products`("id", "url", "brand", "product_id", "name", "image_url", "target_size", "target_color", "track_stock", "track_price", "last_price", "last_in_stock", "lowest_price", "last_sizes", "last_colors", "created_at", "last_checked_at") SELECT "id", "url", "brand", "product_id", "name", "image_url", "target_size", "target_color", "track_stock", "track_price", "last_price", "last_in_stock", NULL, NULL, NULL, "created_at", "last_checked_at" FROM `tracked_products`;--> statement-breakpoint
DROP TABLE `tracked_products`;--> statement-breakpoint
ALTER TABLE `__new_tracked_products` RENAME TO `tracked_products`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
UPDATE `tracked_products` SET `lowest_price` = `last_price` WHERE `lowest_price` IS NULL AND `last_price` IS NOT NULL;