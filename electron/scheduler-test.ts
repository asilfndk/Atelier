// End-to-end check of scheduler ordering (API rows first), the per-round URL
// memo, joined rounds and interactive browser-queue priority, on a temp DB.
// Hits live stores like live-test.ts; run it the same way (see CLAUDE.md).
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "electron";

process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "atelier-")), "t.db")}`;
app.on("window-all-closed", () => {});

const t0 = Date.now();
const events: { t: number; kind: "fetch" | "window"; url: string }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  events.push({ t: Date.now() - t0, kind: "fetch", url: decodeURI(url) });
  return realFetch(input, init);
}) as typeof fetch;
app.on("browser-window-created", (_e, w) =>
  w.webContents.on("did-start-navigation", (d) => {
    if (
      d.isMainFrame &&
      !d.isSameDocument &&
      !events.some((e) => e.url === d.url)
    )
      events.push({
        t: Date.now() - t0,
        kind: "window",
        url: decodeURI(d.url),
      });
  }),
);

const API = [
  "https://www.nike.com/tr/t/jordan-brooklyn-chore-erkek-ceketi-LOwsuQb8/IM8989-010",
  "https://www.gratis.com/eyeliner/astra-subliminal-16-saat-dayanikli-yogun-siyah-pro-eyeliner-p-10209614",
  "https://wunder.com.tr/classic-england-polo-white-ubmw0502fa328-wth0001",
];
const BROWSER = [
  "https://www.sportinn.com.tr/jordan-flight-wings-fleece-po-erkek-yesil-sweatshirt-im9191-321",
  "https://www.sportinn.com.tr/nike-tech-fleece-fz-wr-hoodie-erkek-yesil-sweatshirt-hv0949-382",
  "https://www.watsons.com.tr/flormar-sheer-up-ruj-no-013-gaia/p/BP_1433768",
  "https://shop.mango.com/tr/tr/p/kadın/etek/anvelop-kesim-sort-etek/27094095/99/00",
];
const first = (needle: string, kind?: "fetch" | "window") =>
  events.find((e) => (!kind || e.kind === kind) && e.url.includes(needle))?.t ??
  -1;
const key = (u: string) =>
  new URL(u).pathname.split("/").filter(Boolean).pop()!;

app
  .whenReady()
  .then(async () => {
    const { runMigrations } = await import("./db-init");
    runMigrations();
    const repo = await import("@/lib/repo");
    const { getScraperForUrl, checkUrl } = await import("@/lib/scrapers");
    const { checkAll } = await import("./scheduler");
    const track = (url: string, targetSize: string | null = null) => {
      const s = getScraperForUrl(url)!;
      repo.trackProduct({
        url,
        brand: s.brand,
        productId: s.parseUrl(url)!.productId,
        targetSize,
      });
    };
    // API rows oldest: listProducts is newest-first, so without the sort they'd queue last.
    API.forEach((u) => track(u));
    BROWSER.forEach((u) => track(u));
    track(BROWSER[0], "M"); // same URL, other size → must reuse the scrape

    // --- one scheduler round
    const round = checkAll();
    assert.equal(checkAll(), round, "Check now must join the running round");
    await round;
    const api = API.map((u) =>
      first(getScraperForUrl(u)!.parseUrl(u)!.productId, "fetch"),
    );
    const br = BROWSER.map((u) => first(key(u), "window"));
    console.log(
      `round ${Date.now() - t0}ms  api starts ${api}  browser starts ${br}`,
    );
    assert(
      api.every((t) => t >= 0),
      "every API row must hit its API",
    );
    assert(
      Math.max(...api) <= Math.min(...br.filter((t) => t >= 0)),
      "API rows must start before browser rows",
    );
    const dup = events.filter(
      (e) => e.kind === "window" && e.url.includes(key(BROWSER[0])),
    ).length;
    assert.equal(dup, 1, `same URL scraped ${dup}x in one round`);
    for (const p of repo.listProducts())
      assert(p.lastCheckedAt, `#${p.id} not checked`);
    console.log(
      "PASS scheduler: Check now joins the round, API rows first, one scrape per URL",
    );

    // --- interactive check jumps queued background scrapes (2 browser slots)
    events.length = 0;
    const bg = [BROWSER[2], BROWSER[3], BROWSER[1]].map((u) =>
      checkUrl(u).catch(() => null),
    );
    await new Promise((r) => setTimeout(r, 100));
    await Promise.all([...bg, checkUrl(BROWSER[0], true)]);
    const order = events
      .filter((e) => e.kind === "window")
      .map((e) => key(e.url));
    console.log("window order", order.join(" → "));
    assert(
      order.indexOf(key(BROWSER[0])) < order.indexOf(key(BROWSER[1])),
      "interactive must start before queued background",
    );
    console.log("PASS queue: interactive check jumped the queue");
    app.exit(0);
  })
  .catch((e) => {
    console.log("FAIL", e instanceof Error ? e.message : e);
    app.exit(1);
  });
