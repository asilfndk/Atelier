import { BrowserWindow, app } from "electron";
import { checkUrl, getScraperForUrl } from "@/lib/scrapers";

app.disableHardwareAcceleration();

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function applyHeaders(win: BrowserWindow): void {
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

// Marka listeleme/kategori sayfaları — buradan gerçek ürün linkleri keşfedilir.
const LISTINGS = [
  "https://www.zara.com/us/en/woman-dresses-l1066.html",
  "https://www.bershka.com/tr/kadin/yeni-n3283.html",
  "https://www.stradivarius.com/tr/kadin/giyim/elbiseler-n1928.html",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function discover(listUrl: string): Promise<string[]> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true },
  });
  win.webContents.setUserAgent(UA);
  applyHeaders(win);
  try {
    await win
      .loadURL(listUrl, { userAgent: UA })
      .catch((e: { code?: string }) => {
        if (e?.code && e.code !== "ERR_ABORTED") throw e;
      });
    await sleep(5000);
    const hrefs: string[] = await win.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('a[href]')).map(a => a.href)`,
      true,
    );
    const scraper = getScraperForUrl(listUrl);
    const products = hrefs.filter((h) => scraper && scraper.parseUrl(h));
    return [...new Set(products)];
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

app.whenReady().then(async () => {
  // argv ile belirli listeleme URL'leri verilebilir; yoksa hepsini dene.
  const argUrls = process.argv.filter((a) => a.startsWith("http"));
  const targets = argUrls.length ? argUrls : LISTINGS;
  for (const list of targets) {
    const scraper = getScraperForUrl(list);
    const brand = scraper?.brand ?? "?";
    console.log(`\n=== [${brand}] ${list}`);

    // URL'in kendisi ürünse doğrudan scrape et; değilse listeden keşfet.
    let target: string | undefined;
    if (scraper?.parseUrl(list)) {
      target = list;
      console.log("  (doğrudan ürün URL'i)");
    } else {
      let products: string[] = [];
      try {
        products = await discover(list);
      } catch (e) {
        console.log("  keşif hatası:", e instanceof Error ? e.message : e);
      }
      console.log(`  bulunan ürün linki: ${products.length}`);
      target = products[0];
    }

    if (!target) {
      console.log("  → ürün linki bulunamadı (bot-engel veya farklı yapı)");
      continue;
    }
    console.log("  scrape:", target);
    try {
      const r = await checkUrl(target);
      console.log(
        "  SONUÇ:",
        JSON.stringify({
          source: r.source,
          name: r.name,
          price: r.price,
          currency: r.currency,
          inStock: r.inStock,
          sizes: r.sizes,
          colors: r.colors.length,
        }),
      );
    } catch (e) {
      console.log("  scrape hatası:", e instanceof Error ? e.message : e);
    }
  }
  app.quit();
});
