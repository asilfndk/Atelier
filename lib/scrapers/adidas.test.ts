import assert from "node:assert/strict";
import { test } from "node:test";
import { adidasProduct } from "./adidas.ts";

const ORIGIN = "https://www.adidas.com.tr";
const URL_ = `${ORIGIN}/tr/adiracer-lo-ayakkabi/KJ1188.html?pr=product_rr`;

const PRODUCT = {
  id: "KJ1188",
  name: "ADIRACER LO AYAKKABI",
  attribute_list: { color: "Core Black" },
  pricing_information: { currentPrice: 5752, standard_price: 8849 },
  view_list: [{ image_url: "https://assets.adidas.com/a.jpg" }],
  variation_list: [
    { sku: "KJ1188_600", size: "35 1/2" },
    { sku: "KJ1188_610", size: "36" },
  ],
  product_link_list: [
    {
      type: "color-variation",
      productId: "KJ1187",
      url: "/tr/adiracer-lo-ayakkabi/KJ1187.html",
      image: "https://assets.adidas.com/b.jpg",
      default_color: "Cloud White",
      pricing_information: { standard_price: 8849, sale_price: 4679 },
    },
    {
      type: "color-variation",
      productId: "JR4543",
      url: "/tr/adiracer-lo-ayakkabi/JR4543.html",
      default_color: "Core Black",
      pricing_information: { standard_price: 3149 },
    },
    {
      type: "color-variation",
      productId: "X1",
      url: "https://evil.example/X1.html",
      default_color: "Red",
    },
    {
      type: "similar",
      productId: "X2",
      url: "/tr/x/X2.html",
      default_color: "Blue",
    },
  ],
};

const AVAILABILITY = {
  availability_status: "IN_STOCK",
  variation_list: [
    { sku: "KJ1188_600", availability_status: "NOT_AVAILABLE" },
    { sku: "KJ1188_610", availability_status: "IN_STOCK" },
  ],
};

/** Serves the product and availability endpoints the page calls */
const store =
  (product: unknown, availability: unknown = AVAILABILITY) =>
  async (url: string) => {
    const path = new URL(url).pathname;
    if (path === "/api/products/KJ1188") return product;
    if (path === "/api/products/KJ1188/availability") return availability;
    throw new Error(`unexpected ${url}`);
  };

test("adidasProduct reads name, price, photo and per-size stock", async () => {
  const p = await adidasProduct(
    URL_,
    store({ ...PRODUCT, product_link_list: [] }),
  );
  assert.equal(p?.name, "ADIRACER LO AYAKKABI");
  assert.equal(p?.price, 5752);
  assert.equal(p?.currency, "TRY");
  assert.equal(p?.imageUrl, "https://assets.adidas.com/a.jpg");
  assert.deepEqual(p?.colors, ["Core Black"]);
  assert.deepEqual(p?.sizes, [
    { label: "35 1/2", inStock: false },
    { label: "36", inStock: true },
  ]);
  assert.equal(p?.inStock, true);
  assert.equal(p?.colorVariants, undefined);
});

test("adidasProduct lists the other colors, each its own page", async () => {
  const p = await adidasProduct(URL_, store(PRODUCT));
  // Two colorways share "Core Black": the article code tells them apart.
  assert.deepEqual(p?.colors, [
    "Core Black (KJ1188)",
    "Cloud White",
    "Core Black (JR4543)",
  ]);
  const [own, white, black] = p?.colorVariants ?? [];
  assert.equal(own.url, URL_);
  assert.equal(own.sizes?.length, 2);
  assert.deepEqual(white, {
    color: "Cloud White",
    url: `${ORIGIN}/tr/adiracer-lo-ayakkabi/KJ1187.html`,
    imageUrl: "https://assets.adidas.com/b.jpg",
    price: 4679,
  });
  assert.equal(black.price, 3149);
});

test("adidasProduct falls back to the product status without sizes", async () => {
  const oneSize = { ...PRODUCT, variation_list: [], product_link_list: [] };
  const p = await adidasProduct(URL_, store(oneSize));
  assert.deepEqual(p?.sizes, []);
  assert.equal(p?.inStock, true);
  const soldOut = await adidasProduct(
    URL_,
    store(PRODUCT, {
      availability_status: "NOT_AVAILABLE",
      variation_list: [],
    }),
  );
  assert.equal(soldOut?.inStock, false);
  assert.equal(await adidasProduct(URL_, store({})), null);
  assert.equal(await adidasProduct(`${ORIGIN}/tr/erkek`, store(PRODUCT)), null);
});
