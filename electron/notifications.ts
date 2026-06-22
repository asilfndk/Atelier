import { Notification, app, shell } from "electron";

/** Yerel macOS bildirimleri + dock rozeti. */

function notify(title: string, body: string, url?: string): void {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  if (url) {
    n.on("click", () => {
      shell.openExternal(url);
    });
  }
  n.show();
}

export function notifyRestock(name: string, url: string, size?: string | null): void {
  const sizeStr = size ? ` (${size})` : "";
  notify("Stokta! 🎉", `${name}${sizeStr} artık stokta.`, url);
}

export function notifyPriceDrop(
  name: string,
  url: string,
  oldPrice: number,
  newPrice: number,
): void {
  const fmt = (v: number) =>
    new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
      maximumFractionDigits: 0,
    }).format(v);
  notify(
    "Fiyat düştü ↓",
    `${name}: ${fmt(oldPrice)} → ${fmt(newPrice)}`,
    url,
  );
}

/** Dock simgesinde stokta-olan-ürün sayısı rozeti. */
export function setDockBadge(count: number): void {
  if (process.platform !== "darwin" || !app.dock) return;
  app.dock.setBadge(count > 0 ? String(count) : "");
}
