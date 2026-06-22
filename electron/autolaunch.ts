import { app } from "electron";

/** Girişte otomatik başlatma (macOS Login Items). */

export function setAutoLaunch(enabled: boolean): void {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true, // arka planda (tray) başla
    });
  } catch (err) {
    // İmzasız / translocated app'te izin verilmeyebilir — kritik değil.
    console.warn("[autolaunch] login item ayarlanamadı:", err);
  }
}

export function getAutoLaunch(): boolean {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
}
