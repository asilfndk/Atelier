import type { ColorVariant, ProductStock } from "./types";

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
  basket_offers?: {
    listing_kwargs?: { quantity?: number; discounted_total_price?: number };
    client_types?: string[];
  }[];
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
 * Akinon stores (Barçın, Intersport, SPX, Fashfed): https://<store>/<slug>/?<color key>=<color>
 *
 * Parses Akinon's public JSON representation of the product page
 * (`?format=json`, no auth). It keeps the requested color; sibling colors
 * carry no sizes, so their `imageUrl` is omitted and the renderer lazily
 * checks their URL. Akinon can fall back to another color for sold-out
 * sizes — those are dropped so we never report that color's stock.
 * Layer 1 (akinonApi) and makeAkinonScript both run this, so it must stay
 * self-contained: no imports or outer helpers.
 */
export function akinonProduct(
  json: unknown,
  pageUrl: string,
  keys: AkinonKeys,
): ProductStock | null {
  const data = json as AkinonDetail;
  if (!data?.product?.name || !Array.isArray(data.variants)) return null;
  const endpoint = new URL(pageUrl);

  // "Sepette %20 İndirim": a basket campaign, listed only on the requested SKU as a
  // discounted total. Scale this color's prices by it; app-only offers (client_types) don't apply.
  // ponytail: assumes a percentage offer; a fixed-amount one is spread proportionally.
  const listPrice = Number(data.product.price);
  const basketPrice = Math.min(
    ...(data.product.basket_offers ?? [])
      .filter((o) => !o.client_types?.length)
      .map(
        (o) =>
          Number(o.listing_kwargs?.discounted_total_price) /
          (o.listing_kwargs?.quantity || 1),
      )
      .filter((n) => n > 0),
  );
  const ratio = basketPrice < listPrice ? basketPrice / listPrice : 1;
  const basket = (price: unknown) =>
    Math.round(Number(price) * ratio * 100) / 100 || null;

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
      price: soldOut ? null : basket(s.product?.price),
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
      price:
        c.value === selectedColor
          ? basket(c.product?.price)
          : Number(c.product?.price) || null,
      // With sizes, the flag is one SKU's: false doesn't mean the color is sold out.
      ...(c.in_stock === true || !sizeOptions.length
        ? { inStock: c.in_stock === true }
        : {}),
      ...(c.value === selectedColor ? { imageUrl, sizes } : {}),
    };
  });

  return {
    name: product.name ?? data.product.name,
    price: basket(product.price),
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
