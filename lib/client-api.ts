import type { InditexApi } from "@/types/global";

/**
 * Access to the main process from the renderer. Outside Electron (e.g. in a
 * browser at localhost:3000) `window.api` does not exist; we throw a
 * meaningful error in that case.
 */
export function getApi(): InditexApi {
  if (typeof window === "undefined" || !window.api) {
    throw new Error("This page only works inside the Atelier app.");
  }
  return window.api;
}

export function hasApi(): boolean {
  return typeof window !== "undefined" && !!window.api;
}
