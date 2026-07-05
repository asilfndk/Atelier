import { join } from "node:path";
import { BrowserWindow, app, powerMonitor } from "electron";
import { registerWindowCreator, setMainWindow } from "./app-state";

const isDev = !app.isPackaged;
const DEV_URL = "http://localhost:3000";

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 820,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#f7f5f1",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(join(app.getAppPath(), "out", "index.html"));
  }

  // Kapat (kırmızı) butonu uygulamayı kapatmaz: pencereyi gizle, tray'de kal.
  // Gerçek çıkış yalnızca __isQuitting bayrağıyla (Cmd+Q / tray "Çıkış").
  win.on("close", (e) => {
    if (!(globalThis as { __isQuitting?: boolean }).__isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  win.on("closed", () => setMainWindow(null));
  setMainWindow(win);
}

// Tek örnek (ikinci başlatmada mevcut pencereyi öne al)
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    import("./app-state").then(({ showWindow }) => showWindow());
  });

  app.whenReady().then(async () => {
    // Menü-bar uygulaması: Dock'ta hiç görünme (LSUIElement Info.plist'te de set'li).
    // Pencere açıkken bile yalnızca menü çubuğundaki çanta ikonundan yönetilir.
    if (app.dock) app.dock.hide();

    // DB yolunu kullanıcı verisi klasörüne sabitle (güncellemelerden etkilenmez).
    process.env.DATABASE_URL = `file:${join(app.getPath("userData"), "app.db")}`;

    // env ayarlandıktan SONRA db'ye dokunan modülleri yükle.
    const { runMigrations } = await import("./db-init");
    const { registerIpc } = await import("./ipc");
    const { startScheduler, checkAll } = await import("./scheduler");
    const { createTray } = await import("./tray");
    const { setAutoLaunch } = await import("./autolaunch");
    const { getSettings } = await import("@/lib/repo");
    const { checkOnStartup, startAutoUpdateChecks } = await import("./updater");

    runMigrations();
    registerWindowCreator(createWindow);
    registerIpc();
    createWindow();
    createTray();
    startScheduler();

    // Kayıtlı auto-launch tercihini işletim sistemiyle eşitle.
    setAutoLaunch(getSettings().autolaunch);

    // Açılışta sessiz güncelleme denetimi (sonuç renderer'a event ile gider)
    // + 24 saatte bir otomatik denetim (ikisi de autoUpdateCheck ayarına bağlı).
    checkOnStartup();
    startAutoUpdateChecks();

    // Uyku/uyanma: uyanışta kaçırılan kontrolü telafi et (edge case #9).
    powerMonitor.on("resume", () => void checkAll());

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

// Gerçek çıkışta (Cmd+Q veya tray "Çıkış") pencere "close" engelini kaldır.
app.on("before-quit", () => {
  (globalThis as { __isQuitting?: boolean }).__isQuitting = true;
});
