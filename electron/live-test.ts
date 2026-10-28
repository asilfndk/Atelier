import assert from "node:assert/strict";
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
  "https://www.nike.com/tr/t/jordan-flight-fleece-crew-yakali-erkek-sweatshirtu-FBZe06Sx/IW6368-010",
  "https://www.nike.com/tr/t/jordan-brooklyn-chore-erkek-ceketi-LOwsuQb8/IM8989-010",
  "https://www.nike.com/tr/t/jordan-flight-erkek-varsity-ceket-BlTKTrj7/IM9145-010",
  "https://www.nike.com/tr/t/air-jordan-1-retro-high-og-love-letter-erkek-ayakkabisi-BFqZfb/DZ5485-201",
  "https://www.barcin.com/nike-jordan-flt-wings-fleece-erkek-sweatshirt-siyah-siyah-beyaz/?integration_color_hash=Siyah-Siyah-Kırmızı",

  "https://www.zara.com/us/en/woman-dresses-l1066.html",
  // Bershka — direct product URL (listing pages expose no product links).
  "https://www.bershka.com/tr/büzgülü-askılı-midi-elbise-c0p229730044.html",
  // Stradivarius — direct product URL (itxrest detail arrives unwrapped).
  "https://www.stradivarius.com/tr/asimetrik-triko-kazak-l05065702",
  // Pull & Bear — direct product URLs (multi-color, unwrapped detail + bundled detail).
  "https://www.pullandbear.com/tr/keten-jogger-pantolon-l03671509?cS=717&pelement=744752801",
  "https://www.pullandbear.com/tr/leopar-desenli-baggy-jean-l07670372",
  // Lefties — direct product URL (multi-color jeans).
  "https://www.lefties.com/tr/en/woman/clothing/jeans/lightweight-striped-culotte-jeans-c1030267526p747880059.html?colorId=104&parentId=747884869",
  // Oysho — direct product URL (tapered pants).
  "https://www.oysho.com/tr/100-pamuklu-tapered-pantolon-l35681670?colorId=913&pelement=223465926",
  // Massimo Dutti — direct product URL (multi-color jean).
  "https://www.massimodutti.com/tr/yuksek-bel-genis-paca-jean-l05052852?pelement=61733754",
  // Les Benjamins — direct product URL (Shopify .js Layer-1 API).
  "https://lesbenjamins.com/collections/kadin-tisort/products/short-sleeve-tee-404-lb26ssclafuts-404",
  // Newer stores — direct product URLs (parseUrl matches → scraped directly).
  "https://www.sneaksup.com/new-balance-9060-lifestyle-womens-shoes-u9060blk-w-1",
  // SneaksUp — multi-color (colorways sharing a name → "GRİ (026)").
  "https://www.sneaksup.com/jordan-air-1-low-gs-553560-026-sneaker-p-253641",
  "https://tr.tommy.com/erkek-tjm-regular-textured-kazak_208537",
  "https://www.victoriassecret.com.tr/victoria-s-secret-saten-dantel-detayli-askili-bluz-ve-firfirli-sort-takimi-VS27291321",
  "https://www.boyner.com.tr/nike-if1448-010-m-nk-df-acd25-short-kp-b-siyah-erkek-sort-p-15917358",
  "https://wunder.com.tr/classic-england-polo-white-ubmw0502fa328-wth0001",
  "https://www.superstep.com.tr/urun/adidas-handball-spezial-kadin-bej-spor-ayakkabi/ki6678/",
  "https://shop.mango.com/tr/tr/p/kadın/etek/anvelop-kesim-sort-etek/27094095/99/00",
  "https://www.sephora.com.tr/p/yum-boujee-marshmallow--81---eau-de-parfum-intense-733611.html",
  "https://www.gratis.com/eyeliner/astra-subliminal-16-saat-dayanikli-yogun-siyah-pro-eyeliner-p-10209614",
  // Sportinn — T-Soft behind Cloudflare; colors are separate product pages
  // (the second lists colors by product name, and its own page is missing from them).
  "https://www.sportinn.com.tr/jordan-flight-wings-fleece-po-erkek-yesil-sweatshirt-im9191-321",
  "https://www.sportinn.com.tr/nike-tech-fleece-fz-wr-hoodie-erkek-yesil-sweatshirt-hv0949-382",
  // Watsons — re-navigates ~1s after load (exercises the re-run path).
  "https://www.watsons.com.tr/flormar-sheer-up-ruj-no-013-gaia/p/BP_1433768",
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
  let failures = 0;
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
      failures++;
      continue;
    }
    console.log("  scrape:", target);
    try {
      const r = await checkUrl(target);
      if (brand === "nike" || brand === "barcin") {
        assert(r.name && r.imageUrl && r.price != null && r.price > 0);
        assert.equal(r.currency, "TRY");
        assert(r.sizes.length > 0);
        assert.equal(new Set(r.sizes.map((s) => s.label)).size, r.sizes.length);
        assert.equal(
          r.inStock,
          r.sizes.some((s) => s.inStock),
        );
        assert(r.colorVariants?.length);
        const requestedColor = new URL(target).searchParams.get(
          "integration_color_hash",
        );
        if (requestedColor) assert.equal(r.colors[0], requestedColor);
        for (const variant of r.colorVariants) {
          assert(variant.url);
          assert.equal(new URL(variant.url).hostname, new URL(target).hostname);
          if (variant.imageUrl) {
            assert.deepEqual(variant.sizes, r.sizes);
            continue;
          }
          const selected = await checkUrl(variant.url);
          assert(
            selected.imageUrl &&
              selected.sizes.length &&
              selected.price != null,
          );
          assert(selected.colors.includes(variant.color));
          assert.deepEqual(
            selected.colorVariants?.find((v) => v.color === variant.color)
              ?.sizes,
            selected.sizes,
          );
        }
        console.log("  PASS: product, sizes and color-specific URLs/data");
      }
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
      failures++;
      console.log("  scrape error:", e instanceof Error ? e.message : e);
    }
  }
  app.exit(failures ? 1 : 0);
});
