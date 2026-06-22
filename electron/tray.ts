import { Menu, Tray, app, nativeImage } from "electron";
import { listProducts } from "@/lib/repo";
import { onProductsChanged, resolveAsset, showWindow } from "./app-state";
import { checkAll, refreshBadge } from "./scheduler";

let tray: Tray | null = null;

/** Menü çubuğu simgesi: monokrom template (açık/koyu menü çubuğuna otomatik uyum). */
export function createTray(): void {
  const icon = nativeImage.createFromPath(resolveAsset("trayTemplate.png"));
  icon.setTemplateImage(true);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("Atelier — Inditex Stok Takip");
  updateTray();
  onProductsChanged(updateTray);
}

export function updateTray(): void {
  if (!tray) return;
  const items = listProducts();
  const inStock = items.filter((p) => p.lastInStock).length;

  tray.setTitle(inStock > 0 ? ` ◆ ${inStock}` : " ◆");
  refreshBadge();

  const menu = Menu.buildFromTemplate([
    { label: "Atelier", enabled: false },
    {
      label: `${items.length} takip · ${inStock} stokta`,
      enabled: false,
    },
    { type: "separator" },
    { label: "Pencereyi Göster", click: () => showWindow() },
    { label: "Şimdi Kontrol Et", click: () => void checkAll() },
    { type: "separator" },
    {
      label: "Çıkış",
      click: () => {
        (globalThis as { __isQuitting?: boolean }).__isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}
