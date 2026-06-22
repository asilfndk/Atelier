import { BaseScraper } from "./base";
import { JSONLD_PAGE_SCRIPT } from "./page-script";
import type { ParsedProduct, ProductStock } from "./types";

/** Bershka: https://www.bershka.com/tr/...-c0p123456789.html */
export class BershkaScraper extends BaseScraper {
  readonly brand = "bershka" as const;

  canHandle(url: string): boolean {
    try {
      return new URL(url).hostname.includes("bershka.com");
    } catch {
      return false;
    }
  }

  parseUrl(url: string): ParsedProduct | null {
    try {
      const u = new URL(url);
      const m = u.pathname.match(/p(\d+)(?:\.html)?$/i);
      if (!m) return null;
      const parts = u.pathname.split("/").filter(Boolean);
      const locale = parts[0];
      return { brand: this.brand, productId: m[1], locale, url };
    } catch {
      return null;
    }
  }

  async fetchFromApi(parsed: ParsedProduct): Promise<ProductStock | null> {
    void parsed;
    return null;
  }

  pageScript(): string {
    return JSONLD_PAGE_SCRIPT;
  }
}
