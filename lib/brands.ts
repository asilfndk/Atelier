import type { Brand } from "@/types/global";

export const BRAND_LABELS: Record<Brand, string> = {
  zara: "Zara",
  bershka: "Bershka",
  stradivarius: "Stradivarius",
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
  if (!date) return "hiç";
  const d = typeof date === "string" ? new Date(date) : date;
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "az önce";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} dk önce`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} sa önce`;
  return `${Math.floor(hrs / 24)} gün önce`;
}
