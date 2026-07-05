import { Notification, app, shell } from "electron";
import { openSettings } from "./app-state";

/** Yerel macOS bildirimleri + dock rozeti. */

function notify(title: string, body: string, url?: string): void {
  if (!Notification.isSupported()) return;
  // macOS'ta açık bir sistem sesi ver (yalnızca silent:false her zaman çalmıyor).
  const n = new Notification({ title, body, silent: false, sound: "Glass" });
  if (url) {
    n.on("click", () => {
      shell.openExternal(url);
    });
  }
  n.show();
}

/** Ayarlardan tetiklenen test bildirimi — izin/kayıt akışını doğrulamak için. */
export function notifyTest(): void {
  notify("Atelier", "Bildirimler çalışıyor ✅");
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

/** Yeni uygulama sürümü bulununca — tıklanınca ayarlar (indirme butonu) açılır. */
export function notifyUpdateAvailable(version: string): void {
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title: "Güncelleme mevcut",
    body: `Atelier v${version} indirilebilir. Ayarlar'dan indirebilirsin.`,
    silent: false,
    sound: "Glass",
  });
  n.on("click", () => openSettings());
  n.show();
}

/** Dock simgesinde stokta-olan-ürün sayısı rozeti. */
export function setDockBadge(count: number): void {
  if (process.platform !== "darwin" || !app.dock) return;
  app.dock.setBadge(count > 0 ? String(count) : "");
}
