"use client";

import { Trash2 } from "lucide-react";
import { getApi } from "@/lib/client-api";
import { BRAND_LABELS, formatPrice, timeAgo } from "@/lib/brands";
import { cn } from "@/lib/cn";
import type { TrackedProduct } from "@/types/global";

interface Props {
  products: TrackedProduct[];
  onChange: () => void;
  /** Ürüne tıklayınca sağ panelde göstermek için (tarayıcı açmaz). */
  onSelect: (url: string) => void;
}

export function Watchlist({ products, onChange, onSelect }: Props) {
  async function remove(id: number) {
    await getApi().untrack(id);
    onChange();
  }

  if (products.length === 0) {
    return (
      <p className="px-4 py-6 font-mono text-xs leading-relaxed text-muted">
        Henüz takip yok. Bir ürün bağlantısı yapıştırıp{" "}
        <span className="text-ink-soft">Takibe Al</span>'a bas.
      </p>
    );
  }

  return (
    <ul className="flex flex-col">
      {products.map((p) => (
        <li
          key={p.id}
          className="group relative border-b border-hairline px-4 py-3 transition-colors hover:bg-paper-raised"
        >
          <button
            type="button"
            onClick={() => onSelect(p.url)}
            className="no-drag block w-full text-left"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                {BRAND_LABELS[p.brand]}
              </span>
              <StockDot inStock={p.lastInStock} />
            </div>
            <p className="mt-1 truncate text-sm font-medium text-ink">
              {p.name ?? "İsimsiz ürün"}
            </p>
            <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-muted">
              <span className="text-ink-soft">
                {formatPrice(p.lastPrice, "TRY")}
              </span>
              {p.targetSize && (
                <span className="border border-hairline px-1">{p.targetSize}</span>
              )}
              <span className="ml-auto">{timeAgo(p.lastCheckedAt)}</span>
            </div>
          </button>
          <button
            type="button"
            onClick={() => remove(p.id)}
            aria-label="Takipten çıkar"
            className="no-drag absolute right-3 top-3 hidden text-muted transition-colors hover:text-signal group-hover:block"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function StockDot({ inStock }: { inStock: boolean | null }) {
  return (
    <span
      title={inStock ? "Stokta" : inStock === false ? "Tükendi" : "Bilinmiyor"}
      className={cn(
        "h-1.5 w-1.5 rounded-full",
        inStock ? "bg-in-stock" : inStock === false ? "bg-out-stock" : "bg-hairline",
      )}
    />
  );
}
