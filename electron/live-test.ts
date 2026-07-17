import { BrowserWindow, app } from "electron";
import { checkUrl, getScraperForUrl } from "@/lib/scrapers";

app.disableHardwareAcceleration();
// Scrape windows open and close; don't let Electron's default app.quit()
// cut the suite short when the last one closes.
app.on("window-all-closed", () => {});

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

// Brand listing/category pages — real product links are discovered from these.
const LISTINGS = [
  "https://www.zara.com/us/en/woman-dresses-l1066.html",
  "https://www.bershka.com/tr/kadin/yeni-n3283.html",
  "https://www.stradivarius.com/tr/kadin/giyim/elbiseler-n1928.html",
  // Pull & Bear — direct product URLs (multi-color + sizeless perfume).
  "https://www.pullandbear.com/tr/keten-jogger-pantolon-l03671509?cS=717&pelement=744752801",
  "https://www.pullandbear.com/tr/freaking-marvellous-parfum-l00100501?cS=157&pelement=721970742",
  // Lefties — direct product URLs (multi-color jeans + footwear).
  "https://www.lefties.com/tr/en/woman/clothing/jeans/lightweight-striped-culotte-jeans-c1030267526p747880059.html?colorId=104&parentId=747884869",
  "https://www.lefties.com/tr/en/woman/footwear/flat-sandals/gold-strappy-flat-sandals-c1030290507p747861209.html?colorId=091&style=04&parentId=754686322",
  // Oysho — direct product URLs (leggings with a length dimension + tapered pants).
  "https://www.oysho.com/tr/high-rise-comfortlux-bilek-hizasında-tayt-l31216226?colorId=516&pelement=203653805",
  "https://www.oysho.com/tr/100-pamuklu-tapered-pantolon-l35681670?colorId=913&pelement=223465926",
  // Massimo Dutti — direct product URL (multi-color jean).
  "https://www.massimodutti.com/tr/yuksek-bel-genis-paca-jean-l05052852?pelement=61733754",
  // Les Benjamins — direct product URL (Shopify .js Layer-1 API).
  "https://lesbenjamins.com/collections/kadin-tisort/products/short-sleeve-tee-404-lb26ssclafuts-404",
  // Newer stores — direct product URLs (parseUrl matches → scraped directly).
  "https://www.sneaksup.com/new-balance-9060-lifestyle-womens-shoes-u9060blk-w-1",
  "https://tr.tommy.com/erkek-hirka_206739",
  "https://www.victoriassecret.com.tr/victoria-s-secret-saten-dantel-detayli-askili-bluz-ve-firfirli-sort-takimi-VS27291321",
  "https://www.boyner.com.tr/nike-if1448-010-m-nk-df-acd25-short-kp-b-siyah-erkek-sort-p-15917358",
  "https://wunder.com.tr/classic-england-polo-white-ubmw0502fa328-wth0001",
  "https://www.superstep.com.tr/urun/adidas-handball-spezial-kadin-bej-spor-ayakkabi/ki6678/",
  "https://shop.mango.com/tr/tr/p/kadın/etek/anvelop-kesim-sort-etek/27094095/99/00",
  "https://www.sephora.com.tr/p/yum-boujee-marshmallow--81---eau-de-parfum-intense-733611.html",
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
  // Specific listing URLs may be passed via argv; otherwise try them all.
  const argUrls = process.argv.filter((a) => a.startsWith("http"));
  const targets = argUrls.length ? argUrls : LISTINGS;
  for (const list of targets) {
    const scraper = getScraperForUrl(list);
    const brand = scraper?.brand ?? "?";
    console.log(`\n=== [${brand}] ${list}`);

    // If the URL itself is a product, scrape it directly; otherwise discover from the listing.
    let target: string | undefined;
    if (scraper?.parseUrl(list)) {
      target = list;
      console.log("  (direct product URL)");
    } else {
      let products: string[] = [];
      try {
        products = await discover(list);
      } catch (e) {
        console.log("  discovery error:", e instanceof Error ? e.message : e);
      }
      console.log(`  product links found: ${products.length}`);
      target = products[0];
    }

    if (!target) {
      console.log(
        "  → no product link found (bot block or different structure)",
      );
      continue;
    }
    console.log("  scrape:", target);
    try {
      const r = await checkUrl(target);
      console.log(
        "  RESULT:",
        JSON.stringify({
          source: r.source,
          name: r.name,
          price: r.price,
          currency: r.currency,
          inStock: r.inStock,
          sizes: r.sizes,
          colors: r.colors.length,
          colorVariants: r.colorVariants?.map((v) => ({
            color: v.color,
            hasUrl: !!v.url,
            hasImage: !!v.imageUrl,
            sizes: v.sizes?.length ?? 0,
            price: v.price,
          })),
        }),
      );
    } catch (e) {
      console.log("  scrape error:", e instanceof Error ? e.message : e);
    }
  }
  app.quit();
});
