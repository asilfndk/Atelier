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

  // The close (red) button does not quit the app: hide the window, stay in the tray.
  // A real quit only happens via the __isQuitting flag (Cmd+Q / tray "Quit").
  win.on("close", (e) => {
    if (!(globalThis as { __isQuitting?: boolean }).__isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  win.on("closed", () => setMainWindow(null));
  setMainWindow(win);
}

// Single instance (a second launch brings the existing window to front)
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    import("./app-state").then(({ showWindow }) => showWindow());
  });

  app.whenReady().then(async () => {
    const { initFileLog } = await import("./log");
    initFileLog();
    // Menu-bar app: never show in the Dock (LSUIElement is also set in Info.plist).
    // Even with the window open, the app is managed from the menu-bar bag icon only.
    if (app.dock) app.dock.hide();

    // Pin the DB path to the user-data folder (unaffected by updates).
    process.env.DATABASE_URL = `file:${join(app.getPath("userData"), "app.db")}`;

    // Load modules that touch the DB only AFTER the env var is set.
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

    // Sync the stored auto-launch preference with the OS.
    setAutoLaunch(getSettings().autolaunch);

    // Silent update check on startup (result goes to the renderer via event)
    // + automatic check every 24h (both gated by the autoUpdateCheck setting).
    checkOnStartup();
    startAutoUpdateChecks();

    // Sleep/wake: make up for the missed check on resume (edge case #9).
    powerMonitor.on("resume", () => void checkAll());

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

// On a real quit (Cmd+Q or tray "Quit"), lift the window "close" block.
app.on("before-quit", () => {
  (globalThis as { __isQuitting?: boolean }).__isQuitting = true;
});
