import { app } from "electron";

/** Launch at login (macOS Login Items). */

export function setAutoLaunch(enabled: boolean): void {
  try {
    app.setLoginItemSettings({ openAtLogin: enabled });
  } catch (err) {
    // May be denied for an unsigned / translocated app — not critical.
    console.warn("[autolaunch] could not set login item:", err);
  }
}

export function getAutoLaunch(): boolean {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
}
