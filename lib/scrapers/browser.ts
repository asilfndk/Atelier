import { productStockSchema, type ProductStock } from "./types";

/**
 * Layer 2 — scraping with a hidden Electron BrowserWindow.
 *
 * Runs only in the Electron main process (BrowserWindow lives there).
 * Each brand scraper provides a `pageScript` executed inside the page; the
 * script reads raw product data from the page's DOM/state and returns it.
 * The result is normalized here and validated with `productStockSchema`.
 */

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Simple concurrency limit so we do not open many windows at once and strain memory/the brand.
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

// Lazy-load Electron: keeps the import from blowing up in a Node-only environment (smoke test).
type ElectronModule = typeof import("electron");
function loadElectron(): ElectronModule {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("electron") as ElectronModule;
  } catch {
    throw new Error(
      "BrowserWindow scraping is only available in the Electron main process.",
    );
  }
}

/**
 * Cancel image/media/font requests: extraction only reads DOM + JSON-LD
 * (imageUrl comes from meta too), cutting the page load substantially.
 * script/css/xhr stay allowed — SPA state and the Akamai sensor must keep working.
 */
function blockHeavyResources(win: import("electron").BrowserWindow): void {
  win.webContents.session.webRequest.onBeforeRequest(
    { urls: ["*://*/*"] },
    (details, cb) => {
      const t = details.resourceType;
      cb({ cancel: t === "image" || t === "media" || t === "font" });
    },
  );
}

/** Realistic browser headers to get past Akamai bot protection (once per session). */
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
  // Budget must cover load + settle + in-page waits: the itxrest scripts
  // (P&B/Lefties) alone may spend ~10s discovering endpoints.
  timeoutMs = 35000,
): Promise<ProductStock> {
  const { BrowserWindow } = loadElectron();

  await acquire();
  let win: import("electron").BrowserWindow | null = null;

  try {
    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        // offscreen is not needed for DOM scraping and is fragile in some
        // environments; a plain hidden window is more reliable.
        nodeIntegration: false,
        contextIsolation: true,
        // Separate session: keeps the header hook and resource filter from
        // leaking into the main window's session (Next.js content, product images).
        partition: "scrape",
      },
    });
    win.webContents.setUserAgent(USER_AGENT);
    applyRealisticHeaders(win);
    blockHeavyResources(win);

    const raw = await withTimeout(
      loadAndExtract(win, url, pageScript),
      timeoutMs,
    );

    const normalized = normalizeRaw(raw);
    const parsed = productStockSchema.safeParse(normalized);
    if (!parsed.success) {
      throw new Error(`Page data does not match the schema: ${parsed.error.message}`);
    }
    return parsed.data;
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    release();
  }
}

async function loadAndExtract(
  win: import("electron").BrowserWindow,
  url: string,
  pageScript: string,
): Promise<unknown> {
  // On ERR_ABORTED (locale redirect) and ERR_FAILED (a failed sub-resource/redirect
  // marks the main frame "failed") the DOM still renders — swallow and continue
  // extraction. Only propagate real network/internal errors (DNS, no connection).
  const SOFT_LOAD_ERRORS = new Set(["ERR_ABORTED", "ERR_FAILED"]);
  // loadURL is tied to did-finish-load: on heavy pages (Zara — analytics, bot
  // sensors, long-running requests) it may never resolve within the timeout.
  // The DOM is enough for extraction — race against dom-ready and continue with
  // whichever comes first.
  const domReady = new Promise<void>((resolve) =>
    win.webContents.once("dom-ready", () => resolve()),
  );
  const load = win
    .loadURL(url, { userAgent: USER_AGENT })
    .catch((e: { code?: string }) => {
      if (e?.code && !SOFT_LOAD_ERRORS.has(e.code)) throw e;
    });
  await Promise.race([load, domReady]);
  // If dom-ready wins the race, load may be left orphaned and reject — swallow it.
  void load.catch(() => {});
  // Wait for the page to populate its JS state — poll for JSON-LD instead of a
  // flat sleep so ready pages don't pay the full 3s.
  for (let i = 0; i < 10; i++) {
    const hasLd = await win.webContents
      .executeJavaScript(
        `!!document.querySelector('script[type="application/ld+json"]')`,
        true,
      )
      .catch(() => false);
    if (hasLd) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  // async wrapper: brand scripts may await to open the size panel.
  return win.webContents.executeJavaScript(
    `(async function(){
       const __sleep = (ms) => new Promise(r => setTimeout(r, ms));
       try { ${pageScript} } catch (e) { return { __error: String(e) }; }
     })()`,
    true,
  );
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  // Clear the timer once the race settles — a leftover 35s timeout would pin
  // the event loop after every successful scrape.
  let timer: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`The check timed out after ${Math.round(ms / 1000)}s.`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Normalizes raw page data into ProductStock (used by the browser path only) */
export function normalizeRaw(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "__error" in raw) {
    throw new Error(
      `In-page extraction error: ${(raw as { __error: string }).__error}`,
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
  const normalizeSizes = (v: unknown) =>
    Array.isArray(v)
      ? v.map((s) => {
          const so = (s ?? {}) as Record<string, unknown>;
          const price = toNumber(so.price);
          return {
            label: String(so.label ?? so.size ?? so.name ?? ""),
            inStock: Boolean(
              so.inStock ?? so.available ?? so.isAvailable ?? false,
            ),
            ...(price != null ? { price } : {}),
          };
        })
      : [];
  const sizes = normalizeSizes(r.sizes);
  const colors = Array.isArray(r.colors) ? r.colors.map(String) : [];
  const colorVariants = Array.isArray(r.colorVariants)
    ? r.colorVariants
        .map((v) => {
          const vo = (v ?? {}) as Record<string, unknown>;
          const price = toNumber(vo.price);
          const vSizes = normalizeSizes(vo.sizes);
          return {
            color: String(vo.color ?? ""),
            url: vo.url ? String(vo.url) : null,
            imageUrl: vo.imageUrl ? String(vo.imageUrl) : null,
            ...(vSizes.length ? { sizes: vSizes } : {}),
            ...(price != null ? { price } : {}),
            ...(typeof vo.inStock === "boolean" ? { inStock: vo.inStock } : {}),
          };
        })
        .filter((v) => v.color)
    : [];
  return {
    name: String(r.name ?? "Untitled item"),
    price: toNumber(r.price),
    currency: r.currency ? String(r.currency) : null,
    imageUrl: r.imageUrl ? String(r.imageUrl) : null,
    colors,
    sizes,
    inStock:
      typeof r.inStock === "boolean" ? r.inStock : sizes.some((s) => s.inStock),
    ...(colorVariants.length ? { colorVariants } : {}),
  };
}
