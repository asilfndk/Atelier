import type { Brand } from "@/db/schema";
import { resolveImageUrl } from "./base";
import { normalizeRaw, scrapeWithBrowser } from "./browser";
import {
  productStockSchema,
  type ParsedProduct,
  type ProductStock,
  type ScrapeResult,
} from "./types";

/**
 * Config-driven scraper: the per-brand differences are a hostname, a
 * productId extraction rule, a Layer-2 page script and, for brands with an
 * internal API (Gratis, Nike…), an optional Layer-1 `api` function.
 */
export interface ScraperConfig {
  brand: Brand;
  /** Hostname `canHandle` matches exactly or as a subdomain (e.g. "zara.com") */
  hostname: string;
  /** Layer-2 page script (from page-script.ts) */
  script: string;
  /** Extract productId (+ optional locale) from the URL; null = not a product page */
  parse: (u: URL) => { productId: string; locale?: string } | null;
  /** Layer 1 — the store's internal API; null on bot block/unsupported falls through to the browser */
  api?: (parsed: ParsedProduct) => Promise<ProductStock | null>;
  /** In-page JS expression, truthy once the page is ready to scrape (default: JSON-LD present) */
  ready?: string;
}

/** Make relative images absolute (the packaged renderer runs on file://) and tag the layer */
function finish(
  r: ProductStock,
  base: string,
  source: ScrapeResult["source"],
): ScrapeResult {
  return {
    ...r,
    imageUrl: resolveImageUrl(r.imageUrl, base),
    colorVariants: r.colorVariants?.map((c) =>
      c.imageUrl ? { ...c, imageUrl: resolveImageUrl(c.imageUrl, base) } : c,
    ),
    source,
  };
}

export class Scraper {
  readonly brand: Brand;
  readonly script: string;

  constructor(private readonly cfg: ScraperConfig) {
    this.brand = cfg.brand;
    this.script = cfg.script;
  }

  get hasApi(): boolean {
    return !!this.cfg.api;
  }

  canHandle(url: string): boolean {
    try {
      const h = new URL(url).hostname;
      return h === this.cfg.hostname || h.endsWith("." + this.cfg.hostname);
    } catch {
      return false;
    }
  }

  parseUrl(url: string): ParsedProduct | null {
    try {
      const p = this.cfg.parse(new URL(url));
      if (!p || !p.productId) return null;
      return {
        brand: this.brand,
        productId: p.productId,
        ...(p.locale !== undefined ? { locale: p.locale } : {}),
        url,
      };
    } catch {
      return null;
    }
  }

  /** Layer 1 (internal API, schema-checked) first, hidden BrowserWindow on failure. */
  async check(url: string, interactive = false): Promise<ScrapeResult> {
    const parsed = this.parseUrl(url);
    if (!parsed) {
      throw new Error(`Could not parse the URL for this brand: ${url}`);
    }

    if (this.cfg.api) {
      try {
        const r = await this.cfg.api(parsed);
        if (r) {
          const v = productStockSchema.safeParse(normalizeRaw(r));
          if (!v.success) {
            throw new Error(
              `API data does not match the schema: ${v.error.message}`,
            );
          }
          return finish(v.data, parsed.url, "api");
        }
      } catch (err) {
        console.warn(
          `[${this.brand}] internal API failed, falling back to browser:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    return finish(
      await scrapeWithBrowser(parsed.url, this.cfg.script, {
        interactive,
        ready: this.cfg.ready,
      }),
      parsed.url,
      "browser",
    );
  }
}

export function makeScraper(cfg: ScraperConfig): Scraper {
  return new Scraper(cfg);
}

/**
 * Trailing product-code parse for Inditex URLs, e.g. ...-p747880059.html or
 * ...-l03671509. Pass the brand's own pattern: Zara/Bershka accept only
 * `p<id>` (a `[lp]` superset would swallow their `l<id>` LISTING urls);
 * Stradivarius/P&B/Lefties accept both.
 */
export function inditexParse(
  u: URL,
  pattern: RegExp,
  localeSegments = 1,
): { productId: string; locale?: string } | null {
  const m = u.pathname.match(pattern);
  if (!m) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  const locale =
    parts.length >= localeSegments
      ? parts.slice(0, localeSegments).join("/")
      : undefined;
  return { productId: m[1], locale };
}

/** Last path segment as the productId (slug sites: SneaksUp, Wunder, Sportinn). */
export function lastSegmentParse(u: URL): { productId: string } | null {
  const slug = u.pathname.split("/").filter(Boolean).pop();
  return slug ? { productId: slug } : null;
}
