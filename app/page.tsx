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

/** DB'deki son bilinen durumdan anında gösterilecek önbellek sonucu üret. */
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
    name: p.name ?? "İsimsiz ürün",
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
  // CheckBar kontrolsüz input'unu remount ederek temizlemek için artan anahtar.
  const [checkBarKey, setCheckBarKey] = useState(0);
  // İzleme listesinden seçilen ürün (önbellek görünümü + hedef beden/renk için).
  const [selected, setSelected] = useState<TrackedProduct | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Geç dönen scrape sonuçlarının yeni seçimi ezmemesi için artan jeton.
  const selectionToken = useRef(0);

  const refresh = useCallback(async () => {
    if (!hasApi()) return;
    setProducts(await getApi().listProducts());
  }, []);

  // İzleme listesinden seçim: DB'deki son durum anında gösterilir,
  // canlı veri arka planda tazelenir (kullanıcı scrape'i beklemez).
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
        // Canlı kontrol başarısız: önbellek görünümü kalır, panel bozulmaz.
      })
      .finally(() => {
        if (selectionToken.current === token) setRefreshing(false);
      });
  }, []);

  useEffect(() => {
    if (!hasApi()) return;
    // İlk yükleme: setState'i await sonrası callback'te yap (effect gövdesinde
    // doğrudan değil) — cascading render uyarısını önler.
    let active = true;
    getApi()
      .listProducts()
      .then((p) => {
        if (active) setProducts(p);
      });
    // Arka plan kontrolü listeyi değiştirince otomatik yenile.
    const offProducts = getApi().onProductsChanged(refresh);
    // Tray menüsündeki "Ayarlar…" ayar modalını açar.
    const offSettings = getApi().onOpenSettings(() => setSettingsOpen(true));
    // Bildirim tıklaması: ilgili ürünü panelde aç (taze listeden bul —
    // bildirim, renderer listeyi yenilemeden önce gelebilir).
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

  // Panelde gösterilen ürün listeden kaldırılınca (çöp butonu, arka plan
  // değişikliği…) sağ paneli de kapat — silinmiş ürünü göstermeye devam etme.
  useEffect(() => {
    if (selected && !products.some((p) => p.id === selected.id)) {
      clearResult();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);

  // Esc paneli kapatır (ayar modalı açıkken ona karışma — modalın kendi X'i var).
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
        setError(e instanceof Error ? e.message : "Kontrol başarısız oldu.");
      }
    } finally {
      if (selectionToken.current === token) setLoading(false);
    }
  }

  // Takibe alındıktan sonra sağ paneli ve link input'unu temizle.
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
      {/* Sidebar — izleme listesi */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-hairline bg-paper">
        <div className="drag-region flex h-20 items-end px-4 pb-2">
          <h1 className="font-display text-xl font-semibold tracking-tight text-ink">
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
            selectedId={selected?.id ?? null}
            onSelect={(p) => {
              // Seçili ürüne tekrar tıklamak paneli kapatır (toggle).
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
              {result && (
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                    {selected ? "İzleme listesinden" : "Anlık kontrol"}
                  </span>
                  <button
                    type="button"
                    onClick={clearResult}
                    aria-label="Paneli kapat"
                    title="Kapat (Esc)"
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
                    alreadyTracked={selected != null}
                    onTracked={() => {
                      refresh();
                      clearResult();
                    }}
                  />
                  {/* key: ürün değişince eski grafik anlık görünmesin diye remount */}
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
        Stok &amp; fiyat takibi
      </p>
      <h2 className="mt-3 max-w-md font-display text-4xl font-light leading-[1.1] tracking-tight text-ink">
        Bir bedenin{" "}
        <span className="font-semibold italic text-signal">geri gelmesini</span>{" "}
        ya da{" "}
        <span className="font-semibold italic text-price-drop">
          fiyatın düşmesini
        </span>{" "}
        bekleme.
      </h2>
      <p className="mt-4 max-w-sm text-sm leading-relaxed text-ink-soft">
        Desteklenen mağazalardan bir ürün bağlantısı yapıştır. Stok durumunu
        anında gör, takibe al; gerisini Atelier arka planda halleder.
      </p>
    </div>
  );
}
