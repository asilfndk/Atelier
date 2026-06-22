import { ipcMain, shell } from "electron";
import { checkUrl, getScraperForUrl } from "@/lib/scrapers";
import {
  getSettings,
  listProducts,
  priceHistory,
  trackProduct,
  untrackProduct,
  updateSettings,
  type TrackInput,
} from "@/lib/repo";
import { emitProductsChanged } from "./app-state";
import { setAutoLaunch } from "./autolaunch";
import { checkAll, reschedule } from "./scheduler";

/**
 * Renderer ↔ Main köprüsü. Tüm kanallar beyaz listelidir ve preload üzerinden
 * `window.api.*` olarak açılır.
 */
export function registerIpc(): void {
  ipcMain.handle("check-url", async (_e, url: string) => checkUrl(url));

  ipcMain.handle("track", async (_e, input: TrackInput & { url: string }) => {
    const scraper = getScraperForUrl(input.url);
    if (!scraper) throw new Error("Desteklenmeyen URL.");
    const parsed = scraper.parseUrl(input.url);
    if (!parsed) throw new Error("URL ayrıştırılamadı.");
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

  ipcMain.handle("price-history", async (_e, id: number) => priceHistory(id));

  ipcMain.handle("get-settings", async () => getSettings());

  ipcMain.handle("set-settings", async (_e, patch) => {
    const next = updateSettings(patch);
    if ("checkIntervalCron" in patch) reschedule();
    if ("autolaunch" in patch) setAutoLaunch(next.autolaunch);
    return next;
  });

  // Manuel "şimdi kontrol et"
  ipcMain.handle("check-now", async () => {
    await checkAll();
    return { ok: true };
  });

  ipcMain.handle("open-external", async (_e, url: string) => {
    await shell.openExternal(url);
    return { ok: true };
  });
}
