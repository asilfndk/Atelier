import { fetchJson } from "./base";
import type { ColorVariant, ParsedProduct, ProductStock } from "./types";

/** The subset of an Akinon product (`?format=json`) that we use */
interface AkinonProduct {
  name?: string;
  price?: string | number;
  currency_type?: string;
  absolute_url?: string;
  attributes?: { integration_color_hash?: string };
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
 * Barçın (Akinon): https://www.barcin.com/<slug>/?integration_color_hash=<color>
 *
 * Layer 1 is Akinon's public JSON representation of the product page
 * (`?format=json`, no auth). It keeps the requested color; sibling colors
 * carry no sizes, so their `imageUrl` is omitted and the renderer lazily
 * checks their URL. Akinon can fall back to another color for sold-out
 * sizes — those are dropped so we never report that color's stock.
 * The server is slow (2–7s), hence the longer timeout.
 */
export async function barcinApi(
  parsed: ParsedProduct,
): Promise<ProductStock | null> {
  const endpoint = new URL(parsed.url);
  endpoint.searchParams.set("format", "json");
  const data = (await fetchJson(endpoint.href, 15000)) as AkinonDetail;
  if (!data?.product?.name || !Array.isArray(data.variants)) return null;

  const options = (key: string) =>
    data.variants?.find((v) => v.attribute_key === key)?.options ?? [];
  const colorOptions = options("integration_color_hash");
  const selectedColor =
    endpoint.searchParams.get("integration_color_hash") ||
    data.product.attributes?.integration_color_hash;
  const selectedOption = colorOptions.find((c) => c.value === selectedColor);
  if (selectedColor && colorOptions.length && !selectedOption) {
    throw new Error("Barçın requested color is missing");
  }
  const product = selectedOption?.product ?? data.product;

  const sizes = options("integration_size")
    .filter(
      (s) =>
        !selectedColor ||
        s.product?.attributes?.integration_color_hash === selectedColor,
    )
    .map((s) => ({
      label: s.label ?? "",
      inStock: s.in_stock === true,
      price: Number(s.product?.price) || null,
    }));
  // No size rows (partial payload, color filter mismatch) is not "sold out".
  if (!sizes.length) throw new Error("Barçın size availability is missing");
  const imageUrl = product.productimage_set?.[0]?.image ?? null;

  // Requested color first: canonical paths may differ from the incoming slug.
  colorOptions.sort(
    (a, b) =>
      Number(b.value === selectedColor) - Number(a.value === selectedColor),
  );
  const colorVariants: ColorVariant[] = colorOptions.map((c) => {
    const url = new URL(c.product?.absolute_url ?? "", endpoint.origin);
    url.searchParams.set("integration_color_hash", c.value ?? "");
    return {
      color: c.label ?? "",
      url: url.href,
      price: Number(c.product?.price) || null,
      inStock: c.in_stock === true,
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
    inStock: sizes.some((s) => s.inStock),
    ...(colorVariants.length ? { colorVariants } : {}),
  };
}
