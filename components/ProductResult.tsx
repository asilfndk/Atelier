"use client";

import { useRef, useState } from "react";
import { Bell, Check, ExternalLink, Loader2, Tag } from "lucide-react";
import { getApi } from "@/lib/client-api";
import { formatPrice } from "@/lib/brands";
import { cn } from "@/lib/cn";
import type { ScrapeResult } from "@/types/global";
import { ProductImage } from "./ProductImage";
import { StockMatrix } from "./StockMatrix";

interface Props {
  url: string;
  result: ScrapeResult;
  onTracked: () => void;
  /** True while the cache view refreshes in the background (small badge shown). */
  refreshing?: boolean;
  /** When opened from the watchlist, the target size/color comes pre-selected. */
  initialSize?: string | null;
  initialColor?: string | null;
  /**
   * Tracked combos (url+size+color). If the selected combo matches one of
   * these, the button becomes "Already tracked"; picking a different combo
   * re-enables it.
   */
  tracked?: {
    url: string;
    targetSize: string | null;
    targetColor: string | null;
  }[];
}

/**
 * The color of the variant matching the URL; otherwise the first color.
 * A Zara variant is distinguished by the `?v1=` parameter, Mango by the color
 * segment in the path — both are embedded in the variant `url`, so v1 is
 * compared first, then the path.
 */
function defaultColor(result: ScrapeResult, url: string): string | null {
  try {
    const u = new URL(url);
    const v1 = u.searchParams.get("v1");
    if (v1 && result.colorVariants) {
      const m = result.colorVariants.find((v) => v.url?.includes(`v1=${v1}`));
      if (m) return m.color;
    }
    if (result.colorVariants) {
      const here = u.pathname.replace(/\/+$/, "");
      const m = result.colorVariants.find((v) => {
        if (!v.url) return false;
        try {
          return new URL(v.url).pathname.replace(/\/+$/, "") === here;
        } catch {
          return false;
        }
      });
      if (m) return m.color;
    }
  } catch {
    // If the URL can't be parsed, fall back to the first color.
  }
  return result.colors[0] ?? null;
}

export function ProductResult({
  url,
  result,
  onTracked,
  refreshing = false,
  initialSize = null,
  initialColor = null,
  tracked = [],
}: Props) {
  const [size, setSize] = useState<string | null>(initialSize);
  const [color, setColor] = useState<string | null>(
    initialColor ?? defaultColor(result, url),
  );
  // Lazily fetched variant data (color → live result). For some brands (Gratis)
  // the variant's real photo/price only exists on its own page/detail, so on
  // color selection it is completed in the background via checkUrl(variant.url).
  const [variantData, setVariantData] = useState<Record<string, ScrapeResult>>(
    {},
  );
  const [variantLoading, setVariantLoading] = useState(false);
  // Keep a late-returning fetch from wrongly hiding the spinner on rapid color changes.
  const variantToken = useRef(0);

  // Variant data of the selected color (if any) — image/sizes/price come from
  // it; lazily fetched live data (fetched) takes precedence over the variant snapshot.
  const variant =
    (color && result.colorVariants?.find((v) => v.color === color)) || null;
  const fetched = (color && variantData[color]) || null;
  const activeSizes = fetched?.sizes?.length
    ? fetched.sizes
    : variant?.sizes?.length
      ? variant.sizes
      : result.sizes;
  const activeImage = fetched?.imageUrl ?? variant?.imageUrl ?? result.imageUrl;
  const activeInStock = fetched
    ? fetched.inStock
    : variant?.sizes?.length
      ? variant.sizes.some((s) => s.inStock)
      : (variant?.inStock ?? result.inStock);
  // Tracking + "Open on site" use the color-specific URL — the scheduler checks the right variant.
  const activeUrl = variant?.url ?? url;
  // Same dedup rule as the repo ('' coalescing included): the button locks only
  // when the selected combo is already tracked; picking a different size/color unlocks it.
  const alreadyTracked = tracked.some(
    (t) =>
      t.url === activeUrl &&
      (t.targetSize ?? "") === (size ?? "") &&
      (t.targetColor ?? "") === (color ?? ""),
  );

  function selectColor(c: string | null) {
    setColor(c);
    // Drop the selection if the new color's size list lacks the selected size.
    const next =
      (c && result.colorVariants?.find((v) => v.color === c)) || null;
    const sizesFor = next?.sizes?.length ? next.sizes : result.sizes;
    if (size && !sizesFor.some((s) => s.label === size)) setSize(null);

    // Lazy variant fetch: if the variant has a URL but no image (Gratis), the
    // real photo/price/stock are fetched in the background from its own detail.
    const token = ++variantToken.current;
    if (c && next?.url && next.imageUrl == null && !variantData[c]) {
      setVariantLoading(true);
      getApi()
        .checkUrl(next.url)
        .then((res) => {
          setVariantData((m) => ({ ...m, [c]: res }));
        })
        .catch(() => {
          // Fetch failed: keep showing the product-wide data.
        })
        .finally(() => {
          if (variantToken.current === token) setVariantLoading(false);
        });
    } else {
      setVariantLoading(false);
    }
  }
  const [notifyStock, setNotifyStock] = useState(true);
  const [notifyPrice, setNotifyPrice] = useState(true);
  const [tracking, setTracking] = useState(false);
  const [done, setDone] = useState(false);

  async function track() {
    setTracking(true);
    try {
      // If a target size is selected, that size's stock status; otherwise the
      // product-wide one (same rule as scheduler.effectiveInStock) — so tracking a
      // sold-out size turns the list dot red immediately.
      const targetSize = size
        ? activeSizes.find(
            (s) => s.label.toLowerCase() === size.toLowerCase(),
          )
        : null;
      const effectiveInStock = targetSize ? targetSize.inStock : activeInStock;
      await getApi().track({
        url: activeUrl,
        name: result.name,
        imageUrl: activeImage,
        targetSize: size,
        targetColor: color,
        trackStock: notifyStock,
        trackPrice: notifyPrice,
        lastPrice:
          targetSize?.price ??
          fetched?.price ??
          variant?.price ??
          result.price,
        lastInStock: effectiveInStock,
        sizes: activeSizes,
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
      {/* Image — key: remounts when the URL changes, resetting the error state */}
      <ProductImage
        key={activeImage ?? "none"}
        imageUrl={activeImage}
        name={result.name}
      />

      {/* Details */}
      <div className="flex flex-col">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
          <span
            className={cn(
              "inline-flex h-1.5 w-1.5 rounded-full",
              activeInStock ? "bg-in-stock" : "bg-signal",
            )}
          />
          {activeInStock ? "In stock" : "Sold out"}
          <span className="text-hairline">·</span>
          <span>
            {result.source === "api"
              ? "API"
              : result.source === "browser"
                ? "Browser"
                : "Cached"}
          </span>
          {(refreshing || variantLoading) && (
            <span className="flex items-center gap-1 text-ink-soft">
              <Loader2 className="h-3 w-3 animate-spin" />
              Refreshing…
            </span>
          )}
        </div>

        <h2 className="mt-2 font-display text-2xl font-semibold leading-tight tracking-tight text-ink">
          {result.name}
        </h2>

        <p className="mt-1 font-display text-4xl font-light tracking-tight text-ink">
          {formatPrice(
            // If the selected size has its own price (e.g. Sephora ml sizes), show it
            (size
              ? activeSizes.find((s) => s.label === size)?.price
              : null) ??
              fetched?.price ??
              variant?.price ??
              result.price,
            result.currency,
          )}
        </p>

        {/* Color */}
        {result.colors.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
              Color
            </p>
            <div className="flex flex-wrap gap-1.5">
              {result.colors.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => selectColor(c === color ? null : c)}
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

        {/* Size matrix — skeleton when the cache has no snapshot */}
        <div className="mt-5">
          <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
            Size{size ? ` · ${size}` : ""}
          </p>
          {activeSizes.length === 0 && result.source === "cache" ? (
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
              sizes={activeSizes}
              selected={size}
              onSelect={setSize}
              currency={result.currency}
            />
          )}
        </div>

        {/* Notification options */}
        <div className="mt-6 flex flex-wrap gap-4 border-t border-hairline pt-4">
          <Toggle
            active={notifyStock}
            onClick={() => setNotifyStock((v) => !v)}
            icon={<Bell className="h-3.5 w-3.5" />}
            label="Notify me when it's back in stock"
          />
          <Toggle
            active={notifyPrice}
            onClick={() => setNotifyPrice((v) => !v)}
            icon={<Tag className="h-3.5 w-3.5" />}
            label="Notify me when the price drops"
          />
        </div>

        {/* Actions */}
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
              ? "In your watchlist"
              : done
                ? "Added to watchlist"
                : "Add to Watchlist"}
          </button>
          <button
            type="button"
            onClick={() => getApi().openExternal(activeUrl)}
            className="no-drag flex h-10 items-center gap-2 px-4 text-sm text-ink-soft transition-colors hover:text-ink"
          >
            <ExternalLink className="h-4 w-4" />
            View on site
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

