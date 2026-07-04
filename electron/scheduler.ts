import cron, { type ScheduledTask } from "node-cron";
import { checkUrl } from "@/lib/scrapers";
import {
  getSettings,
  listProducts,
  recordCheck,
  updateProduct,
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
  // Genel bildirim anahtarları (ayarlardan); ürün bazlı track* ile birlikte değerlendirilir.
  const s = getSettings();

  // Stok geçişi: yok → var (yalnızca bir kez bildir — edge case #8)
  if (s.notifyStock && p.trackStock && !wasInStock && nowInStock) {
    notifyRestock(p.name ?? "Ürün", p.url, p.targetSize);
  }

  // Fiyat düşüşü: baseline = görülen en düşük fiyat (kademeli düşüşler kaçmaz).
  // Fiyat sonradan yükselir ve tekrar en düşüğün üstünde bir seviyeye inerse
  // bildirim gelmez — bilinçli tasarım.
  if (res.price != null) {
    const baseline = p.lowestPrice ?? p.lastPrice; // eski kayıtlar için ilk kontrolde backfill
    if (
      s.notifyPrice &&
      p.trackPrice &&
      baseline != null &&
      res.price < baseline
    ) {
      notifyPriceDrop(p.name ?? "Ürün", p.url, baseline, res.price);
    }
    // Baseline bakımı bildirim anahtarlarından bağımsız — hep doğru kalsın.
    if (baseline == null || res.price < baseline) {
      updateProduct(p.id, { lowestPrice: res.price });
    }
  }

  recordCheck(p.id, nowInStock, res.price, res.sizes, res.colors, res.imageUrl);
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
  // Açılışta sıradaki cron sınırını beklemeden bir kez kontrol et (kullanıcı geri bildirimi).
  void checkAll();
}

/** Ayar değişince yeniden zamanla. */
export function reschedule(): void {
  schedule(getSettings().checkIntervalCron);
  // Yeni ritmin çalıştığını anında göster: sıradaki sınırı beklemeden kontrol et.
  void checkAll();
}
