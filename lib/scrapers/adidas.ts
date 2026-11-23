import type { ColorVariant, ProductStock } from "./types";

/** The subset of `/api/products/<id>` that we use */
interface AdidasProduct {
  id?: string;
  name?: string;
  attribute_list?: { color?: string };
  pricing_information?: {
    currentPrice?: number;
    sale_price?: number;
    standard_price?: number;
  };
  view_list?: { image_url?: string }[];
  variation_list?: { sku?: string; size?: string }[];
  product_link_list?: {
    type?: string;
    productId?: string;
    url?: string;
    image?: string;
    default_color?: string;
    search_color?: string;
    pricing_information?: { sale_price?: number; standard_price?: number };
  }[];
}

/** The subset of `/api/products/<id>/availability` that we use */
interface AdidasAvailability {
  availability_status?: string;
  variation_list?: { sku?: string; availability_status?: string }[];
}

/**
 * adidas: https://www.adidas.com.tr/tr/<slug>/<ID>.html
 *
 * The store's own two endpoints, the ones its product page calls: the
 * product (name, price, photo, sizes and the other colors, each its own page)
 * and its per-size availability. Both sit behind Akamai, which answers a Node
 * request with HTTP 403, so there is no Layer 1: ADIDAS_PAGE_SCRIPT serializes
 * this and calls them from inside the loaded page. It must stay
 * self-contained: no imports or outer helpers.
 */
export async function adidasProduct(
  pageUrl: string,
  get: (url: string) => Promise<unknown>,
): Promise<ProductStock | null> {
  const id = new URL(pageUrl).pathname.match(/\/([A-Z0-9]+)\.html$/i)?.[1];
  if (!id) return null;
  const origin = new URL(pageUrl).origin;
  const api = `${origin}/api/products/${id.toUpperCase()}`;
  const [product, availability] = (await Promise.all([
    get(api),
    get(`${api}/availability`),
  ])) as [AdidasProduct | null, AdidasAvailability | null];
  if (!product?.name) return null;

  const stock = new Map(
    (availability?.variation_list ?? []).map((v) => [
      v.sku,
      v.availability_status === "IN_STOCK",
    ]),
  );
  const sizes = (product.variation_list ?? []).map((v) => ({
    label: String(v.size ?? "").trim(),
    inStock: stock.get(v.sku) === true,
  }));
  const p = product.pricing_information ?? {};
  const price = p.currentPrice ?? p.sale_price ?? p.standard_price ?? null;
  const imageUrl = product.view_list?.[0]?.image_url ?? null;
  const inStock = sizes.length
    ? sizes.some((s) => s.inStock)
    : availability?.availability_status === "IN_STOCK";
  const color = String(product.attribute_list?.color ?? "").trim();

  // Each color is its own product page; their sizes are fetched lazily.
  const others = (product.product_link_list ?? [])
    .filter((l) => l.type === "color-variation" && l.url)
    .map((l) => ({
      id: String(l.productId ?? ""),
      color: String(l.default_color || l.search_color || l.productId || ""),
      url: new URL(String(l.url), origin).href,
      imageUrl: l.image ?? null,
      price:
        l.pricing_information?.sale_price ??
        l.pricing_information?.standard_price ??
        null,
    }))
    // Scraped links are untrusted: keep the store's own pages only.
    .filter((v) => v.color && new URL(v.url).origin === origin);
  const all = others.length
    ? [
        {
          id,
          color: color || id,
          url: pageUrl,
          imageUrl,
          sizes,
          price,
          inStock,
        },
        ...others,
      ]
    : [];
  // Colorways can share a name: add the article code, as the store shows it.
  const colorVariants: ColorVariant[] = all.map(({ id: code, ...v }) => ({
    ...v,
    color:
      all.filter((o) => o.color === v.color).length > 1
        ? `${v.color} (${code})`
        : v.color,
  }));

  return {
    name: product.name,
    price,
    currency: "TRY",
    imageUrl,
    colors: colorVariants.length
      ? colorVariants.map((v) => v.color)
      : [color].filter(Boolean),
    sizes,
    inStock,
    ...(colorVariants.length ? { colorVariants } : {}),
  };
}
