import type { Brand } from "@/db/schema";
import type { BaseScraper } from "./base";
import { BershkaScraper } from "./bershka";
import { StradivariusScraper } from "./stradivarius";
import { PullandbearScraper } from "./pullandbear";
import { ZaraScraper } from "./zara";
import { SneaksupScraper } from "./sneaksup";
import { TommyScraper } from "./tommy";
import { VictoriassecretScraper } from "./victoriassecret";
import { BoynerScraper } from "./boyner";
import { WunderScraper } from "./wunder";
import { SuperstepScraper } from "./superstep";
import { MangoScraper } from "./mango";
import { SephoraScraper } from "./sephora";
import { GratisScraper } from "./gratis";
import { WatsonsScraper } from "./watsons";
import type { ScrapeResult } from "./types";

const scrapers: BaseScraper[] = [
  new ZaraScraper(),
  new BershkaScraper(),
  new StradivariusScraper(),
  new PullandbearScraper(),
  new SneaksupScraper(),
  new TommyScraper(),
  new VictoriassecretScraper(),
  new BoynerScraper(),
  new WunderScraper(),
  new SuperstepScraper(),
  new MangoScraper(),
  new SephoraScraper(),
  new GratisScraper(),
  new WatsonsScraper(),
];

/** Return the scraper that can handle the URL (null if none) */
export function getScraperForUrl(url: string): BaseScraper | null {
  return scrapers.find((s) => s.canHandle(url)) ?? null;
}

/** Return the scraper for a brand name */
export function getScraperByBrand(brand: Brand): BaseScraper | null {
  return scrapers.find((s) => s.brand === brand) ?? null;
}

/**
 * Check a URL. Throws a meaningful error when unsupported.
 */
export async function checkUrl(url: string): Promise<ScrapeResult> {
  const scraper = getScraperForUrl(url);
  if (!scraper) {
    throw new Error(
      "This link isn't supported. Paste a product link from one of the supported stores.",
    );
  }
  return scraper.check(url);
}

export type { ScrapeResult } from "./types";
export { BaseScraper } from "./base";
