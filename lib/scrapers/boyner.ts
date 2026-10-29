import { fetchText, meta, nextData, parseTrPrice } from "./base";
import type { ParsedProduct, ProductStock } from "./types";

/** The subset of the RTK-Query `getProductDetail` cache entry that we use */
interface BoynerDetail {
  DisplayName?: string;
  PriceInfo?: { Price?: string };
  Medias?: { CoverUrl?: string }[];
  Variants?: { Name?: string; StockCount?: number }[];
}

/**
 * Boyner: https://www.boyner.com.tr/<slug>-p-15917358
 *
 * Layer 1 reads the RTK-Query cache in the SSR `__NEXT_DATA__`
 * (`dsListingDetailService.queries['getProductDetail({"productId":…})']`):
 * `Variants[].Name` is the bare size label the DOM shows, `StockCount > 0`
 * is in stock, `PriceInfo.Price` is a tr-TR string. A Cloudflare page has no
 * `__NEXT_DATA__`, so it returns null and Layer 2 reloads through it.
 */
export async function boynerApi(
  parsed: ParsedProduct,
): Promise<ProductStock | null> {
  const html = await fetchText(parsed.url, 8000, { Accept: "text/html" });
  const queries = nextData(html)?.props?.pageProps?.initialState
    ?.dsListingDetailService?.queries as
    Record<string, { data?: BoynerDetail }> | undefined;
  const d = Object.entries(queries ?? {}).find(([k]) =>
    k.startsWith("getProductDetail("),
  )?.[1]?.data;
  const name = d?.DisplayName?.trim();
  if (!d || !name) return null;

  const sizes = (d.Variants ?? []).map((v) => ({
    label: String(v.Name ?? "").trim(),
    inStock: Number(v.StockCount) > 0,
  }));
  // A one-size product has a single "Bedensiz" variant and no size picker.
  const oneSize = sizes.length === 1 && sizes[0].label === "Bedensiz";
  return {
    name,
    price: parseTrPrice(d.PriceInfo?.Price),
    currency: "TRY",
    imageUrl: d.Medias?.[0]?.CoverUrl ?? meta(html, "og:image"),
    colors: [],
    sizes: oneSize ? [] : sizes,
    inStock: sizes.some((s) => s.inStock),
  };
}
