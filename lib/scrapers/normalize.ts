import { parseTrPrice } from "./base.ts";

/** Normalizes raw scraper data (both layers) into ProductStock */
export function normalizeRaw(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "__error" in raw) {
    throw new Error(
      `In-page extraction error: ${(raw as { __error: string }).__error}`,
    );
  }
  const r = (raw ?? {}) as Record<string, unknown>;
  const toNumber = (v: unknown): number | null =>
    typeof v === "number" || typeof v === "string" ? parseTrPrice(v) : null;
  const normalizeSizes = (v: unknown) =>
    Array.isArray(v)
      ? v.map((s) => {
          const so = (s ?? {}) as Record<string, unknown>;
          const price = toNumber(so.price);
          return {
            label: String(so.label ?? so.size ?? so.name ?? ""),
            inStock: Boolean(
              so.inStock ?? so.available ?? so.isAvailable ?? false,
            ),
            ...(price != null ? { price } : {}),
          };
        })
      : [];
  const sizes = normalizeSizes(r.sizes);
  const colors = Array.isArray(r.colors) ? r.colors.map(String) : [];
  const colorVariants = Array.isArray(r.colorVariants)
    ? r.colorVariants
        .map((v) => {
          const vo = (v ?? {}) as Record<string, unknown>;
          const price = toNumber(vo.price);
          const vSizes = normalizeSizes(vo.sizes);
          return {
            color: String(vo.color ?? ""),
            url: vo.url ? String(vo.url) : null,
            imageUrl: vo.imageUrl ? String(vo.imageUrl) : null,
            ...(vSizes.length ? { sizes: vSizes } : {}),
            ...(price != null ? { price } : {}),
            ...(typeof vo.inStock === "boolean" ? { inStock: vo.inStock } : {}),
          };
        })
        .filter((v) => v.color)
    : [];
  return {
    name: String(r.name ?? "Untitled item"),
    price: toNumber(r.price),
    currency: r.currency ? String(r.currency) : null,
    imageUrl: r.imageUrl ? String(r.imageUrl) : null,
    colors,
    sizes,
    inStock:
      typeof r.inStock === "boolean" ? r.inStock : sizes.some((s) => s.inStock),
    ...(colorVariants.length ? { colorVariants } : {}),
  };
}
