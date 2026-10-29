import { fetchText, meta, parseTrPrice } from "./base";
import type { ParsedProduct, ProductStock } from "./types";

/** `&#199;` → `Ç`, `&amp;` → `&` (og:title is entity-encoded) */
const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");

/**
 * Tommy Hilfiger: https://tr.tommy.com/<slug>_<id>
 *
 * Layer 1 reads the server-rendered page: name, price and image from meta
 * tags, sizes from the `data-js="size-item"` anchors, whose `data-stock` is the
 * per-size stock count (0 = sold out, class `no-stock`). The page renders no
 * other colors, so `colors` stays empty as in Layer 2.
 * ponytail: the jeans length (`data-js="drop-item"`, "Boy") is ignored, as in
 * Layer 2; encode it as "28 · 30" once its per-combination stock is known.
 */
export async function tommyApi(
  parsed: ParsedProduct,
): Promise<ProductStock | null> {
  const html = await fetchText(parsed.url, 8000, { Accept: "text/html" });
  const name = meta(html, "og:title");
  const seen = new Set<string>();
  const sizes = [
    ...html.matchAll(/<a\b([^>]*data-js="size-item"[^>]*)>([^<]*)<\/a>/g),
  ]
    .map((m) => ({
      label: decode(m[2].trim()),
      inStock: Number(/data-stock="(\d+)"/.exec(m[1])?.[1] ?? 0) > 0,
    }))
    .filter((s) => s.label && !seen.has(s.label) && seen.add(s.label));
  if (!name || !sizes.length) return null;

  return {
    name: decode(name),
    price: parseTrPrice(meta(html, "price")),
    currency: meta(html, "priceCurrency") ?? "TRY",
    imageUrl: meta(html, "og:image"),
    colors: [],
    sizes,
    inStock: sizes.some((s) => s.inStock),
  };
}
