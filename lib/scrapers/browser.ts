import { productStockSchema, type ProductStock } from "./types";

/**
 * Katman 2 — Gizli Electron BrowserWindow ile scraping.
 *
 * Yalnızca Electron ana sürecinde çalışır (BrowserWindow orada bulunur).
 * Her marka scraper'ı, sayfa içinde çalışacak bir `pageScript` verir; bu script
 * sayfanın DOM/state'inden ham ürün verisini okuyup döndürür. Sonuç burada
 * normalize edilip `productStockSchema` ile doğrulanır.
 */

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Aynı anda çok pencere açıp belleği/markayı yormamak için basit eşzamanlılık sınırı.
const MAX_CONCURRENT = 2;
let active = 0;
const queue: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => queue.push(resolve));
  active++;
}

function release(): void {
  active--;
  const next = queue.shift();
  if (next) next();
}

// Electron'u lazy yükle: Node-only ortamda (smoke test) import patlamasın.
type ElectronModule = typeof import("electron");
function loadElectron(): ElectronModule {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("electron") as ElectronModule;
  } catch {
    throw new Error(
      "BrowserWindow scraping yalnızca Electron ana sürecinde kullanılabilir.",
    );
  }
}

/** Akamai bot korumasını aşmak için gerçekçi tarayıcı header'ları (oturum başına bir kez). */
function applyRealisticHeaders(win: import("electron").BrowserWindow): void {
  win.webContents.session.webRequest.onBeforeSendHeaders((details, cb) => {
    const h = details.requestHeaders;
    h["Accept-Language"] = "tr-TR,tr;q=0.9,en;q=0.8";
    h["Accept"] =
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
    h["sec-ch-ua"] =
      '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"';
    h["sec-ch-ua-mobile"] = "?0";
    h["sec-ch-ua-platform"] = '"macOS"';
    h["Upgrade-Insecure-Requests"] = "1";
    cb({ requestHeaders: h });
  });
}

export async function scrapeWithBrowser(
  url: string,
  pageScript: string,
  timeoutMs = 25000,
): Promise<ProductStock> {
  const { BrowserWindow } = loadElectron();

  await acquire();
  let win: import("electron").BrowserWindow | null = null;
  const timer: NodeJS.Timeout | null = null;

  try {
    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        // offscreen DOM scraping için gerekmez ve bazı ortamlarda kırılgan;
        // normal gizli pencere daha güvenilir.
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    win.webContents.setUserAgent(USER_AGENT);
    applyRealisticHeaders(win);

    const raw = await withTimeout(
      loadAndExtract(win, url, pageScript),
      timeoutMs,
    );

    const normalized = normalizeRaw(raw);
    const parsed = productStockSchema.safeParse(normalized);
    if (!parsed.success) {
      throw new Error(`Sayfa verisi şemaya uymuyor: ${parsed.error.message}`);
    }
    return parsed.data;
  } finally {
    if (timer) clearTimeout(timer);
    if (win && !win.isDestroyed()) win.destroy();
    release();
  }
}

async function loadAndExtract(
  win: import("electron").BrowserWindow,
  url: string,
  pageScript: string,
): Promise<unknown> {
  // ERR_ABORTED genelde locale yönlendirmesidir; içerik yine de yüklenir → yut.
  await win.loadURL(url, { userAgent: USER_AGENT }).catch((e: { code?: string }) => {
    if (e?.code && e.code !== "ERR_ABORTED") throw e;
  });
  // Sayfanın JS state'ini (JSON-LD) doldurması için bekleme.
  await new Promise((r) => setTimeout(r, 3000));
  // async sarmalayıcı: marka scriptleri beden panelini açmak için await edebilir.
  return win.webContents.executeJavaScript(
    `(async function(){
       const __sleep = (ms) => new Promise(r => setTimeout(r, ms));
       try { ${pageScript} } catch (e) { return { __error: String(e) }; }
     })()`,
    true,
  );
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Zaman aşımı (${ms}ms)`)), ms),
    ),
  ]);
}

/** Ham sayfa verisini ProductStock'a normalize eder (browser + JSON-LD ortak) */
export function normalizeRaw(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "__error" in raw) {
    throw new Error(
      `Sayfa içi çıkarım hatası: ${(raw as { __error: string }).__error}`,
    );
  }
  const r = (raw ?? {}) as Record<string, unknown>;
  const toNumber = (v: unknown): number | null => {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "string") {
      const n = parseFloat(v.replace(/[^\d.,]/g, "").replace(",", "."));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };
  const sizes = Array.isArray(r.sizes)
    ? r.sizes.map((s) => {
        const so = (s ?? {}) as Record<string, unknown>;
        return {
          label: String(so.label ?? so.size ?? so.name ?? ""),
          inStock: Boolean(so.inStock ?? so.available ?? so.isAvailable ?? false),
        };
      })
    : [];
  const colors = Array.isArray(r.colors) ? r.colors.map(String) : [];
  return {
    name: String(r.name ?? "Bilinmeyen ürün"),
    price: toNumber(r.price),
    currency: r.currency ? String(r.currency) : null,
    imageUrl: r.imageUrl ? String(r.imageUrl) : null,
    colors,
    sizes,
    inStock:
      typeof r.inStock === "boolean" ? r.inStock : sizes.some((s) => s.inStock),
  };
}
