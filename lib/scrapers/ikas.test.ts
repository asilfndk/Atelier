import assert from "node:assert/strict";
import { test } from "node:test";
import { ikasProduct } from "./ikas.ts";

const COLOR = {
  id: "c",
  name: "Renk",
  selectionType: "COLOR",
  values: [
    { id: "siyah", name: "Siyah" },
    { id: "kirmizi", name: "Kırmızı" },
  ],
};
const SIZE = {
  id: "s",
  name: "Beden",
  selectionType: "CHOICE",
  values: [
    { id: "xs", name: "XS" },
    { id: "m", name: "M" },
  ],
};

const variant = (
  color: string | null,
  size: string | null,
  stock: number,
  extra: object = {},
) => ({
  isActive: true,
  stock,
  sellIfOutOfStock: false,
  prices: [{ sellPrice: 100, discountPrice: null, currency: "TRY" }],
  images: [{ imageId: `img-${color}`, isMain: true, isVideo: false }],
  variantValues: [
    ...(color ? [{ name: color, variantTypeId: "c" }] : []),
    ...(size ? [{ name: size, variantTypeId: "s" }] : []),
  ],
  ...extra,
});

const page = (product: object) => ({
  props: {
    pageProps: {
      pageType: "PRODUCT",
      configJson: { merchantSettings: { merchantId: "m1" } },
      pageSpecificData: { name: " Tişört ", ...product },
    },
  },
});

const colored = page({
  variantTypes: [{ variantType: COLOR }, { variantType: SIZE }],
  selectedVariantValues: [{ id: "kirmizi" }],
  variants: [
    variant("Siyah", "XS", 0, { id: "s-xs" }),
    variant("Siyah", "M", 0, { id: "s-m" }),
    variant("Kırmızı", "XS", 3, { id: "k-xs" }),
    variant("Kırmızı", "M", 0, { id: "k-m" }),
  ],
});
const URL_ = "https://shop.example/tisort";

test("ikasProduct follows the requested color, even when sold out", () => {
  const r = ikasProduct(colored, `${URL_}?renk=siyah&beden=xs`);
  assert.equal(r.name, "Tişört");
  assert.deepEqual(r.colors, ["Siyah", "Kırmızı"]);
  assert.equal(r.inStock, false);
  assert.deepEqual(
    r.sizes.map((s) => [s.label, s.inStock]),
    [
      ["XS", false],
      ["M", false],
    ],
  );
  assert.equal(
    r.imageUrl,
    "https://cdn.myikas.com/images/m1/img-Siyah/image_1080.webp",
  );
});

test("ikasProduct embeds every color and defaults to the page's selection", () => {
  const r = ikasProduct(colored, URL_);
  assert.equal(r.colors[0], "Kırmızı");
  assert.equal(r.inStock, true);
  assert.equal(r.colorVariants?.[1].inStock, false);
  assert.equal(r.colorVariants?.[1].sizes?.length, 2);
  assert.match(r.colorVariants?.[1].imageUrl ?? "", /img-Siyah/);
});

test("ikasProduct's color URLs open that color on the store and in a re-check", () => {
  const r = ikasProduct(colored, URL_);
  // The store ignores ?renk= unless every variant type is in the URL; ?vid= always works.
  assert.equal(r.colorVariants?.[0].url, `${URL_}?renk=kirmizi&vid=k-xs`);
  assert.equal(r.colorVariants?.[1].url, `${URL_}?renk=siyah&vid=s-xs`);
  for (const c of r.colorVariants ?? []) {
    assert.equal(ikasProduct(colored, c.url ?? "").colors[0], c.color);
  }
  // A dead variant id must not move a tracked row to another color.
  assert.equal(
    ikasProduct(colored, `${URL_}?renk=siyah&vid=gone`).colors[0],
    "Siyah",
  );
});

test("ikasProduct matches a Turkish color however the URL spells it", () => {
  for (const q of ["kirmizi", "k%C4%B1rm%C4%B1z%C4%B1", "KIRMIZI"]) {
    assert.equal(
      ikasProduct(colored, `${URL_}?renk=${q}`).colors[0],
      "Kırmızı",
    );
  }
});

test("ikasProduct refuses a color the product doesn't have", () => {
  assert.throws(
    () => ikasProduct(colored, `${URL_}?renk=mor`),
    /requested color is missing/,
  );
});

test("ikasProduct's price doesn't move when only the stock does", () => {
  const priced = (goldStock: number) =>
    ikasProduct(
      page({
        variantTypes: [{ variantType: SIZE }],
        variants: [
          variant(null, "XS", goldStock, {
            prices: [{ sellPrice: 2899, currency: "TRY" }],
          }),
          variant(null, "M", 1, {
            prices: [{ sellPrice: 2499, currency: "TRY" }],
          }),
        ],
      }),
      URL_,
    ).price;
  assert.equal(priced(1), 2499);
  assert.equal(priced(0), 2499);
});

test("ikasProduct reads the color from a ?vid= variant link", () => {
  const linked = page({
    variantTypes: [{ variantType: COLOR }, { variantType: SIZE }],
    selectedVariantValues: [{ id: "kirmizi" }],
    variants: [
      variant("Siyah", "XS", 0, { id: "v1" }),
      variant("Kırmızı", "XS", 3, { id: "v2" }),
    ],
  });
  assert.equal(ikasProduct(linked, `${URL_}?vid=v1`).colors[0], "Siyah");
  assert.equal(ikasProduct(linked, `${URL_}?vid=nope`).colors[0], "Kırmızı");
});

test("ikasProduct ignores query parameters that aren't a color", () => {
  const sizesOnly = page({
    variantTypes: [{ variantType: SIZE }],
    variants: [variant(null, "XS", 1)],
  });
  assert.equal(ikasProduct(sizesOnly, `${URL_}?_=1`).inStock, true);
  assert.equal(ikasProduct(colored, `${URL_}?renk=`).colors[0], "Kırmızı");
});

test("ikasProduct prefers the discount price and skips inactive variants", () => {
  const r = ikasProduct(
    page({
      variantTypes: [{ variantType: SIZE }],
      variants: [
        variant(null, "XS", 1, {
          prices: [{ sellPrice: 1750, discountPrice: 1399, currency: "TRY" }],
        }),
        variant(null, "M", 1, { isActive: false }),
      ],
    }),
    URL_,
  );
  assert.equal(r.price, 1399);
  assert.equal(r.currency, "TRY");
  assert.deepEqual(r.sizes, [{ label: "XS", inStock: true, price: 1399 }]);
  assert.deepEqual(r.colors, []);
  assert.equal(r.colorVariants, undefined);
});

test("ikasProduct joins extra dimensions and handles variantless products", () => {
  const length = {
    id: "l",
    name: "Boy",
    selectionType: "CHOICE",
    values: [{ id: "u", name: "Uzun" }],
  };
  const withLength = ikasProduct(
    page({
      variantTypes: [{ variantType: SIZE }, { variantType: length }],
      variants: [
        variant(null, "M", 1, {
          variantValues: [
            { name: "M", variantTypeId: "s" },
            { name: "Uzun", variantTypeId: "l" },
          ],
        }),
      ],
    }),
    URL_,
  );
  assert.equal(withLength.sizes[0].label, "M · Uzun");

  const single = ikasProduct(
    page({ variantTypes: [], variants: [variant(null, null, 2)] }),
    URL_,
  );
  assert.deepEqual(single.sizes, []);
  assert.equal(single.inStock, true);

  const oversold = ikasProduct(
    page({
      variantTypes: [],
      variants: [variant(null, null, 0, { sellIfOutOfStock: true })],
    }),
    URL_,
  );
  assert.equal(oversold.inStock, true);
});

const FABRIC = {
  id: "f",
  name: "Kumaş Tipi",
  selectionType: "COLOR",
  values: [
    { id: "ince", name: "Pamuklu İnce" },
    { id: "kalin", name: "HQ Kalın" },
  ],
};
const fabricRow = (fabric: string, size: string, stock: number) =>
  variant(null, null, stock, {
    variantValues: [
      { name: fabric, variantTypeId: "f" },
      { name: size, variantTypeId: "s" },
    ],
  });
const groupItem = (id: string, value: string, hasStock = true) => ({
  productId: id,
  href: `/tisort-${id}`,
  image: { id: `swatch-${id}`, isVideo: false },
  groupValues: [{ name: "Renk", value }],
  hasStock,
});

test("ikasProduct keeps a swatch type that isn't a color in the size label", () => {
  const r = ikasProduct(
    page({
      variantTypes: [{ variantType: FABRIC }, { variantType: SIZE }],
      selectedVariantValues: [{ id: "ince" }],
      variants: [
        fabricRow("Pamuklu İnce", "XS", 1),
        fabricRow("HQ Kalın", "XS", 0),
      ],
    }),
    `${URL_}?kumas-tipi=hq-kalin&beden=xs`,
  );
  assert.deepEqual(r.colors, []);
  assert.equal(r.colorVariants, undefined);
  assert.deepEqual(
    r.sizes.map((s) => [s.label, s.inStock]),
    [
      ["Pamuklu İnce · XS", true],
      ["HQ Kalın · XS", false],
    ],
  );
  assert.equal(r.inStock, true);
});

test("ikasProduct offers the colors sold as sibling products", () => {
  const r = ikasProduct(
    page({
      id: "beyaz",
      variantTypes: [{ variantType: FABRIC }, { variantType: SIZE }],
      productGroupItems: [
        groupItem("siyah", "SİYAH", false),
        groupItem("beyaz", "BEYAZ"),
      ],
      variants: [fabricRow("Pamuklu İnce", "XS", 1)],
    }),
    `${URL_}?kumas-tipi=hq-kalin&beden=xs`,
  );
  // This page's color first, with its own data.
  assert.deepEqual(r.colors, ["BEYAZ", "SİYAH"]);
  const [own, sibling] = r.colorVariants ?? [];
  assert.equal(own.url, "https://shop.example/tisort-beyaz");
  assert.equal(own.sizes?.[0].label, "Pamuklu İnce · XS");
  assert.match(own.imageUrl ?? "", /image_1080/);
  // A sibling's sizes live on its own page: no imageUrl, so the UI fetches them.
  assert.deepEqual(sibling, {
    color: "SİYAH",
    url: "https://shop.example/tisort-siyah",
    inStock: false,
  });
});

test("ikasProduct's sibling colors stay on the store's host and yield to variant colors", () => {
  const product = (extra: object) =>
    ikasProduct(
      page({
        id: "beyaz",
        variantTypes: [{ variantType: SIZE }],
        variants: [variant(null, "XS", 1)],
        ...extra,
      }),
      URL_,
    );
  const bad = { ...groupItem("kotu", "KÖTÜ"), href: "@evil.example/x" };
  assert.deepEqual(
    product({ productGroupItems: [groupItem("beyaz", "BEYAZ"), bad] }).colors,
    ["BEYAZ"],
  );
  assert.deepEqual(
    product({
      variantTypes: [{ variantType: COLOR }, { variantType: SIZE }],
      variants: [variant("Siyah", "XS", 1)],
      productGroupItems: [groupItem("beyaz", "BEYAZ")],
    }).colors,
    ["Siyah"],
  );
});

test("ikasProduct rejects anything but a product page", () => {
  assert.throws(() => ikasProduct(null, URL_), /product data is missing/);
  assert.throws(
    () => ikasProduct({ props: { pageProps: { pageType: "CATEGORY" } } }, URL_),
    /product data is missing/,
  );
});

test("ikasProduct is self-contained, so it can run as a page script", () => {
  const inPage = new Function(
    `return (${ikasProduct})`,
  )() as typeof ikasProduct;
  assert.deepEqual(inPage(colored, URL_), ikasProduct(colored, URL_));
});
