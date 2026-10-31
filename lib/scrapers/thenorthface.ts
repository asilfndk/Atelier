import { fetchText } from "./base";
import type { ColorVariant, ParsedProduct, ProductStock } from "./types";

/** The Insider analytics object every product page sets inline */
interface InsiderProduct {
  id?: string;
  name?: string;
  currency?: string;
  unit_sale_price?: number;
  stock?: number;
  color?: string;
  product_image_url?: string;
}

interface SizeAttribute {
  Name?: string;
  Values?: { Name?: string; StockAvailability?: string | null }[];
}

interface SiblingColor {
  Url?: string;
  Sku?: string;
  Mpn?: string;
  StockAvailability?: boolean;
  ProductPrice?: { PriceValue?: number };
  SpecificationAttributeModels?: {
    SpecificationAttributeName?: string;
    ValueRaw?: string;
  }[];
}

/** The JSON assigned inline to `name`; each assignment ends its line */
function inlineJson(html: string, name: string): unknown {
  const json = html.match(
    new RegExp(`${name.replace(/\./g, "\\.")} = ([[{].*[\\]}]);\\s*$`, "m"),
  )?.[1];
  return json ? JSON.parse(json) : null;
}

/**
 * The North Face (GrandNode): https://www.thenorthface.com.tr/<slug>-<sku>
 *
 * Layer 1 reads the JSON inlined in the server-rendered page: the Insider
 * object (name, price, photo), the "Beden" attribute (each size's stock) and
 * `MergeProductByMpn` (the product's other colors, each its own page, without
 * the current one). Many products have no color name: the SKU minus the model
 * code stands in, as it also does when colorways share a name. Must stay in
 * step with THENORTHFACE_PAGE_SCRIPT, or tracked colors drift.
 */
export async function thenorthfaceApi(
  parsed: ParsedProduct,
): Promise<ProductStock | null> {
  const html = await fetchText(parsed.url, 8000, { Accept: "text/html" });
  const p = inlineJson(
    html,
    "window.insider_object.product",
  ) as InsiderProduct | null;
  if (!p?.name) return null;

  const attributes = (inlineJson(html, "this.ProductAttributes") ??
    []) as SizeAttribute[];
  const sizes = (attributes.find((a) => a.Name === "Beden")?.Values ?? []).map(
    (v) => ({
      label: String(v.Name ?? "").trim(),
      inStock: v.StockAvailability === "Stokta var",
    }),
  );
  const price = p.unit_sale_price ?? null;
  const imageUrl = p.product_image_url ?? null;

  const siblings = (inlineJson(html, "compare.mainProduct.MergeProductByMpn") ??
    []) as SiblingColor[];
  const code = (sku?: string) =>
    String(sku ?? "").slice(String(siblings[0]?.Mpn ?? "").length);
  const siblingName = (s: SiblingColor) =>
    (
      s.SpecificationAttributeModels?.find(
        (a) => a.SpecificationAttributeName === "Renk",
      )?.ValueRaw ?? ""
    ).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  const names = [p.color ?? "", ...siblings.map(siblingName)];
  const label = (name: string, sku?: string) =>
    !name || names.filter((n) => n === name).length > 1
      ? [name, code(sku)].filter(Boolean).join(" ")
      : name;
  const inStock = sizes.length
    ? sizes.some((s) => s.inStock)
    : Number(p.stock) > 0;

  const colorVariants: ColorVariant[] = siblings.length
    ? [
        {
          color: label(p.color ?? "", p.id),
          url: parsed.url,
          price,
          inStock,
          imageUrl,
          sizes,
        },
        ...siblings.map((s) => ({
          color: label(siblingName(s), s.Sku),
          url: s.Url,
          price: s.ProductPrice?.PriceValue ?? null,
          inStock: s.StockAvailability === true,
        })),
      ]
    : [];

  return {
    name: p.name,
    price,
    currency: p.currency ?? "TRY",
    imageUrl,
    colors: colorVariants.map((v) => v.color),
    sizes,
    inStock,
    ...(colorVariants.length ? { colorVariants } : {}),
  };
}
