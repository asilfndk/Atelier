"use client";

import { cn } from "@/lib/cn";
import { formatPrice } from "@/lib/brands";
import type { SizeAvailability } from "@/types/global";

interface Props {
  sizes: SizeAvailability[];
  selected?: string | null;
  onSelect?: (label: string | null) => void;
  /** Varyant fiyatları (size.price) gösterilirken kullanılacak para birimi */
  currency?: string | null;
}

/**
 * İmza öğesi: bedenlerin monospace stok matrisi.
 * Stokta = dolu mürekkep hücre · tükendi = üstü çizili soluk hücre.
 * Seçilebilir (takip için hedef beden).
 */
export function StockMatrix({ sizes, selected, onSelect, currency }: Props) {
  if (sizes.length === 0) {
    return (
      <p className="font-mono text-xs uppercase tracking-widest text-muted">
        Beden bilgisi okunamadı
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {sizes.map((s) => {
        const isSel = selected === s.label;
        const clickable = !!onSelect;
        const priceLabel =
          s.price != null ? formatPrice(s.price, currency ?? null) : null;
        return (
          <button
            key={s.label}
            type="button"
            disabled={!clickable}
            onClick={() => onSelect?.(isSel ? null : s.label)}
            aria-pressed={isSel}
            title={
              (s.inStock ? "Stokta" : "Tükendi (yine de takip edilebilir)") +
              (priceLabel ? ` · ${priceLabel}` : "")
            }
            className={cn(
              "no-drag relative min-h-10 min-w-10 px-2.5 py-1 font-mono text-sm font-medium",
              "flex flex-col items-center justify-center border transition-colors",
              !s.inStock && "line-through",
              isSel
                ? "border-signal bg-signal text-white hover:border-signal"
                : s.inStock
                  ? "border-ink/15 text-ink hover:border-ink"
                  : "border-hairline text-out-stock hover:border-ink/40",
            )}
          >
            {s.label}
            {priceLabel && (
              <span
                className={cn(
                  "text-[10px] font-normal leading-tight",
                  isSel ? "text-white/80" : "text-muted",
                )}
              >
                {priceLabel}
              </span>
            )}
            {s.inStock && !isSel && (
              <span className="absolute right-1 top-1 h-1 w-1 rounded-full bg-in-stock" />
            )}
          </button>
        );
      })}
    </div>
  );
}
