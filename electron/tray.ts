import { Menu, Tray, app, nativeImage } from "electron";
import { listProducts } from "@/lib/repo";
import {
  onProductsChanged,
  openSettings,
  resolveAsset,
  showWindow,
} from "./app-state";
import { checkAll, refreshBadge } from "./scheduler";

let tray: Tray | null = null;

/** Menu-bar icon: monochrome template (auto-adapts to light/dark menu bar). */
export function createTray(): void {
  const icon = nativeImage.createFromPath(resolveAsset("trayTemplate.png"));
  icon.setTemplateImage(true);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("Atelier — Stock & Price Tracker");
  updateTray();
  onProductsChanged(updateTray);
}

export function updateTray(): void {
  if (!tray) return;
  const items = listProducts();
  const inStock = items.filter((p) => p.lastInStock).length;

  // If any product is in stock, show the count next to the icon; otherwise icon only.
  tray.setTitle(inStock > 0 ? ` ${inStock}` : "");
  refreshBadge();

  const menu = Menu.buildFromTemplate([
    { label: "Atelier", enabled: false },
    {
      label: `${items.length} tracked · ${inStock} in stock`,
      enabled: false,
    },
    { type: "separator" },
    { label: "Open Atelier", click: () => showWindow() },
    { label: "Check Now", click: () => void checkAll() },
    { label: "Settings…", click: () => openSettings() },
    { type: "separator" },
    {
      label: "Quit Atelier",
      click: () => {
        (globalThis as { __isQuitting?: boolean }).__isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}
