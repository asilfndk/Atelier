import { Notification, app } from "electron";
import { openProduct, openSettings } from "./app-state";

/** Local macOS notifications + dock badge. */

function notify(title: string, body: string, onClick?: () => void): void {
  if (!Notification.isSupported()) return;
  // Play an explicit system sound on macOS (silent:false alone does not always play).
  const n = new Notification({ title, body, silent: false, sound: "Glass" });
  if (onClick) n.on("click", onClick);
  // macOS never surfaces registration failures (blocked permission, signature
  // mismatch) — "show" simply never fires. Log it so running the app from a
  // terminal makes the failure visible (Electron's "failed" event is Windows-only).
  const watchdog = setTimeout(() => {
    console.warn(
      "[notifications] 'show' never fired — likely blocked by macOS " +
        "(check System Settings → Notifications → Atelier; see docs/TROUBLESHOOTING.md)",
    );
  }, 3000);
  n.on("show", () => clearTimeout(watchdog));
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
  currency?: string | null,
): void {
  const cur = currency || "TRY";
  const fmt = (v: number) => {
    try {
      return new Intl.NumberFormat("tr-TR", {
        style: "currency",
        currency: cur,
        maximumFractionDigits: 2,
      }).format(v);
    } catch {
      return `${v.toFixed(2)} ${cur}`;
    }
  };
  notify("Price drop ↓", `${name}: ${fmt(oldPrice)} → ${fmt(newPrice)}`, () =>
    openProduct(productId),
  );
}

/** When a new app version is found — clicking opens settings (download button). */
export function notifyUpdateAvailable(version: string): void {
  notify(
    "Update available",
    `Atelier v${version} is ready to install. Open Settings to update.`,
    () => openSettings(),
  );
}

/** Badge on the dock icon with the count of in-stock products. */
export function setDockBadge(count: number): void {
  if (process.platform !== "darwin" || !app.dock) return;
  app.dock.setBadge(count > 0 ? String(count) : "");
}
