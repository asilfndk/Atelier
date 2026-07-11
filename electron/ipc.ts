import { ipcMain, shell } from "electron";
import { checkUrl, getScraperForUrl } from "@/lib/scrapers";
import {
  getSettings,
  listProducts,
  priceHistory,
  trackProduct,
  untrackProduct,
  updateProduct,
  updateSettings,
  type TrackInput,
} from "@/lib/repo";
import type { TrackedProduct } from "@/db/schema";
import { emitProductsChanged } from "./app-state";
import { setAutoLaunch } from "./autolaunch";
import { notifyTest } from "./notifications";
import { checkAll, reschedule } from "./scheduler";
import { app } from "electron";
import {
  checkForUpdate,
  downloadUpdate,
  getUpdateState,
  startAutoUpdateChecks,
  stopAutoUpdateChecks,
} from "./updater";

/**
 * Renderer ↔ Main bridge. All channels are whitelisted and exposed through
 * preload as `window.api.*`.
 */
export function registerIpc(): void {
  ipcMain.handle("check-url", async (_e, url: string) => checkUrl(url));

  ipcMain.handle("track", async (_e, input: TrackInput & { url: string }) => {
    const scraper = getScraperForUrl(input.url);
    if (!scraper) throw new Error("This link isn't supported.");
    const parsed = scraper.parseUrl(input.url);
    if (!parsed) throw new Error("This product link couldn't be read.");
    const product = trackProduct({
      ...input,
      brand: parsed.brand,
      productId: parsed.productId,
    });
    emitProductsChanged();
    return product;
  });

  ipcMain.handle("untrack", async (_e, id: number) => {
    untrackProduct(id);
    emitProductsChanged();
    return { ok: true };
  });

  ipcMain.handle("list-products", async () => listProducts());

  // Per-product tracking settings (e.g. toggle price tracking later).
  ipcMain.handle(
    "update-product",
    async (
      _e,
      id: number,
      patch: Partial<Pick<TrackedProduct, "trackStock" | "trackPrice">>,
    ) => {
      const product = updateProduct(id, patch);
      emitProductsChanged();
      return product;
    },
  );

  ipcMain.handle("price-history", async (_e, id: number) => priceHistory(id));

  ipcMain.handle("get-settings", async () => getSettings());

  ipcMain.handle("set-settings", async (_e, patch) => {
    const next = updateSettings(patch);
    if ("checkIntervalCron" in patch) reschedule();
    if ("autolaunch" in patch) setAutoLaunch(next.autolaunch);
    if ("autoUpdateCheck" in patch) {
      if (next.autoUpdateCheck) {
        startAutoUpdateChecks();
        void checkForUpdate(); // check immediately when turned on
      } else {
        stopAutoUpdateChecks();
      }
    }
    return next;
  });

  // Manual "check now"
  ipcMain.handle("check-now", async () => {
    await checkAll();
    return { ok: true };
  });

  ipcMain.handle("open-external", async (_e, url: string) => {
    await shell.openExternal(url);
    return { ok: true };
  });

  // Test notification: triggers macOS registration + shows the user it works.
  ipcMain.handle("test-notification", async () => {
    notifyTest();
    return { ok: true };
  });

  // Update check (GitHub Releases).
  ipcMain.handle("get-app-version", async () => app.getVersion());
  ipcMain.handle("update-check", async () => checkForUpdate());
  ipcMain.handle("update-download", async () => downloadUpdate());
  ipcMain.handle("update-state", async () => getUpdateState());
}
