import assert from "node:assert/strict";
import { test } from "node:test";
import { levisProduct } from "./levis.ts";

const ORIGIN = "https://www.levis.com.tr";
const URL_ = `${ORIGIN}/502-taper-erkek-jean-pantolon-breaking-news_126301`;

const li = (kind: string, n: number, spec: string, label: string, stock = 1) =>
  `<li data-item-sizedrop data-js="${kind}-item" data-spec${n}="${spec}" title="${label}" data-stock="${stock}" data-value="${label}" class="visible">${label}</li>`;

const page = (o: { code?: string; lengths?: boolean; sizes?: boolean }) => `
  <meta property="og:image" content="https://st-levis.mncdn.com/a.jpg" />
  <meta property="og:title" content="502&#174; Taper Erkek Jean Pantolon - Breaking News" />
  <script>
    data = { "name": "30", "stock": parseInt('7') }
    window.insider_object.product = { "currency": "TRY", "unit_price": 3999.90,
      "unit_sale_price": 2399.90, "stock": 9, "color": "Gri" }
  </script>
  <p> Renk : <span>&#199;ok Renkli</span> </p>
  <div class="p-alternate" data-js="p-alternate" data-code="${o.code ?? ""}" data-id="126301"> </div>
  <input id="ProductDescriptionId" name="ProductDescriptionId" type="hidden" value="126301" />
  ${o.sizes === false ? "" : li("size", 2, "1", "30", 7) + li("size", 2, "2", "38", 2)}
  ${o.lengths ? li("drop", 3, "1", "30") + li("drop", 3, "3", "32") : ""}`;

const VARIANTS = `<ul class="list-p-alternate">
  <li class="" data-id="126301" title="502™ Taper Erkek Jean Pantolon - Breaking News">
    <a href="/502-taper-erkek-jean-pantolon-breaking-news_126301"><img src="x.png" /></a></li>
  <li class="" data-id="125963" title="502™ Taper Linen+ Erkek Jean Pantolon">
    <a href="/502-taper-linen_125963"><img src="y.jpg" /></a></li>
  <li class="" data-id="125898" title="502™ Taper Linen+ Erkek Jean Pantolon">
    <a href="/502-taper-linen_125898"><span>Siyah</span></a></li>
  <li class="" data-id="1" title="Off-site"><a href="https://evil.example/x_1"></a></li>
</ul>`;

/** Serves the page and the two AJAX endpoints its script calls */
const store = (html: string) => async (url: string) => {
  const u = new URL(url, ORIGIN);
  if (u.pathname === "/urun/getotherproducts/") return VARIANTS;
  if (u.pathname !== "/lookup/getstockcountbysecondspecid") return html;
  return JSON.stringify({
    data:
      u.searchParams.get("secondSpecId") === "1"
        ? ["1-30-0"] // length 30: only waist 30, sold out
        : ["1-30-7", "2-38-2"],
  });
};

test("levisProduct reads sizes, price and color from the page", async () => {
  const p = await levisProduct(URL_, store(page({})));
  assert.equal(p?.name, "502® Taper Erkek Jean Pantolon - Breaking News");
  assert.equal(p?.price, 2399.9);
  assert.equal(p?.currency, "TRY");
  assert.equal(p?.imageUrl, "https://st-levis.mncdn.com/a.jpg");
  assert.deepEqual(p?.colors, ["Çok Renkli"]);
  assert.deepEqual(p?.sizes, [
    { label: "30", inStock: true },
    { label: "38", inStock: true },
  ]);
  assert.equal(p?.colorVariants, undefined);
});

test("levisProduct encodes the jeans length into the size label", async () => {
  const p = await levisProduct(URL_, store(page({ lengths: true })));
  assert.deepEqual(p?.sizes, [
    { label: "30 · 30", inStock: false },
    { label: "30 · 32", inStock: true },
    { label: "38 · 32", inStock: true },
  ]);
  assert.equal(p?.inStock, true);
});

test("levisProduct lists the other colors, each its own page", async () => {
  const p = await levisProduct(URL_, store(page({ code: "29507" })));
  assert.deepEqual(p?.colors, [
    "Breaking News",
    "502™ Taper Linen+ Erkek Jean Pantolon (125963)",
    "502™ Taper Linen+ Erkek Jean Pantolon (125898)",
  ]);
  const [own, other] = p?.colorVariants ?? [];
  assert.equal(own.url, URL_);
  assert.equal(own.sizes?.length, 2);
  assert.deepEqual(other, {
    color: "502™ Taper Linen+ Erkek Jean Pantolon (125963)",
    url: `${ORIGIN}/502-taper-linen_125963`,
  });
});

test("levisProduct falls back to the product stock without sizes", async () => {
  const p = await levisProduct(URL_, store(page({ sizes: false })));
  assert.deepEqual(p?.sizes, []);
  assert.equal(p?.inStock, true);
  assert.equal(await levisProduct(URL_, store("<html></html>")), null);
});
