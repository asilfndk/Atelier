# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

# Atelier — Çok Markalı Stok Takip Uygulaması

Birden çok mağazanın (Inditex: Zara/Bershka/Stradivarius + SneaksUp, Tommy Hilfiger,
Victoria's Secret, Boyner, Wunder, Superstep) ürünlerinin stok ve fiyat durumunu
takip eden bir **Electron masaüstü uygulaması** ("Atelier"). Kullanıcı bir ürün URL'si
girip anlık kontrol yapar; ürünü takibe alarak stok geldiğinde veya fiyat düştüğünde
yerel masaüstü bildirimi alır. Uygulama yalnızca menü çubuğunda (Dock'ta görünmez,
`LSUIElement`) çalışır; pencere kapansa bile tray'de kalıp arka planda periyodik
kontrol yapar. Beden/renk bazlı filtreleme desteklenir.

> **Önemli:** Bu artık bir web uygulaması değil. Firecrawl, Web Push ve `app/api/*`
> route handler'ları **kaldırıldı**. Veri katmanı Electron main sürecinde çalışır;
> renderer (Next.js) ona yalnızca IPC üzerinden (`window.api.*`) erişir.

## Teknoloji Yığını

- **Electron 41** — masaüstü kabuğu, main + preload süreçleri
- **Next.js 16** (App Router) — yalnızca renderer; `output: "export"` ile statik HTML (`out/`)
- **TypeScript** · **Tailwind CSS v4** · **framer-motion** · **lucide-react**
- **SQLite** (`better-sqlite3`, native) + **Drizzle ORM**
- **node-cron** — main sürecinde periyodik stok kontrolü
- **esbuild** — `electron/*.ts` → `dist-electron/*.js` (CJS) bundle

## Komutlar

| Komut | Açıklama |
|---|---|
| `npm run dev` | Next dev (3000) + electron'u birlikte başlatır (`concurrently`) |
| `npm run build` | `build:next` (→ `out/`) + `build:electron` (→ `dist-electron/`) |
| `npm run dist` | macOS `.dmg` paketle — **arm64 + x64 ayrı ayrı** (`electron-builder --mac`) |
| `npm run dist:arm64` / `npm run dist:x64` | Tek mimari `.dmg` paketle (hızlı/izole build) |
| `npm run rebuild` | `better-sqlite3`'ü Electron ABI'sine göre yeniden derle (native hata alınca) |
| `npm run lint` | ESLint |
| `npm run db:generate` | Drizzle migration üret (şema değişince) |
| `npm run db:migrate` | Migration uygula (geliştirme; üretimde main süreci otomatik uygular) |
| `npm run db:studio` | Drizzle Studio |

> Bu ortamda `pnpm` ve `docker` kurulu değil; tüm komutlar `npm` ile.
> `better-sqlite3` native bir modüldür: Electron sürümü/Node ABI değişirse
> `npm run rebuild` gerekir. esbuild `electron` ve `better-sqlite3`'ü external bırakır.

## Mimari

```
electron/                Main süreç (esbuild ile bundle → dist-electron/)
  main.ts                App bootstrap: tek-örnek kilidi, pencere, tray, scheduler
  preload.ts             contextBridge → window.api (beyaz listeli IPC kanalları)
  ipc.ts                 ipcMain.handle(...) — renderer'dan gelen tüm çağrılar
  scheduler.ts           node-cron job + checkAll/checkOne + bildirim tetikleme
  notifications.ts       Yerel Notification + macOS dock rozeti
  db-init.ts             Migration'ları dev + paketlenmiş .app içinde bulur/uygular
  app-state.ts           mainWindow referansı + "products-changed" yayını
  tray.ts | autolaunch.ts | live-test.ts
app/                     Next.js renderer (statik export). Tek sayfa: page.tsx
components/              CheckBar, ProductResult, Watchlist, StockMatrix, SettingsPanel
lib/
  client-api.ts          getApi()/hasApi() — window.api köprüsüne güvenli erişim
  repo.ts                Tüm DB erişimi (Drizzle sorguları) — sadece main tarafında
  brands.ts              Marka etiketleri + fiyat/zaman biçimleme (renderer-safe)
  scrapers/
    base.ts              BaseScraper: Katman 1 (iç API) → Katman 2 (BrowserWindow)
    browser.ts           Gizli BrowserWindow ile scraping + normalizeRaw + zod doğrulama
    page-script.ts       Sayfa içinde çalışan DOM/JSON-LD çıkarım scriptleri (string):
                         JSONLD_PAGE_SCRIPT (Inditex), ZARA_PAGE_SCRIPT,
                         GENERIC_PAGE_SCRIPT (Inditex dışı TR siteleri için)
    zara.ts|bershka.ts|stradivarius.ts   Inditex marka-özel parseUrl/fetchFromApi/pageScript
    sneaksup.ts|tommy.ts|victoriassecret.ts|boyner.ts|wunder.ts|superstep.ts
                         Diğer mağazalar — GENERIC_PAGE_SCRIPT kullanır
    index.ts             URL→scraper eşlemesi + checkUrl()
db/
  schema.ts              Drizzle tabloları + BRANDS sabiti
  index.ts               better-sqlite3 bağlantısı (DATABASE_URL'den yol, WAL)
  migrations/            drizzle-kit çıktısı (paketlenmişte extraResource olarak kopyalanır)
```

### Süreç sınırı (en kritik kural)

- **`db/`, `lib/repo.ts`, `lib/scrapers/*` yalnızca Electron MAIN sürecinde çalışır.**
  `better-sqlite3` ve `BrowserWindow` renderer'da yoktur. Bunları `app/` veya
  `components/` içinden import **etme**.
- Renderer ↔ main köprüsü tek noktadır: `electron/preload.ts` `window.api`'yi açar,
  `lib/client-api.ts` ona erişir. Yeni bir yetenek eklemek = (1) `ipc.ts`'e
  `ipcMain.handle`, (2) `preload.ts`'e kanal, (3) `types/global.d.ts`'e tip.
- Tip paylaşımı `types/global.d.ts` üzerinden yapılır (renderer ham DB modüllerini
  import edemediği için `ScrapeResult`/`TrackedProduct` oradan re-export edilir).

### Veri akışı

1. Kullanıcı URL yapıştırır → `page.tsx` → `getApi().checkUrl(url)` → IPC `check-url`
   → `lib/scrapers/index.ts:checkUrl` → marka scraper'ı `check()`.
2. Takibe alma → IPC `track` → `repo.trackProduct` (url+beden+renk benzersiz; çift kayıt yok).
3. `scheduler.ts` cron ile `checkAll()` çalıştırır: her ürün için `checkUrl`, durum
   geçişini hesaplar (`effectiveInStock`), yok→var veya fiyat düşüşünde bildirim atar,
   `recordCheck` ile `check_history`'ye yazar, dock rozetini ve renderer'ı tazeler.
4. Main, liste değişince `emitProductsChanged()` → `products-changed` IPC olayı yayar;
   renderer `onProductsChanged` ile otomatik yenilenir.

## Scraping Mantığı (Hibrit, iki katman)

Her marka scraper'ı `BaseScraper`'ı extend eder; `check()` ortak akışı yürütür:

1. **Katman 1 — İç REST API** (`fetchFromApi`): hızlı yol. Başarısız/desteklenmiyorsa
   `null` döndür → katman 2'ye düşülür. (Zara şu an Akamai nedeniyle hep `null`.)
2. **Katman 2 — Gizli `BrowserWindow`** (`browser.ts`): gerçekçi header/User-Agent ile
   sayfayı yükler, `pageScript()` string'ini sayfa içinde çalıştırır (JSON-LD/DOM okur),
   `normalizeRaw` + `productStockSchema` (zod) ile doğrular. Eşzamanlılık 2 ile sınırlı.

Tüm scraper'lar ortak `ProductStock` döndürür:
`{ name, price, currency, imageUrl, colors[], sizes[{label, inStock}], inStock }`
(`check()` buna `source: "api" | "browser"` ekleyip `ScrapeResult` döndürür.)

### Yeni Marka Scraper'ı Ekleme

1. `lib/scrapers/<marka>.ts` oluştur, `BaseScraper`'ı extend et; `brand`, `canHandle`,
   `parseUrl`, `fetchFromApi`, `pageScript` implemente et.
2. Katman 2 çıkarım scriptini `lib/scrapers/page-script.ts`'e ekle.
3. `db/schema.ts`'teki `BRANDS` dizisine markayı ekle (+ `lib/brands.ts` etiketi).
4. `lib/scrapers/index.ts`'teki `scrapers[]` listesine kaydet.

## Veritabanı Notları

- Üç tablo: `tracked_products`, `settings` (tek satır id=1), `check_history`
  (`tracked_products`'a `onDelete: cascade`).
- Üretimde DB yolu **runtime'da** `main.ts` tarafından `userData/app.db`'ye sabitlenir
  (`process.env.DATABASE_URL` ayarlandıktan **sonra** db'ye dokunan modüller import edilir
  — main.ts'teki sıralamayı bozma). Dev'de `.env.local`'daki `DATABASE_URL` (örn.
  `file:./data/app.db`) kullanılır.
- Şema değişince: `npm run db:generate` → migration `db/migrations/`'a düşer; paketlenmiş
  uygulamada `electron-builder.yml` bunu extraResource olarak kopyalar, `db-init.ts`
  açılışta uygular.

## Ortam Değişkenleri (.env.local, sadece dev)

- `DATABASE_URL` — SQLite dosya yolu (örn. `file:./data/app.db`). Üretimde main override eder.
- `CHECK_INTERVAL_CRON` — varsayılan `*/15 * * * *` (ayar DB'de tutulur, `settings.checkIntervalCron`).
