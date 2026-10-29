import { fetchText, meta, nextData } from "./base";
import type { ParsedProduct, ProductStock } from "./types";

/** The subset of Ikas's `pageSpecificData` that we use */
interface IkasProduct {
  name?: string;
  variantTypes?: {
    variantType?: { values?: { id?: string; name?: string }[] };
  }[];
  variants?: {
    isActive?: boolean;
    stock?: number;
    variantValues?: { id?: string }[];
    prices?: {
      sellPrice?: number;
      discountPrice?: number | null;
      currencyCode?: string;
    }[];
  }[];
}

/**
 * Wunder (Ikas storefront): https://wunder.com.tr/<slug>
 *
 * Layer 1 reads the server-rendered `__NEXT_DATA__`: the size values (in page
 * order) and each size's variant stock. Sold-out sizes stay listed with
 * `inStock: false`, like the page script. Products with no size or with more
 * than one variant dimension return null and fall through to Layer 2.
 */
export async function wunderApi(
  parsed: ParsedProduct,
): Promise<ProductStock | null> {
  const html = await fetchText(parsed.url, 8000, { Accept: "text/html" });
  const d = nextData(html)?.props?.pageProps?.pageSpecificData as
    IkasProduct | undefined;
  if (!d?.name || d.variantTypes?.length !== 1) return null;

  const variants = d.variants ?? [];
  const sizes = (d.variantTypes[0].variantType?.values ?? []).map((val) => {
    const v = variants.find((x) => x.variantValues?.[0]?.id === val.id);
    return {
      label: String(val.name ?? "").trim(),
      inStock: !!v && v.isActive !== false && Number(v.stock) > 0,
    };
  });
  const p = variants[0]?.prices?.[0];
  return {
    name: d.name,
    price: p?.discountPrice ?? p?.sellPrice ?? null,
    currency: p?.currencyCode ?? "TRY",
    imageUrl: meta(html, "og:image"),
    colors: [],
    sizes,
    inStock: sizes.some((s) => s.inStock),
  };
}
