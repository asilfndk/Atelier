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

/**
 * Stock of the target size if one is set, otherwise the overall stock status.
 * Returns null (= unknown, keep previous state) when a target size is set but
 * the scrape produced no size list at all — a transient parse miss would
 * otherwise record out-of-stock and fire a false restock on the next round.
 * A non-empty list that lacks the target size still counts as out-of-stock
 * (some stores drop sold-out sizes from the list).
 */
function effectiveInStock(p: TrackedProduct, res: ScrapeResult): boolean | null {
  if (p.targetSize) {
    if (!res.sizes.length) return null;
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
    // Network/bot error: keep the current state, skip silently (edge cases #4, #6).
    console.warn(`[scheduler] ${p.brand} check skipped:`, err);
    return;
  }

  const wasInStock = p.lastInStock ?? false;
  const nowInStock = effectiveInStock(p, res) ?? wasInStock;
  // Global notification switches (from settings); evaluated together with per-product track*.
  const s = getSettings();

  // Stock transition: out → in (notify only once — edge case #8)
  if (s.notifyStock && p.trackStock && !wasInStock && nowInStock) {
    notifyRestock(p.name ?? "Your item", p.id, p.targetSize);
  }

  // If the target size has its own price (e.g. Sephora ml variants) track that;
  // otherwise the product-wide price.
  const effPrice =
    (p.targetSize
      ? res.sizes.find(
          (sz) => sz.label.toLowerCase() === p.targetSize!.toLowerCase(),
        )?.price
      : null) ?? res.price;

  // Price drop: baseline = lowest price ever seen (gradual drops are not missed).
  // If the price later rises and then falls to a level still above the lowest,
  // no notification is sent — deliberate design.
  if (effPrice != null) {
    const baseline = p.lowestPrice ?? p.lastPrice; // backfill on first check for old records
    if (
      s.notifyPrice &&
      p.trackPrice &&
      baseline != null &&
      effPrice < baseline
    ) {
      notifyPriceDrop(p.name ?? "Your item", p.id, baseline, effPrice, res.currency);
    }
    // Baseline maintenance is independent of notification switches — keep it always correct.
    if (baseline == null || effPrice < baseline) {
      updateProduct(p.id, { lowestPrice: effPrice });
    }
  }

  recordCheck(p.id, nowInStock, effPrice, res.sizes, res.colors, res.imageUrl);
}

// In-round concurrency: saturates the browser semaphore (2) + leaves room for API-path checks.
const CHECK_CONCURRENCY = 3;

/** Check the whole watchlist in parallel (browser concurrency is limited separately). */
export async function checkAll(): Promise<void> {
  if (running) return; // prevent overlapping rounds
  running = true;
  try {
    const queue = listProducts();
    await Promise.all(
      Array.from({ length: CHECK_CONCURRENCY }, async () => {
        for (let p = queue.shift(); p; p = queue.shift()) {
          try {
            await checkOne(p);
          } catch (err) {
            // Isolate per product: a DB error (e.g. FK violation when the user
            // untracks mid-round) must not reject the whole round and skip the
            // badge/renderer refresh.
            console.warn(`[scheduler] ${p.brand} #${p.id} failed:`, err);
          }
        }
      }),
    );
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
  console.log(`[scheduler] scheduled: ${valid}`);
}

export function startScheduler(): void {
  schedule(getSettings().checkIntervalCron);
  refreshBadge();
  // Run one check on startup without waiting for the next cron boundary (user feedback).
  void checkAll();
}

/** Reschedule when the setting changes. */
export function reschedule(): void {
  schedule(getSettings().checkIntervalCron);
  // Show the new cadence working immediately: check without waiting for the next boundary.
  void checkAll();
}
