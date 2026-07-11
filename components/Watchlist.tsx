"use client";

import { useEffect, useState } from "react";
import { Tag, Trash2 } from "lucide-react";
import { getApi } from "@/lib/client-api";
import { BRAND_LABELS, formatPrice, timeAgo } from "@/lib/brands";
import { cn } from "@/lib/cn";
import type { TrackedProduct } from "@/types/global";

interface Props {
  products: TrackedProduct[];
  onChange: () => void;
  /** Show the product in the right panel on click (does not open a browser). */
  onSelect: (product: TrackedProduct) => void;
  /** The product open in the right panel — used to highlight its row. */
  selectedId?: number | null;
}

export function Watchlist({ products, onChange, onSelect, selectedId }: Props) {
  // Periodic re-render so relative times ("3 min ago") advance live.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  async function remove(id: number) {
    await getApi().untrack(id);
    onChange();
  }

  async function togglePriceTracking(p: TrackedProduct) {
    await getApi().updateProduct(p.id, { trackPrice: !p.trackPrice });
    onChange();
  }

  if (products.length === 0) {
    return (
      <p className="px-4 py-6 font-mono text-xs leading-relaxed text-muted">
        Your watchlist is empty. Paste a product link above and hit{" "}
        <span className="text-ink-soft">Add to Watchlist</span>.
      </p>
    );
  }

  return (
    <ul className="flex flex-col">
      {products.map((p) => (
        <li
          key={p.id}
          className={cn(
            "group relative border-b border-l-2 border-b-hairline px-4 py-3 transition-colors hover:bg-paper-raised",
            selectedId === p.id
              ? "border-l-ink bg-paper-raised"
              : "border-l-transparent",
          )}
        >
          <button
            type="button"
            onClick={() => onSelect(p)}
            className="no-drag block w-full text-left"
          >
            <div className="flex items-start gap-3">
              {/* key: remounts when the URL changes, resetting the failed state */}
              <Thumb key={p.imageUrl ?? "none"} imageUrl={p.imageUrl} name={p.name} />
              <div className="min-w-0 flex-1">
                {/* Status dot on the left — the top-right corner is reserved for the hover trash button. */}
                <div className="flex items-center gap-1.5 pr-5">
                  <StockDot inStock={p.lastInStock} />
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                    {BRAND_LABELS[p.brand]}
                  </span>
                </div>
                <p className="mt-1 truncate text-sm font-medium text-ink">
                  {p.name ?? "Untitled item"}
                </p>
                <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-muted">
                  <span className="text-ink-soft">
                    {formatPrice(p.lastPrice, "TRY")}
                  </span>
                  {p.targetSize && (
                    <span className="border border-hairline px-1">
                      {p.targetSize}
                    </span>
                  )}
                  <span className="ml-auto">{timeAgo(p.lastCheckedAt)}</span>
                </div>
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => togglePriceTracking(p)}
            aria-label={
              p.trackPrice ? "Turn off price alerts" : "Turn on price alerts"
            }
            title={p.trackPrice ? "Price alerts on" : "Price alerts off"}
            className={cn(
              "no-drag absolute right-8 top-3 transition-colors",
              p.trackPrice
                ? "block text-price-drop"
                : "hidden text-muted hover:text-ink group-hover:block",
            )}
          >
            <Tag className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => remove(p.id)}
            aria-label="Remove from watchlist"
            className="no-drag absolute right-3 top-3 hidden text-muted transition-colors hover:text-signal group-hover:block"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function Thumb({
  imageUrl,
  name,
}: {
  imageUrl: string | null;
  name: string | null;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="aspect-[3/4] w-10 shrink-0 overflow-hidden border border-hairline bg-paper">
      {imageUrl && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={name ?? "Product image"}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full items-center justify-center font-mono text-[10px] text-muted">
          —
        </div>
      )}
    </div>
  );
}

function StockDot({ inStock }: { inStock: boolean | null }) {
  return (
    <span
      title={inStock ? "In stock" : inStock === false ? "Sold out" : "Unknown"}
      className={cn(
        "h-1.5 w-1.5 shrink-0 rounded-full",
        inStock ? "bg-in-stock" : inStock === false ? "bg-signal" : "bg-hairline",
      )}
    />
  );
}
