import type { ColorVariant, ProductStock } from "./types";

/** One option of a Magento configurable attribute (color or size) */
interface PumaOption {
  label?: string;
  /** Simple products of this option that are in stock */
  products?: string[];
  /** Every simple product of this option, sold out included */
  all_products?: string[];
}

/** The subset of Magento's `spConfig` that we use */
interface PumaConfig {
  attributes?: Record<string, { code?: string; options?: PumaOption[] }>;
  optionPrices?: Record<string, { finalPrice?: { amount?: number } }>;
  images?: Record<string, { img?: string }[]>;
}

/**
 * Puma: https://tr.puma.com/<slug>-<model>-<color code>.html
 *
 * A Magento store: the server-rendered page carries the configurable
 * product's `spConfig` (every color × size as a simple product, each listed
 * as in stock or sold out, with its price and photos) inside a
 * `text/x-magento-init` script, which the page removes once it runs, so
 * Layer 2 refetches the page too. Each color has its own page; the color
 * code in the URL picks this page's color.
 * Layer 1 and PUMA_PAGE_SCRIPT both run this, so it must stay
 * self-contained: no imports or outer helpers.
 */
export function pumaProduct(
  html: string,
  pageUrl: string,
): ProductStock | null {
  /** The JSON value that starts at `html[start]`, read up to its closing brace */
  const jsonAt = (start: number): unknown => {
    let depth = 0;
    let inString = false;
    for (let i = start; i < html.length; i++) {
      const c = html[i];
      if (inString) {
        if (c === "\\") i++;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        return JSON.parse(html.slice(start, i + 1));
      }
    }
    return null;
  };
  const after = (marker: string): unknown => {
    const i = html.indexOf(marker);
    if (i < 0) return null;
    const start = html.indexOf("{", i + marker.length);
    try {
      return start < 0 ? null : jsonAt(start);
    } catch {
      return null;
    }
  };

  let ld: {
    name?: string;
    sku?: string;
    offers?: { price?: string | number; availability?: string };
  } | null = null;
  for (const m of html.matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
  )) {
    try {
      const node = JSON.parse(m[1]);
      if (node?.["@type"] === "Product") ld = node;
    } catch {
      // Not every block is valid JSON; the product block is.
    }
  }
  if (!ld?.name) return null;
  const name = ld.name;
  const origin = new URL(pageUrl).origin;
  const codeMatch = new URL(pageUrl).pathname.match(/-(\d{6})-(\d{2})\.html$/);
  const ownCode = codeMatch ? `${codeMatch[1]}_${codeMatch[2]}` : ld.sku;

  const config = after('"spConfig":') as PumaConfig | null;
  const attributes = Object.values(config?.attributes ?? {});
  const colorAttr = attributes.find((a) => a.code === "color");
  const sizeAttr = attributes.find((a) => a.code === "size");
  if (!config || !colorAttr) {
    // A product without colors or sizes: the JSON-LD offer is all there is.
    const price = Number(ld.offers?.price) || null;
    return {
      name,
      price,
      currency: "TRY",
      imageUrl: null,
      colors: [],
      sizes: [],
      inStock: /InStock/i.test(ld.offers?.availability ?? ""),
    };
  }

  // The analytics map keys each color's style code ("090697_01") to its name.
  // ponytail: a color with neither a photo nor an analytics entry gets no URL, so it can't be tracked on its own.
  const analytics = (after("setProduct(") ?? {}) as Record<
    string,
    { items?: { color?: string }[] }
  >;
  const codeOf = (option: PumaOption): string | undefined => {
    for (const p of option.all_products ?? []) {
      const m = config.images?.[p]?.[0]?.img?.match(
        /\/images\/(\d{6})\/(\d{2})\//,
      );
      if (m) return `${m[1]}_${m[2]}`;
    }
    const label = (option.label ?? "").toLowerCase();
    return Object.keys(analytics).find(
      (code) => analytics[code]?.items?.[0]?.color?.toLowerCase() === label,
    );
  };

  // Options with no products belong to other models of the same group.
  const variants = (colorAttr.options ?? [])
    .filter((o) => o.all_products?.length)
    .map((option) => {
      const all = new Set(option.all_products);
      const inStockIds = new Set(option.products);
      const sizes = (sizeAttr?.options ?? [])
        .filter((s) => (s.all_products ?? []).some((p) => all.has(p)))
        .map((s) => ({
          // ponytail: labels stay as the store writes them ("39-42 (39/42)").
          label: String(s.label ?? "").trim(),
          inStock: (s.products ?? []).some((p) => inStockIds.has(p)),
        }));
      const ids = [...inStockIds, ...all];
      const price =
        ids
          .map((p) => config.optionPrices?.[p]?.finalPrice?.amount)
          .find((a) => typeof a === "number") ?? null;
      const imageUrl =
        ids.map((p) => config.images?.[p]?.[0]?.img).find(Boolean) ?? null;
      const code = codeOf(option);
      return {
        code,
        variant: {
          color: String(option.label ?? "").trim(),
          // Same slug, this color's code; the query (a pinned size) is dropped.
          url:
            code && codeMatch
              ? `${origin}${new URL(pageUrl).pathname.replace(
                  /-\d{6}-\d{2}\.html$/,
                  `-${code.replace("_", "-")}.html`,
                )}`
              : null,
          imageUrl,
          sizes,
          price,
          inStock: inStockIds.size > 0,
        } satisfies ColorVariant,
      };
    });
  if (!variants.length) return null;
  const own = variants.find((v) => v.code === ownCode) ?? variants[0];
  // This page's own URL, so a pinned size or query string is kept.
  own.variant.url = pageUrl;
  const colorVariants = [own, ...variants.filter((v) => v !== own)].map(
    (v) => v.variant,
  );
  const active = own.variant;
  const sizes = active.sizes;

  return {
    name,
    price: active.price ?? (Number(ld.offers?.price) || null),
    currency: "TRY",
    imageUrl: active.imageUrl,
    colors: colorVariants.map((v) => v.color),
    sizes,
    inStock: active.inStock,
    ...(colorVariants.length > 1 ? { colorVariants } : {}),
  };
}
