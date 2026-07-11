import { Notification, app } from "electron";
import { openProduct, openSettings } from "./app-state";

/** Local macOS notifications + dock badge. */

function notify(title: string, body: string, onClick?: () => void): void {
  if (!Notification.isSupported()) return;
  // Play an explicit system sound on macOS (silent:false alone does not always play).
  const n = new Notification({ title, body, silent: false, sound: "Glass" });
  if (onClick) n.on("click", onClick);
  n.show();
}

/** Test notification triggered from settings — verifies the permission/registration flow. */
export function notifyTest(): void {
  notify("Atelier", "You're all set — notifications are working ✅");
}

export function notifyRestock(
  name: string,
  productId: number,
  size?: string | null,
): void {
  const sizeStr = size ? ` (${size})` : "";
  notify("Back in stock 🎉", `${name}${sizeStr} is available again — grab it while it lasts.`, () =>
    openProduct(productId),
  );
}

export function notifyPriceDrop(
  name: string,
  productId: number,
  oldPrice: number,
  newPrice: number,
): void {
  const fmt = (v: number) =>
    new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
      maximumFractionDigits: 0,
    }).format(v);
  notify("Price drop ↓", `${name}: ${fmt(oldPrice)} → ${fmt(newPrice)}`, () =>
    openProduct(productId),
  );
}

/** When a new app version is found — clicking opens settings (download button). */
export function notifyUpdateAvailable(version: string): void {
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title: "Update available",
    body: `Atelier v${version} is ready to install. Open Settings to update.`,
    silent: false,
    sound: "Glass",
  });
  n.on("click", () => openSettings());
  n.show();
}

/** Badge on the dock icon with the count of in-stock products. */
export function setDockBadge(count: number): void {
  if (process.platform !== "darwin" || !app.dock) return;
  app.dock.setBadge(count > 0 ? String(count) : "");
}
