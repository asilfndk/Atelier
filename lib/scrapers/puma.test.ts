import assert from "node:assert/strict";
import { test } from "node:test";
import { pumaProduct } from "./puma.ts";

const ORIGIN = "https://tr.puma.com";
const URL_ = `${ORIGIN}/teamgoal-erkek-sweatshirt-658592-03.html?beden=m`;

const img = (code: string) => [
  {
    img: `${ORIGIN}/media/catalog/product/cache/x/https:/images.puma.net/images/658592/${code}/mod01/fnd/TUR/`,
  },
];
const price = (amount: number) => ({ finalPrice: { amount } });

const CONFIG = {
  attributes: {
    "93": {
      code: "color",
      options: [
        // Out of stock in every size: no photos, so the analytics map gives its code.
        { label: "PUMA Navy", products: [], all_products: ["6", "7"] },
        {
          label: "Puma Black {Logo}",
          products: ["1", "2"],
          all_products: ["1", "2", "3"],
        },
        { label: "Medium Gray", products: ["4"], all_products: ["4", "5"] },
        // Another model of the group: no products on this page.
        { label: "Camo AOP", products: [], all_products: [] },
      ],
    },
    "141": {
      code: "size",
      options: [
        { label: "S", products: ["1"], all_products: ["1", "6"] },
        { label: "M", products: ["2", "4"], all_products: ["2", "4", "7"] },
        { label: "L", products: [], all_products: ["3", "5"] },
      ],
    },
  },
  optionPrices: { "1": price(1699), "2": price(1699), "4": price(1274) },
  images: { "1": img("03"), "2": img("03"), "4": img("33") },
};

const page = (config: unknown = CONFIG) => `
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization"}</script>
  <script type="application/ld+json">{"@type":"Product","name":"teamGOAL Erkek SWEATSHIRT","sku":"658592_03",
    "offers":{"@type":"Offer","priceCurrency":"TRY","price":"1699","availability":"https://schema.org/InStock"}}</script>
  <script type="text/x-magento-init">{"#product_addtocart_form":{"configurable":{
    "spConfig": ${JSON.stringify(config)},
    "gallerySwitchStrategy": "replace"}}}</script>
  <script>require(['x'], function (setProduct) { 'use strict'; setProduct({"658592_06":{"items":[{"color":"puma navy"}]},
    "658592_03":{"items":[{"color":"puma black {logo}"}]}}); });</script>`;

test("pumaProduct reads this color's sizes, price and photo", async () => {
  const p = pumaProduct(page(), URL_);
  assert.equal(p?.name, "teamGOAL Erkek SWEATSHIRT");
  assert.equal(p?.price, 1699);
  assert.equal(p?.currency, "TRY");
  assert.equal(p?.imageUrl, img("03")[0].img);
  assert.deepEqual(p?.sizes, [
    { label: "S", inStock: true },
    { label: "M", inStock: true },
    { label: "L", inStock: false },
  ]);
  assert.equal(p?.inStock, true);
});

test("pumaProduct lists every color, each with its own page", async () => {
  const p = pumaProduct(page(), URL_);
  assert.deepEqual(p?.colors, [
    "Puma Black {Logo}",
    "PUMA Navy",
    "Medium Gray",
  ]);
  const [own, navy, gray] = p?.colorVariants ?? [];
  // This page keeps its pinned size; the others get their own color code.
  assert.equal(own.url, URL_);
  assert.deepEqual(navy, {
    color: "PUMA Navy",
    url: `${ORIGIN}/teamgoal-erkek-sweatshirt-658592-06.html`,
    imageUrl: null,
    sizes: [
      { label: "S", inStock: false },
      { label: "M", inStock: false },
    ],
    price: null,
    inStock: false,
  });
  assert.equal(gray.url, `${ORIGIN}/teamgoal-erkek-sweatshirt-658592-33.html`);
  assert.equal(gray.price, 1274);
  assert.deepEqual(gray.sizes, [
    { label: "M", inStock: true },
    { label: "L", inStock: false },
  ]);
});

test("pumaProduct picks the color the URL names", async () => {
  const p = pumaProduct(
    page(),
    `${ORIGIN}/teamgoal-erkek-sweatshirt-658592-33.html`,
  );
  assert.equal(p?.price, 1274);
  assert.equal(p?.colors[0], "Medium Gray");
});

test("pumaProduct falls back to the JSON-LD offer without a configuration", async () => {
  const p = pumaProduct(page(null).replace('"spConfig"', '"other"'), URL_);
  assert.equal(p?.price, 1699);
  assert.deepEqual(p?.sizes, []);
  assert.equal(p?.inStock, true);
  assert.equal(pumaProduct("<html></html>", URL_), null);
});
