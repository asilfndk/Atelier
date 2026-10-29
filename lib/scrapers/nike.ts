import { fetchJson, fetchText, nextData } from "./base";
import type { ColorVariant, ParsedProduct, ProductStock } from "./types";

/** The subset of a `__NEXT_DATA__` product that we use */
interface NikeProduct {
  styleColor?: string;
  colorDescription?: string;
  statusModifier?: string;
  pdpUrl?: { url?: string };
  prices?: { currentPrice?: number; currency?: string };
  productInfo?: { fullTitle?: string };
  contentImages?: { properties?: { squarish?: { url?: string } } }[];
  sizes?: {
    label?: string;
    localizedLabel?: string;
    gtins?: { gtin?: string }[];
  }[];
}

interface NikePageProps {
  selectedProduct?: NikeProduct;
  productGroups?: { products?: Record<string, NikeProduct> }[];
  locale?: { merchGroup?: string };
}

/**
 * Nike: https://www.nike.com/tr/t/<slug>/<styleColor>
 *
 * Layer 1 reads the server-rendered `__NEXT_DATA__` (every colorway's sizes,
 * GTINs, price and photo) and the public `available_gtins` API (one request
 * per colorway, in parallel; a GTIN missing from the response is out of
 * stock). `ACTIVE` in the page state only means a listed SKU. Layer 2 falls
 * back to the hydrated size inputs.
 */
export async function nikeApi(
  parsed: ParsedProduct,
): Promise<ProductStock | null> {
  const state = nextData(
    await fetchText(parsed.url, 8000, { Accept: "text/html" }),
  )?.props?.pageProps as NikePageProps | undefined;
  const selected = state?.selectedProduct;
  const name = selected?.productInfo?.fullTitle;
  if (!state || !selected?.styleColor || !name) return null;

  const products = (state.productGroups ?? []).flatMap((g) =>
    Object.values(g.products ?? {}),
  );
  if (!products.some((p) => p.styleColor === selected.styleColor)) {
    products.unshift(selected);
  }
  const merchGroup = state.locale?.merchGroup ?? "XP";

  const colorVariants: ColorVariant[] = await Promise.all(
    products.map(async (p) => {
      const data = (await fetchJson(
        `https://api.nike.com/deliver/available_gtins/v3?filter=styleColor(${p.styleColor})&filter=merchGroup(${merchGroup})`,
      ).catch((e) => {
        if (p.styleColor === selected.styleColor) throw e;
        return null;
      })) as { objects?: { gtin?: string; available?: boolean }[] } | null;
      const color = p.colorDescription || p.styleColor || "";
      const price = p.prices?.currentPrice ?? null;
      // A failed sibling keeps only its URL; the renderer lazily checks it.
      if (!data) return { color, url: p.pdpUrl?.url, price };
      const available = new Set(
        (data.objects ?? []).filter((o) => o.available).map((o) => o.gtin),
      );
      const soldOut = /SOLD_OUT|UNAVAILABLE/.test(p.statusModifier ?? "");
      const sizes = (p.sizes ?? []).map((s) => ({
        // "M Tall" → "M · Tall" (third dimension in the label)
        label: (s.localizedLabel || s.label || "").replace(
          /\s+(Tall|Short)$/i,
          " · $1",
        ),
        inStock: !soldOut && (s.gtins ?? []).some((g) => available.has(g.gtin)),
      }));
      const img = p.contentImages?.find((i) => i.properties?.squarish?.url)
        ?.properties?.squarish?.url;
      return {
        color,
        url: p.pdpUrl?.url,
        ...(img ? { imageUrl: img } : {}),
        sizes,
        price,
        inStock: sizes.some((s) => s.inStock),
      };
    }),
  );

  const active =
    colorVariants[
      products.findIndex((p) => p.styleColor === selected.styleColor)
    ];
  return {
    name,
    price: active.price ?? null,
    currency: selected.prices?.currency ?? "TRY",
    imageUrl: active.imageUrl ?? null,
    colors: colorVariants.map((v) => v.color),
    sizes: active.sizes ?? [],
    inStock: active.inStock === true,
    colorVariants,
  };
}
