import { BaseScraper } from "./base";
import { SEPHORA_PAGE_SCRIPT } from "./page-script";
import type { ParsedProduct, ProductStock } from "./types";

/** Sephora TR: https://www.sephora.com.tr/p/<slug>-733611.html */
export class SephoraScraper extends BaseScraper {
  readonly brand = "sephora" as const;

  canHandle(url: string): boolean {
    try {
      return new URL(url).hostname.includes("sephora.com.tr");
    } catch {
      return false;
    }
  }

  parseUrl(url: string): ParsedProduct | null {
    try {
      const u = new URL(url);
      const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
      if (!last.endsWith(".html")) return null;
      const slug = last.replace(/\.html$/, "");
      // Slug kuyruğundaki 5+ haneli sayı ürün kodudur (örn. ...-733611)
      const m = slug.match(/-(\d{5,})$/);
      const productId = m ? m[1] : slug;
      if (!productId) return null;
      return { brand: this.brand, productId, url };
    } catch {
      return null;
    }
  }

  async fetchFromApi(parsed: ParsedProduct): Promise<ProductStock | null> {
    // Akamai istek katmanını engelliyor (403 edgesuite) — doğrudan Katman 2.
    void parsed;
    return null;
  }

  pageScript(): string {
    return SEPHORA_PAGE_SCRIPT;
  }
}
