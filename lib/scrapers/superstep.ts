import { fetchJson } from "./base";
import type { ParsedProduct, ProductStock } from "./types";

/** The subset of an Akinon product (`?format=json`) that we use */
interface SuperstepProduct {
  name?: string;
  price?: string | number;
  currency_type?: string;
  attributes?: { integration_renk?: string };
  productimage_set?: { image?: string }[];
}

interface SuperstepDetail {
  in_stock?: boolean;
  product?: SuperstepProduct;
  variants?: {
    attribute_key?: string;
    options?: {
      label?: string;
      in_stock?: boolean;
      product?: SuperstepProduct;
    }[];
  }[];
}

/**
 * Superstep (Akinon): https://www.superstep.com.tr/urun/<slug>/<code>/
 *
 * Layer 1 is Akinon's public `?format=json` (as in barcin.ts). Sizes come from
 * `integration_beden` (marketplace items: `mp_size`); Akinon fills sold-out
 * sizes with other colors' options, so only the page's own color is kept.
 * Each color is its own product here, so `colors` stays empty. Layer 2
 * (GENERIC) misses Superstep's sold-out styling and hyphenated labels (M-L).
 */
export async function superstepApi(
  parsed: ParsedProduct,
): Promise<ProductStock | null> {
  const endpoint = new URL(parsed.url);
  endpoint.searchParams.set("format", "json");
  const data = (await fetchJson(endpoint.href, 10000)) as SuperstepDetail;
  if (!data?.product?.name || !Array.isArray(data.variants)) return null;

  const color = data.product.attributes?.integration_renk;
  const group = data.variants.find(
    (v) =>
      v.attribute_key === "integration_beden" || v.attribute_key === "mp_size",
  );
  const sizes = (group?.options ?? [])
    .filter((o) => !color || o.product?.attributes?.integration_renk === color)
    .map((o) => ({ label: o.label ?? "", inStock: o.in_stock === true }));
  // A size group with none of this color's rows is a partial payload, not "sold out".
  if (group?.options?.length && !sizes.length) {
    throw new Error("Superstep size availability is missing");
  }

  return {
    name: data.product.name,
    price: Number(data.product.price) || null,
    currency: data.product.currency_type?.toUpperCase() ?? "TRY",
    imageUrl: data.product.productimage_set?.[0]?.image ?? null,
    colors: [],
    sizes,
    // Sizeless items (bags, socks packs) carry stock on the product itself.
    inStock: sizes.length
      ? sizes.some((s) => s.inStock)
      : data.in_stock === true,
  };
}
