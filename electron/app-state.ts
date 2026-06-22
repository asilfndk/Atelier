import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BrowserWindow } from "electron";

/** Ana pencere referansı ve "ürünler değişti" yayını için paylaşılan durum. */

/**
 * Runtime ikon dosyasını hem dev'de (proje `resources/`) hem paketlenmiş .app
 * içinde (`process.resourcesPath`, bkz. electron-builder.yml extraResources) bulur.
 */
export function resolveAsset(filename: string): string {
  const candidates = [
    join(process.cwd(), "resources", filename),
    join(process.resourcesPath ?? "", filename),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

let mainWindow: BrowserWindow | null = null;
let windowCreator: () => void = () => {};
const productListeners: Array<() => void> = [];

export function setMainWindow(w: BrowserWindow | null): void {
  mainWindow = w;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function registerWindowCreator(fn: () => void): void {
  windowCreator = fn;
}

/** Pencereyi göster; kapanmışsa yeniden oluştur. */
export function showWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    windowCreator();
  }
}

/** Renderer'a "listeyi yenile" sinyali gönder (varsa). */
export function pingRenderer(): void {
  mainWindow?.webContents.send("products-changed");
}

export function onProductsChanged(fn: () => void): void {
  productListeners.push(fn);
}

export function emitProductsChanged(): void {
  for (const fn of productListeners) fn();
  pingRenderer();
}
