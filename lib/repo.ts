import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  checkHistory,
  settings,
  trackedProducts,
  type Brand,
  type NewTrackedProduct,
  type Settings,
  type TrackedProduct,
} from "@/db/schema";

/** Tüm takip edilen ürünler (en yeni önce) */
export function listProducts(): TrackedProduct[] {
  return db.select().from(trackedProducts).orderBy(desc(trackedProducts.createdAt)).all();
}

export function getProduct(id: number): TrackedProduct | undefined {
  return db.select().from(trackedProducts).where(eq(trackedProducts.id, id)).get();
}

export interface TrackInput {
  url: string;
  brand: Brand;
  productId: string;
  name?: string | null;
  imageUrl?: string | null;
  targetSize?: string | null;
  targetColor?: string | null;
  trackStock?: boolean;
  trackPrice?: boolean;
  lastPrice?: number | null;
  lastInStock?: boolean | null;
}

/**
 * Ürünü takibe ekler. Aynı url+beden+renk kombinasyonu zaten varsa onu döndürür
 * (çift kayıt engeli — edge case #1).
 */
export function trackProduct(input: TrackInput): TrackedProduct {
  const existing = db
    .select()
    .from(trackedProducts)
    .where(
      and(
        eq(trackedProducts.url, input.url),
        eq(trackedProducts.targetSize, input.targetSize ?? ""),
        eq(trackedProducts.targetColor, input.targetColor ?? ""),
      ),
    )
    .get();
  if (existing) return existing;

  const row: NewTrackedProduct = {
    url: input.url,
    brand: input.brand,
    productId: input.productId,
    name: input.name ?? null,
    imageUrl: input.imageUrl ?? null,
    targetSize: input.targetSize ?? null,
    targetColor: input.targetColor ?? null,
    trackStock: input.trackStock ?? true,
    trackPrice: input.trackPrice ?? false,
    lastPrice: input.lastPrice ?? null,
    lastInStock: input.lastInStock ?? null,
    lastCheckedAt: new Date(),
  };
  return db.insert(trackedProducts).values(row).returning().get();
}

export function untrackProduct(id: number): void {
  db.delete(trackedProducts).where(eq(trackedProducts.id, id)).run();
}

/** Bir kontrol sonucunu geçmişe yaz ve ürünün son durumunu güncelle */
export function recordCheck(
  id: number,
  inStock: boolean,
  price: number | null,
): void {
  db.insert(checkHistory).values({ productId: id, inStock, price }).run();
  db.update(trackedProducts)
    .set({ lastInStock: inStock, lastPrice: price, lastCheckedAt: new Date() })
    .where(eq(trackedProducts.id, id))
    .run();
}

export function priceHistory(id: number, limit = 50) {
  return db
    .select()
    .from(checkHistory)
    .where(eq(checkHistory.productId, id))
    .orderBy(desc(checkHistory.checkedAt))
    .limit(limit)
    .all();
}

const DEFAULT_SETTINGS: Omit<Settings, "id"> = {
  checkIntervalCron: "*/15 * * * *",
  autolaunch: false,
  notifyStock: true,
  notifyPrice: true,
};

/** Ayarları getir; yoksa varsayılanı oluştur */
export function getSettings(): Settings {
  const row = db.select().from(settings).where(eq(settings.id, 1)).get();
  if (row) return row;
  return db
    .insert(settings)
    .values({ id: 1, ...DEFAULT_SETTINGS })
    .returning()
    .get();
}

export function updateSettings(patch: Partial<Omit<Settings, "id">>): Settings {
  getSettings(); // satırın varlığını garanti et
  return db
    .update(settings)
    .set(patch)
    .where(eq(settings.id, 1))
    .returning()
    .get();
}
