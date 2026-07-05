// Renderer ↔ Main köprüsünün (preload.ts) renderer tarafındaki tip tanımı.

export type Brand =
  | "zara"
  | "bershka"
  | "stradivarius"
  | "sneaksup"
  | "tommy"
  | "victoriassecret"
  | "boyner"
  | "wunder"
  | "superstep"
  | "mango"
  | "sephora";

export interface SizeAvailability {
  label: string;
  inStock: boolean;
  /** Varyant bazlı fiyat (ör. Sephora ml boyları) — çoğu markada yok */
  price?: number | null;
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
  /** JSON SizeAvailability[] — son kontrolün beden matrisi */
  lastSizes: string | null;
  /** JSON string[] — son kontrolün renk listesi */
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
