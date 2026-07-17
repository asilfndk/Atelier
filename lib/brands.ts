import type { Brand } from "@/types/global";

export const BRAND_LABELS: Record<Brand, string> = {
  zara: "Zara",
  bershka: "Bershka",
  stradivarius: "Stradivarius",
  pullandbear: "Pull & Bear",
  lefties: "Lefties",
  oysho: "Oysho",
  massimodutti: "Massimo Dutti",
  sneaksup: "SneaksUp",
  tommy: "Tommy Hilfiger",
  victoriassecret: "Victoria's Secret",
  boyner: "Boyner",
  wunder: "Wunder",
  superstep: "Superstep",
  mango: "Mango",
  sephora: "Sephora",
  gratis: "Gratis",
  watsons: "Watsons",
  lesbenjamins: "Les Benjamins",
};

export function formatPrice(
  price: number | null,
  currency: string | null,
): string {
  if (price == null) return "—";
  const cur = currency ?? "TRY";
  try {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: cur,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `${price.toFixed(2)} ${cur}`;
  }
}

export function timeAgo(date: Date | string | null): string {
  if (!date) return "never";
  const d = typeof date === "string" ? new Date(date) : date;
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
