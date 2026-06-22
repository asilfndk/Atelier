import cron, { type ScheduledTask } from "node-cron";
import { checkUrl } from "@/lib/scrapers";
import {
  getSettings,
  listProducts,
  recordCheck,
} from "@/lib/repo";
import type { ScrapeResult } from "@/lib/scrapers";
import type { TrackedProduct } from "@/db/schema";
import { emitProductsChanged } from "./app-state";
import { notifyPriceDrop, notifyRestock, setDockBadge } from "./notifications";

const DEFAULT_CRON = "*/15 * * * *";
let task: ScheduledTask | null = null;
let running = false;

/** Hedef beden varsa o bedenin stoğu, yoksa genel stok durumu. */
function effectiveInStock(p: TrackedProduct, res: ScrapeResult): boolean {
  if (p.targetSize) {
    const match = res.sizes.find(
      (s) => s.label.toLowerCase() === p.targetSize!.toLowerCase(),
    );
    return match ? match.inStock : false;
  }
  return res.inStock;
}

async function checkOne(p: TrackedProduct): Promise<void> {
  let res: ScrapeResult;
  try {
    res = await checkUrl(p.url);
  } catch (err) {
    // Ağ/bot hatası: durumu koru, sessizce geç (edge case #4, #6).
    console.warn(`[scheduler] ${p.brand} kontrol atlandı:`, err);
    return;
  }

  const nowInStock = effectiveInStock(p, res);
  const wasInStock = p.lastInStock ?? false;

  // Stok geçişi: yok → var (yalnızca bir kez bildir — edge case #8)
  if (p.trackStock && !wasInStock && nowInStock) {
    notifyRestock(p.name ?? "Ürün", p.url, p.targetSize);
  }

  // Fiyat düşüşü
  if (
    p.trackPrice &&
    p.lastPrice != null &&
    res.price != null &&
    res.price < p.lastPrice
  ) {
    notifyPriceDrop(p.name ?? "Ürün", p.url, p.lastPrice, res.price);
  }

  recordCheck(p.id, nowInStock, res.price);
}

/** Tüm takip listesini sırayla kontrol et (browser eşzamanlılığı zaten sınırlı). */
export async function checkAll(): Promise<void> {
  if (running) return; // çakışan turları engelle
  running = true;
  try {
    const products = listProducts();
    for (const p of products) {
      await checkOne(p);
    }
    refreshBadge();
    emitProductsChanged();
  } finally {
    running = false;
  }
}

export function refreshBadge(): void {
  const inStock = listProducts().filter((p) => p.lastInStock).length;
  setDockBadge(inStock);
}

function schedule(expr: string): void {
  if (task) {
    task.stop();
    task = null;
  }
  const valid = cron.validate(expr) ? expr : DEFAULT_CRON;
  task = cron.schedule(valid, () => {
    void checkAll();
  });
  console.log(`[scheduler] zamanlandı: ${valid}`);
}

export function startScheduler(): void {
  schedule(getSettings().checkIntervalCron);
  refreshBadge();
}

/** Ayar değişince yeniden zamanla. */
export function reschedule(): void {
  schedule(getSettings().checkIntervalCron);
}
