import { BaseScraper } from "./base";
import { PULLANDBEAR_PAGE_SCRIPT } from "./page-script";
import type { ParsedProduct, ProductStock } from "./types";

/** Pull & Bear: https://www.pullandbear.com/tr/...-l03671509?cS=717 */
export class PullandbearScraper extends BaseScraper {
  readonly brand = "pullandbear" as const;

  canHandle(url: string): boolean {
    try {
      return new URL(url).hostname.includes("pullandbear.com");
    } catch {
      return false;
    }
  }

  parseUrl(url: string): ParsedProduct | null {
    try {
      const u = new URL(url);
      const m = u.pathname.match(/[lp](\d+)(?:\.html)?$/i);
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
    return PULLANDBEAR_PAGE_SCRIPT;
  }
}
