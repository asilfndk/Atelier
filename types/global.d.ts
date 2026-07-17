// Renderer-side type definition of the renderer ↔ main bridge (preload.ts).

export type Brand =
  | "zara"
  | "bershka"
  | "stradivarius"
  | "pullandbear"
  | "lefties"
  | "sneaksup"
  | "tommy"
  | "victoriassecret"
  | "boyner"
  | "wunder"
  | "superstep"
  | "mango"
  | "sephora"
  | "gratis"
  | "watsons";

export interface SizeAvailability {
  label: string;
  inStock: boolean;
  /** Per-variant price (e.g. Sephora ml sizes) — absent for most brands */
  price?: number | null;
}

/** Color-specific variant data — image/sizes/price update from this on color selection */
export interface ColorVariant {
  color: string;
  /** Color-specific product URL (?v1=<id>) — tracking uses this URL */
  url?: string | null;
  imageUrl?: string | null;
  sizes?: SizeAvailability[];
  price?: number | null;
  /** Stock status of a sizeless color variant (e.g. Sephora shades) */
  inStock?: boolean | null;
}

export interface ProductStock {
  name: string;
  price: number | null;
  currency: string | null;
  imageUrl: string | null;
  colors: string[];
  sizes: SizeAvailability[];
  inStock: boolean;
  /** Per-color image/sizes/URL (Zara, Bershka, Pull & Bear, Lefties, Mango, Sephora…) */
  colorVariants?: ColorVariant[];
}

export interface ScrapeResult extends ProductStock {
  /** "cache" is renderer-only: page.tsx synthesizes it when showing the last
   * DB state — the main-side type (lib/scrapers/types.ts) is "api"|"browser". */
  source: "api" | "browser" | "cache";
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
  lowestPrice: number | null;
  /** JSON SizeAvailability[] — size matrix of the last check */
  lastSizes: string | null;
  /** JSON string[] — color list of the last check */
  lastColors: string | null;
  createdAt: Date;
  lastCheckedAt: Date | null;
}

export interface AppSettings {
  id: number;
  checkIntervalCron: string;
  autolaunch: boolean;
  notifyStock: boolean;
  notifyPrice: boolean;
  autoUpdateCheck: boolean;
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
  sizes?: SizeAvailability[] | null;
  colors?: string[] | null;
}

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "downloaded"
  | "error"
  | "up-to-date";

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  latestVersion?: string;
  percent?: number;
  error?: string;
}

export interface InditexApi {
  checkUrl(url: string): Promise<ScrapeResult>;
  track(input: TrackPayload): Promise<TrackedProduct>;
  untrack(id: number): Promise<{ ok: true }>;
  updateProduct(
    id: number,
    patch: Partial<Pick<TrackedProduct, "trackStock" | "trackPrice">>,
  ): Promise<TrackedProduct>;
  listProducts(): Promise<TrackedProduct[]>;
  priceHistory(id: number): Promise<CheckHistoryRow[]>;
  getSettings(): Promise<AppSettings>;
  setSettings(patch: Partial<Omit<AppSettings, "id">>): Promise<AppSettings>;
  checkNow(): Promise<{ ok: true }>;
  testNotification(): Promise<{ ok: true }>;
  openExternal(url: string): Promise<{ ok: true }>;
  onProductsChanged(cb: () => void): () => void;
  onOpenSettings(cb: () => void): () => void;
  onOpenProduct(cb: (id: number) => void): () => void;
  getAppVersion(): Promise<string>;
  checkForUpdate(): Promise<UpdateState>;
  downloadUpdate(): Promise<UpdateState>;
  getUpdateState(): Promise<UpdateState>;
  onUpdateState(cb: (state: UpdateState) => void): () => void;
}

declare global {
  interface Window {
    api: InditexApi;
  }
}
