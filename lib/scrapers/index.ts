import type { Brand } from "@/db/schema";
import type { BaseScraper } from "./base";
import { BershkaScraper } from "./bershka";
import { StradivariusScraper } from "./stradivarius";
import { ZaraScraper } from "./zara";
import type { ScrapeResult } from "./types";

const scrapers: BaseScraper[] = [
  new ZaraScraper(),
  new BershkaScraper(),
  new StradivariusScraper(),
];

/** URL'i işleyebilecek scraper'ı döndür (yoksa null) */
export function getScraperForUrl(url: string): BaseScraper | null {
  return scrapers.find((s) => s.canHandle(url)) ?? null;
}

/** Marka adından scraper döndür */
export function getScraperByBrand(brand: Brand): BaseScraper | null {
  return scrapers.find((s) => s.brand === brand) ?? null;
}

/**
 * Bir URL'i kontrol et. Desteklenmiyorsa anlamlı hata fırlatır.
 */
export async function checkUrl(url: string): Promise<ScrapeResult> {
  const scraper = getScraperForUrl(url);
  if (!scraper) {
    throw new Error(
      "Desteklenmeyen URL. Yalnızca Zara, Bershka ve Stradivarius ürün bağlantıları desteklenir.",
    );
  }
  return scraper.check(url);
}

export type { ScrapeResult } from "./types";
export { BaseScraper } from "./base";
