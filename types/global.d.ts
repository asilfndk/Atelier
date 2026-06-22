// Renderer ↔ Main köprüsünün (preload.ts) renderer tarafındaki tip tanımı.

export type Brand = "zara" | "bershka" | "stradivarius";

export interface SizeAvailability {
  label: string;
  inStock: boolean;
}

export interface ProductStock {
  name: string;
  price: number | null;
  currency: string | null;
  imageUrl: string | null;
  colors: string[];
  sizes: SizeAvailability[];
  inStock: boolean;
}

export interface ScrapeResult extends ProductStock {
  source: "api" | "browser";
}

export interface TrackedProduct {
  id: number;
  url: string;
  brand: Brand;
  productId: string;
  name: string | null;
  imageUrl: string | null;
  targetSize: string | null;
  targetColor: string | null;
  trackStock: boolean;
  trackPrice: boolean;
  lastPrice: number | null;
  lastInStock: boolean | null;
  createdAt: Date;
  lastCheckedAt: Date | null;
}

export interface AppSettings {
  id: number;
  checkIntervalCron: string;
  autolaunch: boolean;
  notifyStock: boolean;
  notifyPrice: boolean;
}

export interface CheckHistoryRow {
  id: number;
  productId: number;
  inStock: boolean | null;
  price: number | null;
  checkedAt: Date;
}

export interface TrackPayload {
  url: string;
  name?: string | null;
  imageUrl?: string | null;
  targetSize?: string | null;
  targetColor?: string | null;
  trackStock?: boolean;
  trackPrice?: boolean;
  lastPrice?: number | null;
  lastInStock?: boolean | null;
}

export interface InditexApi {
  checkUrl(url: string): Promise<ScrapeResult>;
  track(input: TrackPayload): Promise<TrackedProduct>;
  untrack(id: number): Promise<{ ok: true }>;
  listProducts(): Promise<TrackedProduct[]>;
  priceHistory(id: number): Promise<CheckHistoryRow[]>;
  getSettings(): Promise<AppSettings>;
  setSettings(patch: Partial<Omit<AppSettings, "id">>): Promise<AppSettings>;
  checkNow(): Promise<{ ok: true }>;
  openExternal(url: string): Promise<{ ok: true }>;
  onProductsChanged(cb: () => void): () => void;
}

declare global {
  interface Window {
    api: InditexApi;
  }
}
