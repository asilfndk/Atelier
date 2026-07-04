"use client";

import { useState } from "react";
import { Bell, Check, ExternalLink, Loader2, Tag } from "lucide-react";
import { getApi } from "@/lib/client-api";
import { formatPrice } from "@/lib/brands";
import { cn } from "@/lib/cn";
import type { ScrapeResult } from "@/types/global";
import { StockMatrix } from "./StockMatrix";

interface Props {
  url: string;
  result: ScrapeResult;
  onTracked: () => void;
  /** Önbellek görünümü arka planda tazelenirken true (küçük rozet gösterilir). */
  refreshing?: boolean;
  /** İzleme listesinden açılınca hedef beden/renk ön-seçili gelir. */
  initialSize?: string | null;
  initialColor?: string | null;
  /** Ürün zaten takipte — "Takibe Al" yerine "Zaten takipte" gösterilir. */
  alreadyTracked?: boolean;
}

export function ProductResult({
  url,
  result,
  onTracked,
  refreshing = false,
  initialSize = null,
  initialColor = null,
  alreadyTracked = false,
}: Props) {
  const [size, setSize] = useState<string | null>(initialSize);
  const [color, setColor] = useState<string | null>(
    initialColor ?? result.colors[0] ?? null,
  );
  const [notifyStock, setNotifyStock] = useState(true);
  const [notifyPrice, setNotifyPrice] = useState(true);
  const [tracking, setTracking] = useState(false);
  const [done, setDone] = useState(false);

  async function track() {
    setTracking(true);
    try {
      // Hedef beden seçiliyse o bedenin stok durumu; yoksa ürün geneli
      // (scheduler.effectiveInStock ile aynı kural) — böylece tükenmiş bir beden
      // takibe alınınca liste noktası anında kırmızı olur.
      const targetSize = size
        ? result.sizes.find(
            (s) => s.label.toLowerCase() === size.toLowerCase(),
          )
        : null;
      const effectiveInStock = targetSize ? targetSize.inStock : result.inStock;
      await getApi().track({
        url,
        name: result.name,
        imageUrl: result.imageUrl,
        targetSize: size,
        targetColor: color,
        trackStock: notifyStock,
        trackPrice: notifyPrice,
        lastPrice: result.price,
        lastInStock: effectiveInStock,
        sizes: result.sizes,
        colors: result.colors,
      });
      setDone(true);
      onTracked();
    } finally {
      setTracking(false);
    }
  }

  return (
    <article className="grid gap-8 border border-hairline bg-paper-raised p-6 sm:grid-cols-[200px_1fr]">
      {/* Görsel */}
      <div className="aspect-[3/4] overflow-hidden border border-hairline bg-paper">
        {result.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={result.imageUrl}
            alt={result.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center font-mono text-xs uppercase tracking-widest text-muted">
            görsel yok
          </div>
        )}
      </div>

      {/* Detay */}
      <div className="flex flex-col">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
          <span
            className={cn(
              "inline-flex h-1.5 w-1.5 rounded-full",
              result.inStock ? "bg-in-stock" : "bg-signal",
            )}
          />
          {result.inStock ? "Stokta" : "Tükendi"}
          <span className="text-hairline">·</span>
          <span>
            {result.source === "api"
              ? "API"
              : result.source === "browser"
                ? "Tarayıcı"
                : "Önbellek"}
          </span>
          {refreshing && (
            <span className="flex items-center gap-1 text-ink-soft">
              <Loader2 className="h-3 w-3 animate-spin" />
              yenileniyor…
            </span>
          )}
        </div>

        <h2 className="mt-2 font-display text-2xl font-semibold leading-tight tracking-tight text-ink">
          {result.name}
        </h2>

        <p className="mt-1 font-display text-4xl font-light tracking-tight text-ink">
          {formatPrice(result.price, result.currency)}
        </p>

        {/* Renk */}
        {result.colors.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
              Renk
            </p>
            <div className="flex flex-wrap gap-1.5">
              {result.colors.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c === color ? null : c)}
                  className={cn(
                    "no-drag border px-3 py-1.5 text-xs transition-colors",
                    c === color
                      ? "border-ink bg-ink text-paper-raised"
                      : "border-hairline text-ink-soft hover:border-ink",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Beden matrisi — önbellekte snapshot yoksa skeleton */}
        <div className="mt-5">
          <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
            Beden{size ? ` · ${size}` : ""}
          </p>
          {result.sizes.length === 0 && result.source === "cache" ? (
            <div className="flex flex-wrap gap-1.5">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className="h-8 w-12 animate-pulse border border-hairline bg-paper"
                />
              ))}
            </div>
          ) : (
            <StockMatrix
              sizes={result.sizes}
              selected={size}
              onSelect={setSize}
            />
          )}
        </div>

        {/* Bildirim seçenekleri */}
        <div className="mt-6 flex flex-wrap gap-4 border-t border-hairline pt-4">
          <Toggle
            active={notifyStock}
            onClick={() => setNotifyStock((v) => !v)}
            icon={<Bell className="h-3.5 w-3.5" />}
            label="Stok gelince bildir"
          />
          <Toggle
            active={notifyPrice}
            onClick={() => setNotifyPrice((v) => !v)}
            icon={<Tag className="h-3.5 w-3.5" />}
            label="Fiyat düşünce bildir"
          />
        </div>

        {/* Eylemler */}
        <div className="mt-auto flex items-center gap-3 pt-6">
          <button
            type="button"
            onClick={track}
            disabled={
              alreadyTracked ||
              tracking ||
              done ||
              (!notifyStock && !notifyPrice)
            }
            className={cn(
              "no-drag flex h-10 items-center gap-2 px-5 text-sm font-medium transition-all",
              done || alreadyTracked
                ? "bg-in-stock text-white"
                : "bg-ink text-paper-raised hover:brightness-110",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {done || alreadyTracked ? (
              <Check className="h-4 w-4" />
            ) : (
              <Bell className="h-4 w-4" />
            )}
            {alreadyTracked
              ? "Zaten takipte"
              : done
                ? "Takibe alındı"
                : "Takibe Al"}
          </button>
          <button
            type="button"
            onClick={() => getApi().openExternal(url)}
            className="no-drag flex h-10 items-center gap-2 px-4 text-sm text-ink-soft transition-colors hover:text-ink"
          >
            <ExternalLink className="h-4 w-4" />
            Sitede aç
          </button>
        </div>
      </div>
    </article>
  );
}

function Toggle({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "no-drag flex items-center gap-2 text-xs transition-colors",
        active ? "text-ink" : "text-muted hover:text-ink-soft",
      )}
    >
      <span
        className={cn(
          "flex h-4 w-4 items-center justify-center border transition-colors",
          active ? "border-signal bg-signal text-white" : "border-hairline",
        )}
      >
        {active && <Check className="h-3 w-3" />}
      </span>
      <span className="flex items-center gap-1.5">
        {icon}
        {label}
      </span>
    </button>
  );
}
