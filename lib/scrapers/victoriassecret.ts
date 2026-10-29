import { fetchText, meta, parseTrPrice } from "./base";
import type { ParsedProduct, ProductStock } from "./types";

/** The subset of Ticimax's `productDetailModel` that we use */
interface VsModel {
  productName?: string;
  products?: { satisFiyatiStr?: string; indirimliFiyatiStr?: string }[];
  productVariantData?: {
    tanim?: string;
    ekSecenekTipiTanim?: string;
    stokAdedi?: number;
  }[];
  productImages?: { bigImagePath?: string }[];
}

// Same leading size token as VICTORIASSECRET_PAGE_SCRIPT.
const TOKEN = /^(XXS|XS|S|M|L|XL|XXL|XXXL|[2-6]XL|\d{1,3}([.,]\d)?)/i;

/**
 * Victoria's Secret (Ticimax): https://www.victoriassecret.com.tr/<slug>-VS27291321
 *
 * Layer 1 reads the `var productDetailModel = {...};` the product page embeds
 * (the `.size_box` markup only exists after the page JS runs). Sizes come from
 * `productVariantData` with the page script's label rule; a label is in stock
 * when any of its rows has stock. Prices are the VAT-inclusive `*Str` values
 * (`satisFiyati` is pre-VAT); a "0,00 TL" discount price falls back to the
 * sale price. Sizeless items return null and stay on Layer 2.
 */
export async function victoriassecretApi(
  parsed: ParsedProduct,
): Promise<ProductStock | null> {
  const html = await fetchText(parsed.url, 8000, { Accept: "text/html" });
  const json = html.match(
    /var productDetailModel\s*=\s*(\{[\s\S]*?\});\s*globalModel/,
  )?.[1];
  if (!json) return null;
  const d = JSON.parse(json) as VsModel;
  const row = d.products?.[0];
  if (!d.productName || !row) return null;

  // Bras split into "Bant" + "Kap" rows per SKU; ORing a band across cups (or a
  // size across colors) would report stock nobody can buy. Those stay on Layer 2.
  const rows = d.productVariantData ?? [];
  if (rows.some((v) => v.ekSecenekTipiTanim !== "Beden")) return null;
  const stock = new Map<string, boolean>();
  for (const v of rows) {
    const label = (v.tanim ?? "").trim().match(TOKEN)?.[1].toUpperCase();
    if (label) stock.set(label, stock.get(label) || Number(v.stokAdedi) > 0);
  }
  if (!stock.size) return null;
  const sizes = [...stock].map(([label, inStock]) => ({ label, inStock }));

  return {
    name: d.productName,
    price:
      parseTrPrice(row.indirimliFiyatiStr) || parseTrPrice(row.satisFiyatiStr),
    currency: "TRY",
    imageUrl: d.productImages?.[0]?.bigImagePath || meta(html, "og:image"),
    colors: [],
    sizes,
    inStock: sizes.some((s) => s.inStock),
  };
}
