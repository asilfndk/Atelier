// Renderer-side type definition of the renderer ↔ main bridge (preload.ts).
//
// Types shared with the main process are type-only re-exports of their single
// source of truth — erased at compile time, so the renderer never pulls in
// better-sqlite3/zod at runtime. Only renderer-specific shapes are declared
// here.

export type { Brand, TrackedProduct } from "@/db/schema";
export type {
  ColorVariant,
  ProductStock,
  SizeAvailability,
} from "@/lib/scrapers/types";
import type { ProductStock, SizeAvailability } from "@/lib/scrapers/types";
import type { Settings, CheckHistory, TrackedProduct } from "@/db/schema";

export interface ScrapeResult extends ProductStock {
  /** "cache" is renderer-only: page.tsx synthesizes it when showing the last
   * DB state — the main-side type (lib/scrapers/types.ts) is "api"|"browser". */
  source: "api" | "browser" | "cache";
}

export type AppSettings = Settings;

export type CheckHistoryRow = CheckHistory;

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
