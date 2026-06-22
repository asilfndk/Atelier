import { BaseScraper } from "./base";
import { WUNDER_PAGE_SCRIPT } from "./page-script";
import type { ParsedProduct, ProductStock } from "./types";

/** Wunder: https://wunder.com.tr/classic-england-polo-white-ubmw0502fa328-wth0001 */
export class WunderScraper extends BaseScraper {
  readonly brand = "wunder" as const;

  canHandle(url: string): boolean {
    try {
      return new URL(url).hostname.includes("wunder.com.tr");
    } catch {
      return false;
    }
  }

  parseUrl(url: string): ParsedProduct | null {
    try {
      const u = new URL(url);
      const slug = u.pathname.split("/").filter(Boolean).pop() ?? "";
      if (!slug) return null;
      return { brand: this.brand, productId: slug, url };
    } catch {
      return null;
    }
  }

  async fetchFromApi(parsed: ParsedProduct): Promise<ProductStock | null> {
    void parsed;
    return null;
  }

  pageScript(): string {
    return WUNDER_PAGE_SCRIPT;
  }
}
