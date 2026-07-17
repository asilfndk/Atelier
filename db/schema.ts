import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/** Supported brands (Inditex + other stores) */
export const BRANDS = [
  "zara",
  "bershka",
  "stradivarius",
  "pullandbear",
  "lefties",
  "oysho",
  "massimodutti",
  "sneaksup",
  "tommy",
  "victoriassecret",
  "boyner",
  "wunder",
  "superstep",
  "mango",
  "sephora",
  "gratis",
  "watsons",
  "lesbenjamins",
] as const;
export type Brand = (typeof BRANDS)[number];

/** Tracked products */
export const trackedProducts = sqliteTable("tracked_products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  url: text("url").notNull(),
  brand: text("brand", { enum: BRANDS }).notNull(),
  productId: text("product_id").notNull(),
  name: text("name"),
  imageUrl: text("image_url"),

  // Target filters (null = any)
  targetSize: text("target_size"),
  targetColor: text("target_color"),

  // What are we tracking?
  trackStock: integer("track_stock", { mode: "boolean" })
    .notNull()
    .default(true),
  trackPrice: integer("track_price", { mode: "boolean" })
    .notNull()
    .default(true),

  // Last known state
  lastPrice: real("last_price"),
  lastInStock: integer("last_in_stock", { mode: "boolean" }),
  /** Lowest price ever seen — the baseline for price-drop notifications */
  lowestPrice: real("lowest_price"),
  /** Size matrix of the last check (JSON SizeAvailability[]) — for instant display */
  lastSizes: text("last_sizes"),
  /** Color list of the last check (JSON string[]) */
  lastColors: text("last_colors"),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  lastCheckedAt: integer("last_checked_at", { mode: "timestamp" }),
});

/** App settings — single row (id=1) */
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  /** node-cron expression (default 15 min) */
  checkIntervalCron: text("check_interval_cron")
    .notNull()
    .default("*/15 * * * *"),
  /** Launch at login */
  autolaunch: integer("autolaunch", { mode: "boolean" })
    .notNull()
    .default(false),
  /** Whether stock notifications are on */
  notifyStock: integer("notify_stock", { mode: "boolean" })
    .notNull()
    .default(true),
  /** Whether price-drop notifications are on */
  notifyPrice: integer("notify_price", { mode: "boolean" })
    .notNull()
    .default(true),
  /** Automatically check for app updates (on startup + every 24h) */
  autoUpdateCheck: integer("auto_update_check", { mode: "boolean" })
    .notNull()
    .default(true),
});

/** History record of every check (price chart + change detection) */
export const checkHistory = sqliteTable(
  "check_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    productId: integer("product_id")
      .notNull()
      .references(() => trackedProducts.id, { onDelete: "cascade" }),
    inStock: integer("in_stock", { mode: "boolean" }),
    price: real("price"),
    checkedAt: integer("checked_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("check_history_product_id_idx").on(t.productId)],
);

export type TrackedProduct = typeof trackedProducts.$inferSelect;
export type NewTrackedProduct = typeof trackedProducts.$inferInsert;
export type Settings = typeof settings.$inferSelect;
export type CheckHistory = typeof checkHistory.$inferSelect;
