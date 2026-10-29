import cron, { type ScheduledTask } from "node-cron";
import { checkUrl, getScraperForUrl } from "@/lib/scrapers";
import {
  getSettings,
  listProducts,
  recordCheck,
  updateProduct,
} from "@/lib/repo";
import type { ScrapeResult } from "@/lib/scrapers";
import type { Settings, TrackedProduct } from "@/db/schema";
import { emitProductsChanged } from "./app-state";
import { notifyPriceDrop, notifyRestock } from "./notifications";

const DEFAULT_CRON = "*/15 * * * *";
let task: ScheduledTask | null = null;
let current: Promise<void> | null = null;

/**
 * Stock of the target size if one is set, otherwise the overall stock status.
 * Returns null (= unknown, keep previous state) when a target size is set but
 * the scrape produced no size list at all — a transient parse miss would
 * otherwise record out-of-stock and fire a false restock on the next round.
 * A non-empty list that lacks the target size still counts as out-of-stock
 * (some stores drop sold-out sizes from the list).
 */
function effectiveInStock(
  p: TrackedProduct,
  res: ScrapeResult,
): boolean | null {
  if (p.targetSize) {
    if (!res.sizes.length) return null;
    const match = res.sizes.find(
      (s) => s.label.toLowerCase() === p.targetSize!.toLowerCase(),
    );
    return match ? match.inStock : false;
  }
  return res.inStock;
}

async function checkOne(
  p: TrackedProduct,
  // Global notification switches; evaluated together with per-product track*.
  s: Settings,
  // One scrape per URL per round: rows that share a URL (different size/color) reuse it.
  memo: Map<string, Promise<ScrapeResult>>,
): Promise<void> {
  let res: ScrapeResult;
  try {
    let r = memo.get(p.url);
    if (!r) {
      r = checkUrl(p.url);
      memo.set(p.url, r);
    }
    res = await r;
  } catch (err) {
    // Network/bot error: keep the current state, skip silently (edge cases #4, #6).
    console.warn(`[scheduler] ${p.brand} check skipped:`, err);
    return;
  }

  const wasInStock = p.lastInStock ?? false;
  const nowInStock = effectiveInStock(p, res) ?? wasInStock;

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
      notifyPriceDrop(
        p.name ?? "Your item",
        p.id,
        baseline,
        effPrice,
        res.currency,
      );
    }
    // Baseline maintenance is independent of notification switches — keep it always correct.
    if (baseline == null || effPrice < baseline) {
      updateProduct(p.id, { lowestPrice: effPrice });
    }
  }

  recordCheck(p.id, nowInStock, effPrice, res.sizes, res.colors, res.imageUrl);
}

// In-round concurrency: saturates the browser semaphore (2) + leaves room for API-path checks.
// runRound queues API-backed rows first so they don't wait behind browser scrapes.
const CHECK_CONCURRENCY = 3;

/**
 * Check the whole watchlist (browser concurrency is limited separately).
 * A call during a running round joins it, so callers (Check now) resolve when it really ends.
 */
export function checkAll(): Promise<void> {
  return (current ??= runRound().finally(() => {
    current = null;
  }));
}

async function runRound(): Promise<void> {
  const queue = listProducts();
  // ponytail: ordering, not separate pools; split API and browser pools if rounds still stall
  // Stable sort: newest-first order is kept within each group.
  queue.sort(
    (a, b) =>
      Number(!!getScraperForUrl(b.url)?.hasApi) -
      Number(!!getScraperForUrl(a.url)?.hasApi),
  );
  const s = getSettings();
  const memo = new Map<string, Promise<ScrapeResult>>();
  await Promise.all(
    Array.from({ length: CHECK_CONCURRENCY }, async () => {
      for (let p = queue.shift(); p; p = queue.shift()) {
        try {
          await checkOne(p, s, memo);
        } catch (err) {
          // Isolate per product: a DB error (e.g. FK violation when the user
          // untracks mid-round) must not reject the whole round and skip the
          // renderer refresh.
          console.warn(`[scheduler] ${p.brand} #${p.id} failed:`, err);
        }
      }
    }),
  );
  emitProductsChanged();
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
  // Run one check on startup without waiting for the next cron boundary (user feedback).
  void checkAll();
}

/** Reschedule when the setting changes. */
export function reschedule(): void {
  schedule(getSettings().checkIntervalCron);
  // Show the new cadence working immediately: check without waiting for the next boundary.
  void checkAll();
}
