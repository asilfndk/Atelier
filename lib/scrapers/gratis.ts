import { BaseScraper } from "./base";
import { GRATIS_PAGE_SCRIPT } from "./page-script";
import type { ParsedProduct, ProductStock } from "./types";

/** Gratis: https://www.gratis.com/ruj/love-generation-lipstick-balm-...-p-10209728 */
export class GratisScraper extends BaseScraper {
  readonly brand = "gratis" as const;

  canHandle(url: string): boolean {
    try {
      return new URL(url).hostname.includes("gratis.com");
    } catch {
      return false;
    }
  }

  parseUrl(url: string): ParsedProduct | null {
    try {
      const u = new URL(url);
      // .../<slug>-p-10209728 → ürün kodu son "-p-" segmentinde
      const m = u.pathname.match(/-p-(\d+)\/?$/);
      if (!m) return null;
      return { brand: this.brand, productId: m[1], url };
    } catch {
      return null;
    }
  }

  async fetchFromApi(parsed: ParsedProduct): Promise<ProductStock | null> {
    void parsed;
    return null;
  }

  pageScript(): string {
    return GRATIS_PAGE_SCRIPT;
  }
}
