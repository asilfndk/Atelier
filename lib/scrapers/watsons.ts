import { BaseScraper } from "./base";
import { GENERIC_PAGE_SCRIPT } from "./page-script";
import type { ParsedProduct, ProductStock } from "./types";

/** Watsons TR (SAP Hybris): https://www.watsons.com.tr/<slug>/p/BP_1376242 */
export class WatsonsScraper extends BaseScraper {
  readonly brand = "watsons" as const;

  canHandle(url: string): boolean {
    try {
      return new URL(url).hostname.includes("watsons.com.tr");
    } catch {
      return false;
    }
  }

  parseUrl(url: string): ParsedProduct | null {
    try {
      const u = new URL(url);
      // .../<slug>/p/BP_1376242 → /p/'den sonraki segment ürün kodu
      const m = u.pathname.match(/\/p\/([\w-]+)\/?$/);
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
    return GENERIC_PAGE_SCRIPT;
  }
}
