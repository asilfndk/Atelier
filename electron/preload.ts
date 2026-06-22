import { contextBridge, ipcRenderer } from "electron";

/**
 * Güvenli köprü: renderer'a yalnızca beyaz listeli kanalları açar.
 * `contextIsolation: true`, `nodeIntegration: false` ile birlikte çalışır.
 */
const api = {
  checkUrl: (url: string) => ipcRenderer.invoke("check-url", url),
  track: (input: unknown) => ipcRenderer.invoke("track", input),
  untrack: (id: number) => ipcRenderer.invoke("untrack", id),
  listProducts: () => ipcRenderer.invoke("list-products"),
  priceHistory: (id: number) => ipcRenderer.invoke("price-history", id),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  setSettings: (patch: unknown) => ipcRenderer.invoke("set-settings", patch),
  checkNow: () => ipcRenderer.invoke("check-now"),
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
  // Arka plan kontrolü liste değiştirince renderer'ı haberdar et.
  onProductsChanged: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("products-changed", handler);
    return () => ipcRenderer.removeListener("products-changed", handler);
  },
};

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;
