import { BaseScraper } from "./base";
import { GRATIS_PAGE_SCRIPT } from "./page-script";
import type { ColorVariant, ParsedProduct, ProductStock } from "./types";

/** getProductDetail yanıtının kullanılan alt kümesi */
interface GratisDetail {
  product?: {
    stockStatus?: string;
    prices?: {
      currency?: string;
      discountedPrice?: number;
      normalPrice?: number;
    };
    imageUrls?: { fileUrl?: string }[];
    attributes?: { key?: string; value?: unknown }[];
  };
  variants?: {
    id?: string;
    color?: string;
    name?: string;
    shareLink?: string;
  }[];
}

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

  /**
   * Katman 1 — Gratis'in halka açık retter.io API'si (auth gerekmez):
   * `CALL/Product/getProductDetail/<id>`. Fiyatlar kuruş cinsindendir (/100);
   * JSON-LD'deki koşullu kampanya fiyatı yerine gerçek satış fiyatı
   * (`discountedPrice`) kullanılır. Kardeş varyantların gerçek fotoğrafı yalnız
   * kendi detay yanıtında olduğundan `colorVariants[].imageUrl` verilmez —
   * renderer renk seçilince varyant URL'ini `checkUrl` ile tembel çeker.
   */
  async fetchFromApi(parsed: ParsedProduct): Promise<ProductStock | null> {
    const data = (await this.fetchJson(
      `https://api.gratis.retter.io/1oakekr4e/CALL/Product/getProductDetail/${parsed.productId}`,
    )) as GratisDetail;
    const prod = data?.product;
    if (!prod || typeof prod !== "object") return null;

    const attrs = new Map(
      (prod.attributes ?? [])
        .filter((a) => a && typeof a.key === "string")
        .map((a) => [a.key as string, a.value]),
    );
    const variants = Array.isArray(data.variants) ? data.variants : [];
    const self = variants.find((v) => v?.id === parsed.productId);

    const displayName = attrs.get("displayName");
    const name =
      (typeof displayName === "string" && displayName.trim()) ||
      (self?.name ?? "").trim();
    if (!name) return null;

    const kurus =
      typeof prod.prices?.discountedPrice === "number"
        ? prod.prices.discountedPrice
        : typeof prod.prices?.normalPrice === "number"
          ? prod.prices.normalPrice
          : null;

    const colorVariants: ColorVariant[] = variants
      .map((v) => ({
        color: String(v?.color ?? "").trim(),
        url: v?.shareLink || null,
      }))
      .filter((v) => v.color);

    return {
      name,
      price: kurus != null ? kurus / 100 : null,
      currency: prod.prices?.currency ?? "TRY",
      imageUrl: prod.imageUrls?.[0]?.fileUrl ?? null,
      colors: colorVariants.map((v) => v.color),
      sizes: [],
      inStock:
        typeof prod.stockStatus === "string"
          ? prod.stockStatus.toUpperCase() !== "NONE"
          : false,
      ...(colorVariants.length ? { colorVariants } : {}),
    };
  }

  pageScript(): string {
    return GRATIS_PAGE_SCRIPT;
  }
}
