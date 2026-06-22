import type { Brand } from "@/db/schema";
import { scrapeWithBrowser } from "./browser";
import type { ParsedProduct, ProductStock, ScrapeResult } from "./types";

/** Tarayıcı gibi görünen ortak HTTP header'ları */
export const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
};

export abstract class BaseScraper {
  abstract readonly brand: Brand;

  /** Bu scraper verilen URL'i işleyebilir mi? */
  abstract canHandle(url: string): boolean;

  /** URL'den marka + productId çıkar (geçersizse null) */
  abstract parseUrl(url: string): ParsedProduct | null;

  /**
   * Katman 1 — markanın iç REST API'sinden stok çek.
   * Bot-engel/timeout/desteklenmiyor ise null döndür (browser'a düşülür).
   */
  abstract fetchFromApi(parsed: ParsedProduct): Promise<ProductStock | null>;

  /**
   * Katman 2 — sayfa içinde çalıştırılacak çıkarım scripti.
   * `return { name, price, currency, imageUrl, colors, sizes, inStock }` döndürmeli.
   */
  abstract pageScript(): string;

  /**
   * Ortak akış: önce iç API, başarısızsa gizli BrowserWindow.
   */
  async check(url: string): Promise<ScrapeResult> {
    const parsed = this.parseUrl(url);
    if (!parsed) {
      throw new Error(`URL bu marka için ayrıştırılamadı: ${url}`);
    }

    // Katman 1 — iç API
    try {
      const apiResult = await this.fetchFromApi(parsed);
      if (apiResult) {
        return { ...apiResult, source: "api" };
      }
    } catch (err) {
      console.warn(
        `[${this.brand}] iç API başarısız, tarayıcıya düşülüyor:`,
        err instanceof Error ? err.message : err,
      );
    }

    // Katman 2 — gizli BrowserWindow
    const browserResult = await scrapeWithBrowser(parsed.url, this.pageScript());
    return { ...browserResult, source: "browser" };
  }

  /** fetch + timeout yardımcı (iç API çağrıları için) */
  protected async fetchJson(
    url: string,
    timeoutMs = 8000,
    extraHeaders: Record<string, string> = {},
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { ...BROWSER_HEADERS, ...extraHeaders },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}
