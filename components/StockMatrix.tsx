"use client";

import { cn } from "@/lib/cn";
import type { SizeAvailability } from "@/types/global";

interface Props {
  sizes: SizeAvailability[];
  selected?: string | null;
  onSelect?: (label: string | null) => void;
}

/**
 * İmza öğesi: bedenlerin monospace stok matrisi.
 * Stokta = dolu mürekkep hücre · tükendi = üstü çizili soluk hücre.
 * Seçilebilir (takip için hedef beden).
 */
export function StockMatrix({ sizes, selected, onSelect }: Props) {
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
        return (
          <button
            key={s.label}
            type="button"
            disabled={!clickable}
            onClick={() => onSelect?.(isSel ? null : s.label)}
            aria-pressed={isSel}
            title={s.inStock ? "Stokta" : "Tükendi (yine de takip edilebilir)"}
            className={cn(
              "no-drag relative h-10 min-w-10 px-2.5 font-mono text-sm font-medium",
              "flex items-center justify-center border transition-colors",
              !s.inStock && "line-through",
              isSel
                ? "border-signal bg-signal text-white hover:border-signal"
                : s.inStock
                  ? "border-ink/15 text-ink hover:border-ink"
                  : "border-hairline text-out-stock hover:border-ink/40",
            )}
          >
            {s.label}
            {s.inStock && !isSel && (
              <span className="absolute right-1 top-1 h-1 w-1 rounded-full bg-in-stock" />
            )}
          </button>
        );
      })}
    </div>
  );
}
