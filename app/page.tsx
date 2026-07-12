"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, RefreshCw, Settings2, X } from "lucide-react";
import { CheckBar } from "@/components/CheckBar";
import { PriceHistory } from "@/components/PriceHistory";
import { ProductResult } from "@/components/ProductResult";
import { SettingsPanel } from "@/components/SettingsPanel";
import { Watchlist } from "@/components/Watchlist";
import { getApi, hasApi } from "@/lib/client-api";
import { BRAND_LABELS } from "@/lib/brands";
import { cn } from "@/lib/cn";
import type {
  ScrapeResult,
  SizeAvailability,
  TrackedProduct,
} from "@/types/global";

/** Build a cache result for instant display from the last known state in the DB. */
function buildCachedResult(p: TrackedProduct): ScrapeResult {
  let sizes: SizeAvailability[] = [];
  let colors: string[] = [];
  try {
    sizes = p.lastSizes ? JSON.parse(p.lastSizes) : [];
  } catch {
    sizes = [];
  }
  try {
    colors = p.lastColors ? JSON.parse(p.lastColors) : [];
  } catch {
    colors = [];
  }
  return {
    name: p.name ?? "Untitled item",
    price: p.lastPrice,
    currency: "TRY",
    imageUrl: p.imageUrl,
    colors,
    sizes,
    inStock: p.lastInStock ?? false,
    source: "cache",
  };
}

export default function Home() {
  const [products, setProducts] = useState<TrackedProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScrapeResult | null>(null);
  const [currentUrl, setCurrentUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [checkingAll, setCheckingAll] = useState(false);
  // Incrementing key to clear CheckBar's uncontrolled input by remounting it.
  const [checkBarKey, setCheckBarKey] = useState(0);
  // Product selected from the watchlist (for the cache view + target size/color).
  const [selected, setSelected] = useState<TrackedProduct | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Incrementing token so late scrape results don't clobber a newer selection.
  const selectionToken = useRef(0);

  const refresh = useCallback(async () => {
    if (!hasApi()) return;
    setProducts(await getApi().listProducts());
  }, []);

  // Selecting from the watchlist: the last state in the DB is shown instantly,
  // live data refreshes in the background (the user doesn't wait for the scrape).
  const selectProduct = useCallback((p: TrackedProduct) => {
    const token = ++selectionToken.current;
    setLoading(false);
    setError(null);
    setSelected(p);
    setCurrentUrl(p.url);
    setResult(buildCachedResult(p));
    setRefreshing(true);
    getApi()
      .checkUrl(p.url)
      .then((res) => {
        if (selectionToken.current === token) setResult(res);
      })
      .catch(() => {
        // Live check failed: the cache view stays, the panel doesn't break.
      })
      .finally(() => {
        if (selectionToken.current === token) setRefreshing(false);
      });
  }, []);

  useEffect(() => {
    if (!hasApi()) return;
    // Initial load: call setState in the post-await callback (not directly in
    // the effect body) — avoids the cascading-render warning.
    let active = true;
    getApi()
      .listProducts()
      .then((p) => {
        if (active) setProducts(p);
      });
    // Auto-refresh when a background check changes the list.
    const offProducts = getApi().onProductsChanged(refresh);
    // "Settings…" in the tray menu opens the settings modal.
    const offSettings = getApi().onOpenSettings(() => setSettingsOpen(true));
    // Notification click: open the related product in the panel (find it in a
    // fresh list — the notification may arrive before the renderer refreshes).
    const offOpenProduct = getApi().onOpenProduct(async (id) => {
      const list = await getApi().listProducts();
      if (!active) return;
      setProducts(list);
      const p = list.find((x) => x.id === id);
      if (p) selectProduct(p);
    });
    return () => {
      active = false;
      offProducts();
      offSettings();
      offOpenProduct();
    };
  }, [refresh, selectProduct]);

  // When the product shown in the panel is removed from the list (trash button,
  // background change…) close the right panel too — don't keep showing a deleted product.
  useEffect(() => {
    if (selected && !products.some((p) => p.id === selected.id)) {
      clearResult();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);

  // Esc closes the panel (don't interfere while the settings modal is open — it has its own X).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !settingsOpen) clearResult();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen]);

  async function checkAllNow() {
    if (!hasApi()) return;
    setCheckingAll(true);
    try {
      await getApi().checkNow();
      await refresh();
    } finally {
      setCheckingAll(false);
    }
  }

  async function check(url: string) {
    const token = ++selectionToken.current;
    setLoading(true);
    setError(null);
    setResult(null);
    setSelected(null);
    setRefreshing(false);
    setCurrentUrl(url);
    try {
      const res = await getApi().checkUrl(url);
      if (selectionToken.current === token) setResult(res);
    } catch (e) {
      if (selectionToken.current === token) {
        setError(
          e instanceof Error
            ? e.message
            : "Couldn't check this link. Please try again.",
        );
      }
    } finally {
      if (selectionToken.current === token) setLoading(false);
    }
  }

  // Clear the right panel and the link input after tracking.
  function clearResult() {
    selectionToken.current++;
    setResult(null);
    setSelected(null);
    setRefreshing(false);
    setCurrentUrl("");
    setError(null);
    setCheckBarKey((k) => k + 1);
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar — watchlist */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-hairline bg-paper">
        <div className="drag-region flex h-20 items-end px-4 pb-2">
          <h1 className="font-display text-xl font-semibold tracking-tight text-ink">
            Atelier
          </h1>
        </div>
        <div className="flex items-center justify-between border-b border-hairline px-4 pb-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
            Watchlist · {products.length}
          </p>
          <div className="no-drag flex items-center gap-1">
            <button
              type="button"
              onClick={checkAllNow}
              disabled={checkingAll || products.length === 0}
              aria-label="Check now"
              title="Check now"
              className="text-muted transition-colors hover:text-ink disabled:opacity-40"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", checkingAll && "animate-spin")}
              />
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings"
              title="Settings"
              className="text-muted transition-colors hover:text-ink"
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <Watchlist
            products={products}
            onChange={refresh}
            selectedId={selected?.id ?? null}
            onSelect={(p) => {
              // Clicking the selected product again closes the panel (toggle).
              if (selected?.id === p.id) clearResult();
              else selectProduct(p);
            }}
          />
        </div>
        <footer className="border-t border-hairline px-4 py-3">
          <div className="flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-muted">
            {Object.values(BRAND_LABELS).map((b) => (
              <span key={b}>{b}</span>
            ))}
          </div>
        </footer>
      </aside>

      {/* Main panel */}
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="drag-region h-20 shrink-0" />

        <div className="flex-1 overflow-y-auto px-10 py-2">
          <div className="mx-auto w-full max-w-2xl">
            <CheckBar key={checkBarKey} onCheck={check} loading={loading} />

            {error && (
              <div className="mt-4 flex items-start gap-2 border border-signal/30 bg-signal/5 px-4 py-3 text-sm text-ink">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
                <span>{error}</span>
              </div>
            )}

            <div className="mt-6">
              {result && (
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                    {selected ? "From your watchlist" : "Live check"}
                  </span>
                  <button
                    type="button"
                    onClick={clearResult}
                    aria-label="Close panel"
                    title="Close (Esc)"
                    className="no-drag text-muted transition-colors hover:text-ink"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
              {result ? (
                <>
                  <ProductResult
                    key={currentUrl + result.source}
                    url={currentUrl}
                    result={result}
                    refreshing={refreshing}
                    initialSize={selected?.targetSize ?? null}
                    initialColor={selected?.targetColor ?? null}
                    tracked={products}
                    onTracked={() => {
                      refresh();
                      clearResult();
                    }}
                  />
                  {/* key: remount so the old chart doesn't flash when the product changes */}
                  {selected && (
                    <PriceHistory key={selected.id} productId={selected.id} />
                  )}
                </>
              ) : (
                !error && !loading && <EmptyState />
              )}
            </div>
          </div>
        </div>
      </main>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="select-none pb-16 pt-8">
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted">
        Stock &amp; price tracking
      </p>
      <h2 className="mt-3 whitespace-nowrap font-display text-[clamp(1.5rem,3vw,2.25rem)] font-light leading-[1.1] tracking-tight text-ink">
        Never miss{" "}
        <span className="font-semibold italic text-signal">restock</span> or{" "}
        <span className="font-semibold italic text-price-drop">price drop</span>{" "}
        again.
      </h2>
      <p className="mt-4 max-w-xl text-sm leading-relaxed text-ink-soft">
        Paste a product link from any supported store to check availability
        instantly — then add it to your watchlist and Atelier keeps an eye on it
        in the background.
      </p>
    </div>
  );
}
