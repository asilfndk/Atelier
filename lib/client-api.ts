import type { InditexApi } from "@/types/global";

/**
 * Renderer'dan main sürecine erişim. Electron dışında (ör. tarayıcıda
 * localhost:3000) `window.api` yoktur; bu durumda anlamlı hata veririz.
 */
export function getApi(): InditexApi {
  if (typeof window === "undefined" || !window.api) {
    throw new Error(
      "Uygulama köprüsü bulunamadı. Bu pencereyi Atelier uygulaması içinden açın.",
    );
  }
  return window.api;
}

export function hasApi(): boolean {
  return typeof window !== "undefined" && !!window.api;
}
