import { fetchJson } from "./base";
import type { ColorVariant, ParsedProduct, ProductStock } from "./types";

/** Which Akinon attributes a store uses; each store names them differently */
export interface AkinonKeys {
  /** Variant group of the colors; its value is also the color's URL parameter */
  color: string;
  /** Variant group of the sizes */
  size: string;
  /** Product attribute with the color's name (default: the option label) */
  colorName?: string;
  /** Product attribute with the size the page shows (default: the option label) */
  sizeName?: string;
}

/** The subset of an Akinon product (`?format=json`) that we use */
interface AkinonProduct {
  name?: string;
  price?: string | number;
  currency_type?: string;
  absolute_url?: string;
  attributes?: Record<string, string | undefined>;
  productimage_set?: { image?: string }[];
}

interface AkinonOption {
  label?: string;
  value?: string;
  in_stock?: boolean;
  product?: AkinonProduct;
}

interface AkinonDetail {
  product?: AkinonProduct;
  variants?: { attribute_key?: string; options?: AkinonOption[] }[];
}

/**
 * Akinon stores (Barçın, Intersport, SPX): https://<store>/<slug>/?<color key>=<color>
 *
 * Layer 1 is Akinon's public JSON representation of the product page
 * (`?format=json`, no auth). It keeps the requested color; sibling colors
 * carry no sizes, so their `imageUrl` is omitted and the renderer lazily
 * checks their URL. Akinon can fall back to another color for sold-out
 * sizes — those are dropped so we never report that color's stock.
 * The server is slow (2–7s), hence the longer timeout. Must stay in step
 * with makeAkinonScript, or tracked colors and sizes drift.
 */
export async function akinonApi(
  parsed: ParsedProduct,
  keys: AkinonKeys,
): Promise<ProductStock | null> {
  const endpoint = new URL(parsed.url);
  endpoint.searchParams.set("format", "json");
  const data = (await fetchJson(endpoint.href, 15000)) as AkinonDetail;
  if (!data?.product?.name || !Array.isArray(data.variants)) return null;

  const options = (key: string) =>
    data.variants?.find((v) => v.attribute_key === key)?.options ?? [];
  const colorOptions = options(keys.color);
  const selectedColor =
    endpoint.searchParams.get(keys.color) ||
    data.product.attributes?.[keys.color];
  const selectedOption = colorOptions.find((c) => c.value === selectedColor);
  if (selectedColor && colorOptions.length && !selectedOption) {
    throw new Error("Akinon requested color is missing");
  }
  const product = selectedOption?.product ?? data.product;

  const sizeOptions = options(keys.size);
  const ownSizes = sizeOptions.filter(
    (s) =>
      !selectedColor || s.product?.attributes?.[keys.color] === selectedColor,
  );
  // A fully sold-out color has only other colors' rows: keep them as sold-out
  // labels, so its restock is noticed. Otherwise no rows is a partial payload.
  const soldOut = !ownSizes.length && selectedOption?.in_stock === false;
  if (sizeOptions.length ? !ownSizes.length && !soldOut : !selectedOption) {
    throw new Error("Akinon size availability is missing");
  }
  const rows = soldOut ? sizeOptions : ownSizes;
  const sizes = rows
    // Intersport lists a placeholder row next to the real sizes; its page hides it.
    .filter((s) => rows.length < 2 || s.label !== "Standart")
    .map((s) => ({
      label:
        (keys.sizeName && s.product?.attributes?.[keys.sizeName]) ||
        (s.label ?? ""),
      inStock: !soldOut && s.in_stock === true,
      price: soldOut ? null : Number(s.product?.price) || null,
    }));
  const imageUrl = product.productimage_set?.[0]?.image ?? null;

  // Colorways can share a name: add the code, which is the same on every color's page.
  const colorName = (c: AkinonOption) =>
    (keys.colorName && c.product?.attributes?.[keys.colorName]) ||
    (c.label ?? "");
  const colorLabel = (c: AkinonOption) =>
    colorOptions.filter((o) => colorName(o) === colorName(c)).length > 1
      ? `${colorName(c)} (${c.value})`
      : colorName(c);
  // Requested color first: canonical paths may differ from the incoming slug.
  colorOptions.sort(
    (a, b) =>
      Number(b.value === selectedColor) - Number(a.value === selectedColor),
  );
  const colorVariants: ColorVariant[] = colorOptions.map((c) => {
    const url = new URL(c.product?.absolute_url ?? "", endpoint.origin);
    url.searchParams.set(keys.color, c.value ?? "");
    return {
      color: colorLabel(c),
      url: url.href,
      price: Number(c.product?.price) || null,
      // With sizes, the flag is one SKU's: false doesn't mean the color is sold out.
      ...(c.in_stock === true || !sizeOptions.length
        ? { inStock: c.in_stock === true }
        : {}),
      ...(c.value === selectedColor ? { imageUrl, sizes } : {}),
    };
  });

  return {
    name: product.name ?? data.product.name,
    price: Number(product.price) || null,
    currency: product.currency_type?.toUpperCase() ?? "TRY",
    imageUrl,
    colors: colorVariants.map((v) => v.color),
    sizes,
    // Sizeless items (sunglasses, bags) carry stock on the color's only SKU.
    inStock: sizes.length
      ? sizes.some((s) => s.inStock)
      : selectedOption?.in_stock === true,
    ...(colorVariants.length ? { colorVariants } : {}),
  };
}
