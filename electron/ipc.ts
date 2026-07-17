import { ipcMain, shell } from "electron";
import { z } from "zod";
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

// Runtime validation of renderer payloads (defense-in-depth: the renderer is
// local, but an untyped patch reaching Drizzle's .set() must never carry
// arbitrary columns).
const productPatchSchema = z
  .object({
    trackStock: z.boolean().optional(),
    trackPrice: z.boolean().optional(),
  })
  .strict();

const settingsPatchSchema = z
  .object({
    checkIntervalCron: z.string().max(100).optional(),
    autolaunch: z.boolean().optional(),
    notifyStock: z.boolean().optional(),
    notifyPrice: z.boolean().optional(),
    autoUpdateCheck: z.boolean().optional(),
  })
  .strict();

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
      const product = updateProduct(id, productPatchSchema.parse(patch));
      emitProductsChanged();
      return product;
    },
  );

  ipcMain.handle("price-history", async (_e, id: number) => priceHistory(id));

  ipcMain.handle("get-settings", async () => getSettings());

  ipcMain.handle("set-settings", async (_e, patch) => {
    const next = updateSettings(settingsPatchSchema.parse(patch));
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
    // Never hand file:/custom schemes to the OS.
    const u = new URL(String(url));
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error("Only http(s) links can be opened.");
    }
    await shell.openExternal(u.toString());
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
