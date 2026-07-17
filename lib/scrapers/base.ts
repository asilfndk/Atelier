import type { Brand } from "@/db/schema";
import { scrapeWithBrowser } from "./browser";
import type { ParsedProduct, ProductStock, ScrapeResult } from "./types";

/** Shared HTTP headers that make requests look like a browser */
export const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
};

/**
 * Resolve the image URL to an absolute https URL. Protocol-relative ("//host/x")
 * and root-relative ("/x") values are resolved against the product URL; in the
 * packaged app the renderer loads from a file:// origin, so raw values fail to load.
 */
function resolveImageUrl(
  imageUrl: string | null,
  baseUrl: string,
): string | null {
  if (!imageUrl) return null;
  try {
    const u = new URL(imageUrl, baseUrl);
    return u.protocol === "http:" || u.protocol === "https:"
      ? u.toString()
      : null;
  } catch {
    return null;
  }
}

export abstract class BaseScraper {
  abstract readonly brand: Brand;

  /** Can this scraper handle the given URL? */
  abstract canHandle(url: string): boolean;

  /** Extract brand + productId from the URL (null when invalid) */
  abstract parseUrl(url: string): ParsedProduct | null;

  /**
   * Layer 1 — fetch stock from the brand's internal REST API.
   * Return null on bot block/timeout/unsupported (falls back to the browser).
   */
  abstract fetchFromApi(parsed: ParsedProduct): Promise<ProductStock | null>;

  /**
   * Layer 2 — extraction script executed inside the page.
   * Must `return { name, price, currency, imageUrl, colors, sizes, inStock }`.
   */
  abstract pageScript(): string;

  /**
   * Shared flow: internal API first, hidden BrowserWindow on failure.
   */
  async check(url: string): Promise<ScrapeResult> {
    const parsed = this.parseUrl(url);
    if (!parsed) {
      throw new Error(`Could not parse the URL for this brand: ${url}`);
    }

    // Layer 1 — internal API
    try {
      const apiResult = await this.fetchFromApi(parsed);
      if (apiResult) {
        return {
          ...apiResult,
          imageUrl: resolveImageUrl(apiResult.imageUrl, parsed.url),
          source: "api",
        };
      }
    } catch (err) {
      console.warn(
        `[${this.brand}] internal API failed, falling back to browser:`,
        err instanceof Error ? err.message : err,
      );
    }

    // Layer 2 — hidden BrowserWindow
    const browserResult = await scrapeWithBrowser(
      parsed.url,
      this.pageScript(),
    );
    return {
      ...browserResult,
      imageUrl: resolveImageUrl(browserResult.imageUrl, parsed.url),
      source: "browser",
    };
  }

  /** fetch + timeout helper (for internal API calls) */
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
