# Atelier

A multi-brand stock & price tracker for macOS, built as a menu-bar Electron app. Paste a product URL to check availability instantly, or add it to your watchlist to get a native desktop notification the moment it comes back in stock or drops in price.

Atelier lives in the menu bar (it never shows in the Dock — `LSUIElement`), so it keeps running in the background and checking your products on a schedule even when the window is closed. Size- and color-level filtering is supported.

## Supported stores

|             |                                                                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inditex** | Zara · Bershka · Stradivarius · Pull & Bear · Lefties · Oysho · Massimo Dutti                                                                               |
| **Others**  | Nike · Barçın · Mango · Sephora · SneaksUp · Sportinn · Tommy Hilfiger · Victoria's Secret · Boyner · Wunder · Superstep · Gratis · Watsons · Les Benjamins |

## Features

- **Instant check** — paste any supported product URL and see name, price, image, colors, and per-size stock.
- **Watchlist** — track a product (optionally pinned to a specific size/color) with no duplicate entries.
- **Background monitoring** — a `node-cron` job re-checks every tracked product on a configurable interval.
- **Smart notifications** — local desktop alerts on out-of-stock → in-stock transitions and on price drops, with a macOS Dock badge.
- **Size/color filtering** — track exactly the variant you care about.
- **Live "last checked" counter** and instant re-check on launch or interval change.
- **Fully local** — all data lives in a local SQLite database; no servers, no accounts, no telemetry.

## Download

Grab the latest `.dmg` from the [**Releases**](https://github.com/asilfndk/Atelier/releases/latest) page:

- **Apple Silicon (M1/M2/M3…):** `Atelier-<version>-arm64.dmg`
- **Intel Macs:** `Atelier-<version>-x64.dmg`

> The app is distributed unsigned (no Apple Developer account). On first launch macOS may warn you — open **System Settings → Privacy & Security** and click **"Open Anyway"**.

## Tech stack

- **Electron 45** — desktop shell (main + preload processes)
- **Next.js 16** (App Router) — renderer only, statically exported (`output: "export"`)
- **TypeScript** · **Tailwind CSS v4** · **framer-motion** · **lucide-react**
- **SQLite** (`better-sqlite3`) + **Drizzle ORM**
- **node-cron** — scheduled checks in the main process
- **esbuild** — bundles `electron/*.ts` → `dist-electron/*.js`

## Architecture

The renderer (Next.js) never touches the database or the network directly. All data access and scraping run in the **Electron main process**; the renderer reaches them only over IPC via a `window.api` bridge exposed by `electron/preload.ts`.

```
electron/      Main process (bundled by esbuild → dist-electron/)
  main.ts        Bootstrap: single-instance lock, window, tray, scheduler
  preload.ts     contextBridge → window.api (whitelisted IPC channels)
  ipc.ts         ipcMain.handle(...) — all renderer calls
  scheduler.ts   node-cron job + checkAll/checkOne + notification triggers
  notifications.ts  Native Notification + macOS dock badge
app/           Next.js renderer (static export) — single page
components/     CheckBar, ProductResult, Watchlist, StockMatrix, SettingsPanel
lib/
  repo.ts        All DB access (Drizzle) — main process only
  scrapers/      Per-brand scrapers (hybrid: internal API → hidden BrowserWindow)
db/            Drizzle schema, migrations, better-sqlite3 connection
```

### Scraping (two-layer hybrid)

Every brand is a `makeScraper({...})` config in `lib/scrapers/index.ts`, and all share one `check()` flow (`lib/scrapers/simple.ts`):

1. **Layer 1 — internal REST API** (the optional `api` function): the fast path. Returns `null` (or throws) when unsupported/blocked, falling through to layer 2.
2. **Layer 2 — hidden `BrowserWindow`**: loads the page with realistic headers, runs an in-page extraction script (JSON-LD / DOM), then validates the result with a zod schema. Concurrency is capped at 2.

All scrapers return a common shape:
`{ name, price, currency, imageUrl, colors[], sizes[{ label, inStock }], inStock }`.

## Development

> Requires Node.js 22.18+ and npm.

```bash
npm install
npm run dev      # Next dev server (3000) + Electron together
```

Create a `.env.local` for development:

```bash
DATABASE_URL=file:./data/app.db   # SQLite path (production overrides this to userData/app.db)
CHECK_INTERVAL_CRON=*/15 * * * *  # default check interval (also stored in settings)
```

### Build & package

```bash
npm run build          # build:next (→ out/) + build:electron (→ dist-electron/)
npm run dist           # package macOS .dmg — arm64 + x64
npm run dist:arm64     # single-arch .dmg (faster / isolated)
npm run dist:x64
```

### Scripts

| Command               | Description                                   |
| --------------------- | --------------------------------------------- |
| `npm run dev`         | Next dev + Electron together (`concurrently`) |
| `npm run build`       | Build renderer + main                         |
| `npm run dist`        | Package macOS `.dmg` (arm64 + x64)            |
| `npm run lint`        | ESLint                                        |
| `npm test`            | Unit tests (`node:test`)                      |
| `npm run db:generate` | Generate a Drizzle migration                  |
| `npm run db:migrate`  | Apply migrations (dev)                        |
| `npm run db:studio`   | Drizzle Studio                                |

### CI/CD

- **CI** (`.github/workflows/ci.yml`): formatting, lint, types, unit tests, build and `npm audit` on every push to `main` and every PR.
- **Release** (`.github/workflows/release.yml`): pushing a `vX.Y.Z` tag that matches `package.json` runs CI and the live tests, builds and verifies both DMGs, then publishes the GitHub release the in-app updater reads. Run it manually for a dry run that only uploads artifacts.
- **Live tests** (`.github/workflows/live.yml`): real-store scraper and scheduler checks, nightly and on pushes touching scrapers, the scheduler or the lockfile. Separate from CI so a store outage can't block everyday pushes; a release does wait for them.
- **Dependabot** opens weekly PRs for npm packages and GitHub Actions.

### Adding a new store scraper

1. Add the layer-2 extraction script to `lib/scrapers/page-script.ts`. If the site has color variants, emit `colorVariants` (one per color, with its own URL) so picking a color updates image/sizes/price.
2. Register the brand with a `makeScraper({ brand, hostname, script, parse })` entry in the `scrapers[]` list in `lib/scrapers/index.ts`. When the store has a real internal API, add an `api` function in its own file (see `gratis.ts`, `nike.ts`, `boyner.ts`), and add the brand to `PARITY` in `electron/live-test.ts` so the live test checks it against layer 2.
3. Add the brand to `BRANDS` in `db/schema.ts` and a label in `lib/brands.ts`. The UI's store list reads these labels, and no migration is needed.
4. Add a product URL to `LISTINGS` in `electron/live-test.ts` and run the live-test harness against it.

## License

No license file is currently included — all rights reserved by the author. This is a personal project for educational/personal use.
