"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, RefreshCw, Settings2 } from "lucide-react";
import { CheckBar } from "@/components/CheckBar";
import { ProductResult } from "@/components/ProductResult";
import { SettingsPanel } from "@/components/SettingsPanel";
import { Watchlist } from "@/components/Watchlist";
import { getApi, hasApi } from "@/lib/client-api";
import { BRAND_LABELS } from "@/lib/brands";
import { cn } from "@/lib/cn";
import type { ScrapeResult, TrackedProduct } from "@/types/global";

export default function Home() {
  const [products, setProducts] = useState<TrackedProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScrapeResult | null>(null);
  const [currentUrl, setCurrentUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [checkingAll, setCheckingAll] = useState(false);
  // CheckBar kontrolsüz input'unu remount ederek temizlemek için artan anahtar.
  const [checkBarKey, setCheckBarKey] = useState(0);

  const refresh = useCallback(async () => {
    if (!hasApi()) return;
    setProducts(await getApi().listProducts());
  }, []);

  useEffect(() => {
    refresh();
    if (!hasApi()) return;
    // Arka plan kontrolü listeyi değiştirince otomatik yenile.
    const off = getApi().onProductsChanged(refresh);
    return off;
  }, [refresh]);

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
    setLoading(true);
    setError(null);
    setResult(null);
    setCurrentUrl(url);
    try {
      const res = await getApi().checkUrl(url);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kontrol başarısız oldu.");
    } finally {
      setLoading(false);
    }
  }

  // Takibe alındıktan sonra sağ paneli ve link input'unu temizle.
  function clearResult() {
    setResult(null);
    setCurrentUrl("");
    setError(null);
    setCheckBarKey((k) => k + 1);
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar — izleme listesi */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-hairline bg-paper">
        <div className="drag-region flex h-20 items-end px-4 pb-2">
          <h1 className="font-display text-lg font-semibold tracking-tight text-ink">
            Atelier
          </h1>
        </div>
        <div className="flex items-center justify-between border-b border-hairline px-4 pb-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
            İzleme Listesi · {products.length}
          </p>
          <div className="no-drag flex items-center gap-1">
            <button
              type="button"
              onClick={checkAllNow}
              disabled={checkingAll || products.length === 0}
              aria-label="Şimdi kontrol et"
              title="Şimdi kontrol et"
              className="text-muted transition-colors hover:text-ink disabled:opacity-40"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", checkingAll && "animate-spin")}
              />
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Ayarlar"
              title="Ayarlar"
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
            onSelect={check}
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

      {/* Ana panel */}
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
              {result ? (
                <ProductResult
                  url={currentUrl}
                  result={result}
                  onTracked={() => {
                    refresh();
                    clearResult();
                  }}
                />
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
        Inditex stok &amp; fiyat takibi
      </p>
      <h2 className="mt-3 max-w-md font-display text-4xl font-light leading-[1.1] tracking-tight text-ink">
        Bir bedenin{" "}
        <span className="font-semibold italic text-signal">geri gelmesini</span>{" "}
        ya da fiyatın düşmesini bekleme.
      </h2>
      <p className="mt-4 max-w-sm text-sm leading-relaxed text-ink-soft">
        Zara, Bershka veya Stradivarius'tan bir ürün bağlantısı
        yapıştır. Stok durumunu anında gör, takibe al; gerisini Atelier arka
        planda halleder.
      </p>
    </div>
  );
}
