import { sql } from "drizzle-orm";
import {
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/** Desteklenen markalar (Inditex + diğer mağazalar) */
export const BRANDS = [
  "zara",
  "bershka",
  "stradivarius",
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
] as const;
export type Brand = (typeof BRANDS)[number];

/** Takip edilen ürünler */
export const trackedProducts = sqliteTable("tracked_products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  url: text("url").notNull(),
  brand: text("brand", { enum: BRANDS }).notNull(),
  productId: text("product_id").notNull(),
  name: text("name"),
  imageUrl: text("image_url"),

  // Hedef filtreler (null = herhangi)
  targetSize: text("target_size"),
  targetColor: text("target_color"),

  // Neyi takip ediyoruz?
  trackStock: integer("track_stock", { mode: "boolean" })
    .notNull()
    .default(true),
  trackPrice: integer("track_price", { mode: "boolean" })
    .notNull()
    .default(true),

  // Son bilinen durum
  lastPrice: real("last_price"),
  lastInStock: integer("last_in_stock", { mode: "boolean" }),
  /** Görülen en düşük fiyat — fiyat düşüş bildirimlerinin baseline'ı */
  lowestPrice: real("lowest_price"),
  /** Son kontrolün beden matrisi (JSON SizeAvailability[]) — anında görünüm için */
  lastSizes: text("last_sizes"),
  /** Son kontrolün renk listesi (JSON string[]) */
  lastColors: text("last_colors"),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  lastCheckedAt: integer("last_checked_at", { mode: "timestamp" }),
});

/** Uygulama ayarları — tek satır (id=1) */
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  /** node-cron ifadesi (varsayılan 15 dk) */
  checkIntervalCron: text("check_interval_cron")
    .notNull()
    .default("*/15 * * * *"),
  /** Girişte otomatik başlat */
  autolaunch: integer("autolaunch", { mode: "boolean" })
    .notNull()
    .default(false),
  /** Stok bildirimleri açık mı */
  notifyStock: integer("notify_stock", { mode: "boolean" })
    .notNull()
    .default(true),
  /** Fiyat düşüşü bildirimleri açık mı */
  notifyPrice: integer("notify_price", { mode: "boolean" })
    .notNull()
    .default(true),
  /** Uygulama güncellemelerini otomatik denetle (açılışta + 24 saatte bir) */
  autoUpdateCheck: integer("auto_update_check", { mode: "boolean" })
    .notNull()
    .default(true),
});

/** Her kontrolün geçmiş kaydı (fiyat grafiği + değişim tespiti) */
export const checkHistory = sqliteTable("check_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  productId: integer("product_id")
    .notNull()
    .references(() => trackedProducts.id, { onDelete: "cascade" }),
  inStock: integer("in_stock", { mode: "boolean" }),
  price: real("price"),
  checkedAt: integer("checked_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type TrackedProduct = typeof trackedProducts.$inferSelect;
export type NewTrackedProduct = typeof trackedProducts.$inferInsert;
export type Settings = typeof settings.$inferSelect;
export type CheckHistory = typeof checkHistory.$inferSelect;
