import { BaseScraper } from "./base";
import { GENERIC_PAGE_SCRIPT } from "./page-script";
import type { ColorVariant, ParsedProduct, ProductStock } from "./types";

/** The subset of Shopify's /products/<handle>.js response that we use */
interface ShopifyProduct {
  title?: string;
  price?: number;
  available?: boolean;
  options?: { name?: string; position?: number }[];
  variants?: {
    id?: number;
    option1?: string | null;
    option2?: string | null;
    option3?: string | null;
    available?: boolean;
    price?: number;
    featured_image?: { src?: string } | null;
  }[];
  images?: string[];
}

/** Shopify image URLs are protocol-relative ("//cdn.shopify.com/…") */
function absolutize(src: string | null | undefined): string | null {
  if (!src) return null;
  return src.startsWith("//") ? `https:${src}` : src;
}

/**
 * Les Benjamins (Shopify): https://lesbenjamins.com/collections/<cat>/products/<handle>
 *
 * Layer 1 is the real path: Shopify's public `/products/<handle>.js` endpoint
 * (no auth). Prices are in kurus (/100); the response carries no currency
 * field — the TR store sells in TRY. Variant `featured_image` is null across
 * the store today, so `colorVariants[].imageUrl` is omitted and the renderer
 * lazily fetches the variant URL when a color is selected. Layer 2 falls back
 * to the generic DOM script if the endpoint ever breaks.
 */
export class LesBenjaminsScraper extends BaseScraper {
  readonly brand = "lesbenjamins" as const;

  canHandle(url: string): boolean {
    try {
      return new URL(url).hostname.includes("lesbenjamins.com");
    } catch {
      return false;
    }
  }

  parseUrl(url: string): ParsedProduct | null {
    try {
      const u = new URL(url);
      // /products/<handle> anywhere in the path (also under /collections/<cat>/)
      const m = u.pathname.match(/\/products\/([\w-]+)/);
      if (!m) return null;
      return { brand: this.brand, productId: m[1], url };
    } catch {
      return null;
    }
  }

  async fetchFromApi(parsed: ParsedProduct): Promise<ProductStock | null> {
    const data = (await this.fetchJson(
      `https://lesbenjamins.com/products/${parsed.productId}.js`,
    )) as ShopifyProduct;
    if (!data || !Array.isArray(data.variants) || !data.variants.length) {
      return null;
    }

    const name = (data.title ?? "").trim();
    if (!name) return null;

    // Option positions vary per Shopify store — resolve by name, not index.
    const options = Array.isArray(data.options) ? data.options : [];
    const optIdx = (re: RegExp) =>
      options.findIndex((o) => re.test(String(o?.name ?? "")));
    const colorIdx = optIdx(/colou?r|renk/i);
    const sizeIdx = optIdx(/size|beden/i);
    const optValue = (
      v: NonNullable<ShopifyProduct["variants"]>[number],
      idx: number,
    ): string | null => {
      if (idx < 0) return null;
      const raw = [v.option1, v.option2, v.option3][idx];
      return typeof raw === "string" && raw.trim() ? raw.trim() : null;
    };

    const toSize = (v: NonNullable<ShopifyProduct["variants"]>[number]) => ({
      label: optValue(v, sizeIdx) ?? "O/S",
      inStock: v.available === true,
      price: typeof v.price === "number" ? v.price / 100 : null,
    });

    const baseUrl = new URL(parsed.url);
    const variantUrl = (id: number | undefined): string | undefined =>
      id != null
        ? `${baseUrl.origin}${baseUrl.pathname}?variant=${id}`
        : undefined;

    // Group variants by color → one ColorVariant per color.
    const colorVariants: ColorVariant[] = [];
    if (colorIdx >= 0) {
      const byColor = new Map<
        string,
        NonNullable<ShopifyProduct["variants"]>
      >();
      for (const v of data.variants) {
        const color = optValue(v, colorIdx);
        if (!color) continue;
        const list = byColor.get(color) ?? [];
        list.push(v);
        byColor.set(color, list);
      }
      for (const [color, list] of byColor) {
        const img = absolutize(
          list.find((v) => v.featured_image?.src)?.featured_image?.src,
        );
        colorVariants.push({
          color,
          url: variantUrl(list[0]?.id),
          ...(img ? { imageUrl: img } : {}),
          sizes: list.map(toSize),
          price: list[0]?.price != null ? list[0].price / 100 : undefined,
        });
      }
    }

    // Active color: match the ?variant= id in the checked URL, else first.
    const variantParam = baseUrl.searchParams.get("variant");
    let active = colorVariants[0];
    if (variantParam && colorIdx >= 0) {
      const av = data.variants.find((v) => String(v.id) === variantParam);
      const ac = av && optValue(av, colorIdx);
      active = colorVariants.find((cv) => cv.color === ac) ?? active;
    }
    const sizes = active?.sizes ?? data.variants.map(toSize);

    return {
      name,
      price: typeof data.price === "number" ? data.price / 100 : null,
      currency: "TRY",
      imageUrl: absolutize(data.images?.[0]),
      colors: colorVariants.map((cv) => cv.color),
      sizes,
      inStock: sizes.length
        ? sizes.some((s) => s.inStock)
        : data.available === true,
      ...(colorVariants.length ? { colorVariants } : {}),
    };
  }

  pageScript(): string {
    return GENERIC_PAGE_SCRIPT;
  }
}
