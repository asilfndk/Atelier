import { z } from "zod";
import type { Brand } from "@/db/schema";

/** Bir bedenin stok durumu */
export const sizeSchema = z.object({
  label: z.string(),
  inStock: z.boolean(),
  /** Varyant bazlı fiyat (ör. Sephora ml boyları) — çoğu markada yok */
  price: z.number().nullable().optional(),
});
export type SizeAvailability = z.infer<typeof sizeSchema>;

/** Tüm scraper'ların döndürdüğü normalize ürün durumu */
export const productStockSchema = z.object({
  name: z.string(),
  price: z.number().nullable(),
  currency: z.string().nullable(),
  imageUrl: z.string().nullable(),
  colors: z.array(z.string()),
  sizes: z.array(sizeSchema),
  /** En az bir beden/renk stokta mı */
  inStock: z.boolean(),
});
export type ProductStock = z.infer<typeof productStockSchema>;

/** URL'den çıkarılan ürün kimliği */
export interface ParsedProduct {
  brand: Brand;
  productId: string;
  /** Marka sitesindeki locale (ör. "tr/tr") — varsa */
  locale?: string;
  url: string;
}

/** Scrape sonucunun hangi katmandan geldiğini de taşır */
export interface ScrapeResult extends ProductStock {
  source: "api" | "browser";
}
