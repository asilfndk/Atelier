import type { Brand } from "@/db/schema";
import type { BaseScraper } from "./base";
import { GratisScraper } from "./gratis";
import { inditexParse, lastSegmentParse, makeScraper } from "./simple";
import {
  BERSHKA_PAGE_SCRIPT,
  BOYNER_PAGE_SCRIPT,
  GENERIC_PAGE_SCRIPT,
  JSONLD_PAGE_SCRIPT,
  LEFTIES_PAGE_SCRIPT,
  MANGO_PAGE_SCRIPT,
  PULLANDBEAR_PAGE_SCRIPT,
  SEPHORA_PAGE_SCRIPT,
  SNEAKSUP_PAGE_SCRIPT,
  VICTORIASSECRET_PAGE_SCRIPT,
  WUNDER_PAGE_SCRIPT,
  ZARA_PAGE_SCRIPT,
} from "./page-script";
import type { ScrapeResult } from "./types";

// Only the p-code is a product for Zara/Bershka (l-codes are listings);
// the newer platforms use l/p interchangeably.
const P_CODE = /p(\d+)(?:\.html)?$/i;
const LP_CODE = /[lp](\d+)(?:\.html)?$/i;

const scrapers: BaseScraper[] = [
  makeScraper({
    brand: "zara",
    hostname: "zara.com",
    script: ZARA_PAGE_SCRIPT,
    // locale: /tr/tr/... → "tr/tr"
    parse: (u) => inditexParse(u, P_CODE, 2),
  }),
  makeScraper({
    brand: "bershka",
    hostname: "bershka.com",
    script: BERSHKA_PAGE_SCRIPT,
    parse: (u) => inditexParse(u, P_CODE),
  }),
  makeScraper({
    brand: "stradivarius",
    hostname: "stradivarius.com",
    script: JSONLD_PAGE_SCRIPT,
    parse: (u) => inditexParse(u, LP_CODE),
  }),
  makeScraper({
    brand: "pullandbear",
    hostname: "pullandbear.com",
    script: PULLANDBEAR_PAGE_SCRIPT,
    parse: (u) => inditexParse(u, LP_CODE),
  }),
  makeScraper({
    brand: "lefties",
    hostname: "lefties.com",
    script: LEFTIES_PAGE_SCRIPT,
    parse: (u) => inditexParse(u, LP_CODE),
  }),
  makeScraper({
    brand: "sneaksup",
    hostname: "sneaksup.com",
    script: SNEAKSUP_PAGE_SCRIPT,
    parse: lastSegmentParse,
  }),
  makeScraper({
    brand: "tommy",
    hostname: "tommy.com",
    script: GENERIC_PAGE_SCRIPT,
    // ...erkek-hirka_206739 → 206739; otherwise the slug itself.
    parse: (u) => {
      const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
      const m = last.match(/_(\d+)$/);
      const productId = m ? m[1] : last;
      return productId ? { productId } : null;
    },
  }),
  makeScraper({
    brand: "victoriassecret",
    hostname: "victoriassecret.com.tr",
    script: VICTORIASSECRET_PAGE_SCRIPT,
    // ...-VS27291321 → VS27291321; otherwise the slug.
    parse: (u) => {
      const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
      const m = last.match(/-(VS\d+)$/i);
      const productId = m ? m[1] : last;
      return productId ? { productId } : null;
    },
  }),
  makeScraper({
    brand: "boyner",
    hostname: "boyner.com.tr",
    script: BOYNER_PAGE_SCRIPT,
    // ...-p-15917358 → 15917358
    parse: (u) => {
      const m = u.pathname.match(/-p-(\d+)/i);
      const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
      const productId = m ? m[1] : last;
      return productId ? { productId } : null;
    },
  }),
  makeScraper({
    brand: "wunder",
    hostname: "wunder.com.tr",
    script: WUNDER_PAGE_SCRIPT,
    parse: lastSegmentParse,
  }),
  makeScraper({
    brand: "superstep",
    hostname: "superstep.com.tr",
    script: GENERIC_PAGE_SCRIPT,
    // /urun/<slug>/<code>/ → product code (e.g. ki6678); otherwise the last segment.
    parse: (u) => {
      const parts = u.pathname.split("/").filter(Boolean);
      const idx = parts.indexOf("urun");
      const productId =
        (idx >= 0 && parts.length > idx + 2
          ? parts[idx + 2]
          : parts[parts.length - 1]) ?? "";
      return productId ? { productId } : null;
    },
  }),
  makeScraper({
    brand: "mango",
    hostname: "shop.mango.com",
    script: MANGO_PAGE_SCRIPT,
    // /tr/tr/p/.../27045166/99/00 → first 6+ digit segment is the product code
    parse: (u) => {
      const parts = u.pathname.split("/").filter(Boolean);
      const productId =
        parts.find((s) => /^\d{6,}$/.test(s)) ?? parts.pop() ?? "";
      return productId ? { productId } : null;
    },
  }),
  makeScraper({
    brand: "sephora",
    hostname: "sephora.com.tr",
    script: SEPHORA_PAGE_SCRIPT,
    // The 5+ digit number at the slug tail is the product code (e.g. ...-733611)
    parse: (u) => {
      const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
      if (!last.endsWith(".html")) return null;
      const slug = last.replace(/\.html$/, "");
      const m = slug.match(/-(\d{5,})$/);
      return { productId: m ? m[1] : slug };
    },
  }),
  new GratisScraper(),
  makeScraper({
    brand: "watsons",
    hostname: "watsons.com.tr",
    script: GENERIC_PAGE_SCRIPT,
    // .../<slug>/p/BP_1376242 → the segment after /p/ is the product code
    parse: (u) => {
      const m = u.pathname.match(/\/p\/([\w-]+)\/?$/);
      return m ? { productId: m[1] } : null;
    },
  }),
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
