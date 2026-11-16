# Atelier

A multi-brand stock and price tracker for macOS, built as a menu-bar Electron app. Paste a product URL to check availability instantly, or add it to your watchlist and get a desktop notification when it comes back in stock or drops in price.

Atelier lives in the menu bar and never shows in the Dock (`LSUIElement`), so it keeps checking your products on a schedule while the window is closed.

## Supported stores

- **Inditex:** Zara · Bershka · Stradivarius · Pull & Bear · Lefties · Oysho · Massimo Dutti
- **Fashion:** Mango · Tommy Hilfiger · Levi's · Victoria's Secret · Les Benjamins · Wunder · Konfuse · Bushido · Boyner · Fashfed
- **Sport and outdoor:** Nike · Barçın · SneaksUp · Sportinn · Superstep · Intersport · SPX · The North Face · Columbia
- **Beauty:** Sephora · Gratis · Watsons

## Features

- **Instant check:** paste a supported product URL and see its name, price, photo, colors and per-size stock.
- **Watchlist:** track a product, optionally pinned to one color and size, with no duplicate entries.
- **Background checks:** every tracked product is re-checked on an interval you set, and once on launch.
- **Notifications:** a local alert when a product comes back in stock or its price drops.
- **Price history:** each check is recorded, so you can see how a product's price moved.
- **In-app updates:** new versions are downloaded from GitHub Releases and verified by checksum before installing.
- **Launch at login:** optional, from the settings panel.
- **Fully local:** all data lives in a local SQLite database. No servers, no accounts, no telemetry.

## Download

Get the latest `.dmg` from the [Releases](https://github.com/asilfndk/Atelier/releases/latest) page:

- **Apple Silicon:** `Atelier-<version>-arm64.dmg`
- **Intel:** `Atelier-<version>-x64.dmg`

The app is unsigned (no Apple Developer account). If macOS warns you on first launch, open **System Settings → Privacy & Security** and click **Open Anyway**. If notifications don't appear, see [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Development

Requires Node.js 22.18+ and npm.

```bash
npm install
echo 'DATABASE_URL=file:./data/app.db' > .env.local   # dev database; the packaged app uses userData/app.db
npm run dev                                           # Next dev server (port 3000) + Electron
```

| Command                  | Description                                             |
| ------------------------ | ------------------------------------------------------- |
| `npm run dev`            | Next dev server and Electron together                   |
| `npm run build`          | Build the renderer (`out/`) and main (`dist-electron/`) |
| `npm run dist`           | Package the macOS `.dmg` files (arm64 + x64)            |
| `npm run dist:arm64`     | Package one architecture (also `dist:x64`)              |
| `npm run lint`           | ESLint                                                  |
| `npm test`               | Unit tests (`node:test`)                                |
| `npm run check`          | Format, lint, types, unit tests, build, audit           |
| `npm run live-test`      | Scraper checks against the real stores                  |
| `npm run scheduler-test` | Scheduler and browser queue checks                      |
| `npm run release`        | Check, live-test, package, verify, publish              |
| `npm run db:generate`    | Generate a Drizzle migration after a schema change      |
| `npm run db:migrate`     | Apply migrations (dev)                                  |
| `npm run db:studio`      | Drizzle Studio                                          |

## Architecture

The renderer (Next.js, statically exported) never touches the database or the network. Data access and scraping run in the Electron main process; the renderer reaches them only over IPC, through the `window.api` bridge that `electron/preload.ts` exposes.

```
electron/        Main process (bundled by esbuild into dist-electron/)
  main.ts          Bootstrap: single-instance lock, window, tray, scheduler
  preload.ts       contextBridge → window.api (whitelisted IPC channels)
  ipc.ts           ipcMain.handle(...): every renderer call
  scheduler.ts     node-cron job, check rounds, notification triggers
  notifications.ts Native notifications
  updater.ts       In-app updates from GitHub Releases
  db-init.ts       Applies the bundled migrations on launch
app/             Next.js renderer: a single page
components/      CheckBar, ProductResult, StockMatrix, PriceHistory, Watchlist, SettingsPanel
lib/
  repo.ts          All database access (Drizzle); main process only
  scrapers/        One scraper per store
db/              Drizzle schema, migrations, better-sqlite3 connection
```

### Scraping

Every store is a `makeScraper({...})` entry in `lib/scrapers/index.ts`, and all share one `check()` flow (`lib/scrapers/simple.ts`):

1. **Layer 1, the store's own API** (the optional `api` function): the fast path. It returns `null` or throws when the store blocks it, and the check falls through.
2. **Layer 2, a hidden `BrowserWindow`:** loads the product page and runs the store's extraction script from `lib/scrapers/page-script.ts`. At most two windows are open at once.

Both layers are validated against one zod schema and return the same shape:

```ts
{
  name, price, currency, imageUrl, inStock,
  colors: string[],
  sizes: { label, inStock, price? }[],
  colorVariants?: { color, url?, imageUrl?, sizes?, price?, inStock? }[],
}
```

A third option, such as a jeans length, is encoded into the size label: `"32 · 34"`.

### Adding a store

1. Write the Layer-2 extraction script in `lib/scrapers/page-script.ts`. If the store has colors, return `colorVariants`, one per color with its own URL, so picking a color updates the photo, sizes and price.
2. Add a `makeScraper({ brand, hostname, script, parse })` entry to `lib/scrapers/index.ts`. If the store has a real internal API, add an `api` function in its own file (see `gratis.ts`, `nike.ts`, `levis.ts`) and add the brand to `PARITY` in `electron/live-test.ts`, so the live test compares the two layers. Akinon and ikas stores need only a few lines: see `barcin` and `konfuse`.
3. Add the brand to `BRANDS` in `db/schema.ts` and its label to `lib/brands.ts`. The UI's store list reads the labels; no migration is needed.
4. Add a product URL to `LISTINGS` in `electron/live-test.ts`, run `npm run live-test -- "<url>"`, and add the store to the list at the top of this file.

### Release

There is no CI; everything runs locally. `npm run release` publishes the version in `package.json` from a clean `main`: it runs `check` and both live tests, packages both DMGs outside iCloud Drive, verifies them, then tags, pushes and creates the GitHub release that the in-app updater reads. `npm run release -- --dry-run` stops before tagging and leaves the DMGs in a temp dir.

## Tech stack

- **Electron 45:** desktop shell (main and preload processes)
- **Next.js 16** (App Router): renderer only, statically exported
- **TypeScript**, **Tailwind CSS v4**, **lucide-react**
- **SQLite** (`better-sqlite3`) with **Drizzle ORM**, **zod** for scraper output
- **node-cron:** scheduled checks in the main process
- **esbuild:** bundles `electron/*.ts` into `dist-electron/`

## License

No license file is included; all rights are reserved by the author. This is a personal project.
