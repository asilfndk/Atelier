import { BaseScraper } from "./base";
import type { Brand } from "@/db/schema";
import type { ParsedProduct, ProductStock } from "./types";

/**
 * Config-driven scraper for brands with no Layer-1 API: the per-brand
 * differences are just a hostname, a productId extraction rule and a page
 * script. Brands with a real `fetchFromApi` (Gratis) keep their own class.
 */
export interface SimpleScraperConfig {
  brand: Brand;
  /** Hostname substring that `canHandle` matches (e.g. "zara.com") */
  hostname: string;
  /** Layer-2 page script (from page-script.ts) */
  script: string;
  /** Extract productId (+ optional locale) from the URL; null = not a product page */
  parse: (u: URL) => { productId: string; locale?: string } | null;
}

class SimpleScraper extends BaseScraper {
  readonly brand: Brand;

  constructor(private readonly cfg: SimpleScraperConfig) {
    super();
    this.brand = cfg.brand;
  }

  canHandle(url: string): boolean {
    try {
      return new URL(url).hostname.includes(this.cfg.hostname);
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

  async fetchFromApi(parsed: ParsedProduct): Promise<ProductStock | null> {
    void parsed;
    return null;
  }

  pageScript(): string {
    return this.cfg.script;
  }
}

export function makeScraper(cfg: SimpleScraperConfig): BaseScraper {
  return new SimpleScraper(cfg);
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

/** Last path segment as the productId (slug sites: SneaksUp, Wunder). */
export function lastSegmentParse(u: URL): { productId: string } | null {
  const slug = u.pathname.split("/").filter(Boolean).pop();
  return slug ? { productId: slug } : null;
}
