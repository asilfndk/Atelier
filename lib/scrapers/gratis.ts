import { fetchJson } from "./base";
import type { ColorVariant, ParsedProduct, ProductStock } from "./types";

/** The subset of the getProductDetail response that we use */
interface GratisDetail {
  product?: {
    stockStatus?: string;
    prices?: {
      currency?: string;
      discountedPrice?: number;
      normalPrice?: number;
    };
    imageUrls?: { fileUrl?: string }[];
    attributes?: { key?: string; value?: unknown }[];
  };
  variants?: {
    id?: string;
    color?: string;
    name?: string;
    shareLink?: string;
  }[];
}

/**
 * Gratis: https://www.gratis.com/ruj/love-generation-lipstick-balm-...-p-10209728
 *
 * Layer 1 — Gratis's public retter.io API (no auth required):
 * `CALL/Product/getProductDetail/<id>`. Prices are in kurus, i.e. 1/100 TRY (/100);
 * the real sale price (`discountedPrice`) is used instead of the
 * conditional campaign price in JSON-LD. Sibling variants' real photos
 * only exist in their own detail responses, so `colorVariants[].imageUrl`
 * is omitted — the renderer lazily fetches the variant URL via `checkUrl`
 * when a color is selected.
 */
export async function gratisApi(
  parsed: ParsedProduct,
): Promise<ProductStock | null> {
  const data = (await fetchJson(
    `https://api.gratis.retter.io/1oakekr4e/CALL/Product/getProductDetail/${parsed.productId}`,
  )) as GratisDetail;
  const prod = data?.product;
  if (!prod || typeof prod !== "object") return null;

  const attrs = new Map(
    (prod.attributes ?? [])
      .filter((a) => a && typeof a.key === "string")
      .map((a) => [a.key as string, a.value]),
  );
  const variants = Array.isArray(data.variants) ? data.variants : [];
  const self = variants.find((v) => v?.id === parsed.productId);

  const displayName = attrs.get("displayName");
  const name =
    (typeof displayName === "string" && displayName.trim()) ||
    (self?.name ?? "").trim();
  if (!name) return null;

  const kurus =
    typeof prod.prices?.discountedPrice === "number"
      ? prod.prices.discountedPrice
      : typeof prod.prices?.normalPrice === "number"
        ? prod.prices.normalPrice
        : null;

  const colorVariants: ColorVariant[] = variants
    .map((v) => ({
      color: String(v?.color ?? "").trim(),
      url: v?.shareLink || null,
    }))
    .filter((v) => v.color);

  return {
    name,
    price: kurus != null ? kurus / 100 : null,
    currency: prod.prices?.currency ?? "TRY",
    imageUrl: prod.imageUrls?.[0]?.fileUrl ?? null,
    colors: colorVariants.map((v) => v.color),
    sizes: [],
    inStock:
      typeof prod.stockStatus === "string"
        ? prod.stockStatus.toUpperCase() !== "NONE"
        : false,
    ...(colorVariants.length ? { colorVariants } : {}),
  };
}
