import { fetchText, nextData } from "./base";
import type { ColorVariant, ParsedProduct, ProductStock } from "./types";

/** The subset of a `__NEXT_DATA__` product that we use */
interface SneaksupProduct {
  productName?: string;
  price?: { newPrice?: number; currencyCode?: string };
  pictures?: { url?: string; mediaType?: number }[];
  variants?: { specValueName?: string; quantity?: number; newPrice?: number }[];
  relatedVariants?: {
    specValueName?: string;
    slug?: string;
    variantId?: number;
    isSelected?: boolean;
    hasStock?: boolean;
    price?: { newPrice?: number };
  }[];
}

/**
 * SneaksUp: https://www.sneaksup.com/<slug>-p-<variantId>
 *
 * Layer 1 reads the server-rendered `__NEXT_DATA__` product: the same fields
 * SNEAKSUP_PAGE_SCRIPT reads in the page, so size and color labels match.
 * `variants[]` is one row per size, `relatedVariants[]` one row per color
 * (its own page). Only the selected color has sizes and a photo; the others
 * omit `imageUrl` and the renderer lazily checks their `url`.
 */
export async function sneaksupApi(
  parsed: ParsedProduct,
): Promise<ProductStock | null> {
  const p = nextData(await fetchText(parsed.url, 8000, { Accept: "text/html" }))
    ?.props?.pageProps?.product as SneaksupProduct | undefined;
  if (!p?.productName || !p.variants?.length) return null;

  const sizes = p.variants
    .filter((v) => v.specValueName)
    .map((v) => ({
      label: String(v.specValueName).trim(),
      inStock: Number(v.quantity) > 0,
      ...(typeof v.newPrice === "number" ? { price: v.newPrice } : {}),
    }));
  // mediaType 1 = the gallery photos (the JSON-LD image); others are list shots.
  const imageUrl = p.pictures?.find((x) => x.mediaType === 1)?.url ?? null;
  const out: ProductStock = {
    name: p.productName,
    price: typeof p.price?.newPrice === "number" ? p.price.newPrice : null,
    currency: p.price?.currencyCode ?? "TRY",
    imageUrl,
    colors: [],
    sizes,
    inStock: sizes.some((s) => s.inStock),
  };

  const rel = p.relatedVariants ?? [];
  if (rel.length > 1) {
    // Colorways often share a name (4× "GRİ"): disambiguate with the slug's
    // last colorway code ("GRİ (044)"), else the variantId. Must stay
    // byte-identical to SNEAKSUP_PAGE_SCRIPT, or tracked colors drift.
    const named = rel.filter((r) => r.specValueName);
    const count = (arr: unknown[], v: unknown) =>
      arr.filter((x) => x === v).length;
    const names = named.map((r) => r.specValueName);
    let labels = named.map((r) => {
      if (count(names, r.specValueName) < 2) return String(r.specValueName);
      const m = /^.*-(\d{3})-[a-z0-9-]*-p-\d+$/i.exec(r.slug || "");
      return `${r.specValueName} (${m ? m[1] : r.variantId})`;
    });
    labels = labels.map((l, i) =>
      count(labels, l) < 2
        ? l
        : `${named[i].specValueName} (${named[i].variantId})`,
    );
    const origin = new URL(parsed.url).origin;
    out.colors = labels;
    out.colorVariants = named.map((r, i): ColorVariant => ({
      color: labels[i],
      url: `${origin}/${r.slug}`,
      ...(typeof r.price?.newPrice === "number"
        ? { price: r.price.newPrice }
        : {}),
      inStock: !!r.hasStock,
      ...(r.isSelected ? { imageUrl, sizes } : {}),
    }));
  }
  return out;
}
