import { contextBridge, ipcRenderer } from "electron";

/**
 * Güvenli köprü: renderer'a yalnızca beyaz listeli kanalları açar.
 * `contextIsolation: true`, `nodeIntegration: false` ile birlikte çalışır.
 */
const api = {
  checkUrl: (url: string) => ipcRenderer.invoke("check-url", url),
  track: (input: unknown) => ipcRenderer.invoke("track", input),
  untrack: (id: number) => ipcRenderer.invoke("untrack", id),
  updateProduct: (id: number, patch: unknown) =>
    ipcRenderer.invoke("update-product", id, patch),
  listProducts: () => ipcRenderer.invoke("list-products"),
  priceHistory: (id: number) => ipcRenderer.invoke("price-history", id),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  setSettings: (patch: unknown) => ipcRenderer.invoke("set-settings", patch),
  checkNow: () => ipcRenderer.invoke("check-now"),
  testNotification: () => ipcRenderer.invoke("test-notification"),
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
  // Arka plan kontrolü liste değiştirince renderer'ı haberdar et.
  onProductsChanged: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("products-changed", handler);
    return () => ipcRenderer.removeListener("products-changed", handler);
  },
  // Tray menüsündeki "Ayarlar…" tıklanınca ayar modalını aç.
  onOpenSettings: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("open-settings", handler);
    return () => ipcRenderer.removeListener("open-settings", handler);
  },
  // Güncelleme denetimi.
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  checkForUpdate: () => ipcRenderer.invoke("update-check"),
  downloadUpdate: () => ipcRenderer.invoke("update-download"),
  getUpdateState: () => ipcRenderer.invoke("update-state"),
  onUpdateState: (cb: (state: unknown) => void) => {
    const handler = (_e: unknown, state: unknown) => cb(state);
    ipcRenderer.on("update-state", handler);
    return () => ipcRenderer.removeListener("update-state", handler);
  },
};

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;
