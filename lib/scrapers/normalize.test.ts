import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeRaw } from "./normalize.ts";

test("normalizeRaw maps aliases, tr-TR prices and derives inStock", () => {
  assert.deepEqual(
    normalizeRaw({
      name: "Ceket",
      price: "6.159,00 TL",
      currency: "TRY",
      imageUrl: "/a.jpg",
      colors: ["Siyah", 7],
      sizes: [
        { label: "S", inStock: true, price: "1.299,90" },
        { size: "M", available: false },
        { name: "L", isAvailable: 1, price: NaN },
        null,
      ],
    }),
    {
      name: "Ceket",
      price: 6159,
      currency: "TRY",
      imageUrl: "/a.jpg",
      colors: ["Siyah", "7"],
      sizes: [
        { label: "S", inStock: true, price: 1299.9 },
        { label: "M", inStock: false },
        { label: "L", inStock: true },
        { label: "", inStock: false },
      ],
      inStock: true,
    },
  );
});

test("normalizeRaw keeps an explicit inStock and fills defaults", () => {
  assert.deepEqual(normalizeRaw({ inStock: true }), {
    name: "Untitled item",
    price: null,
    currency: null,
    imageUrl: null,
    colors: [],
    sizes: [],
    inStock: true,
  });
  assert.equal((normalizeRaw(null) as { inStock: boolean }).inStock, false);
});

test("normalizeRaw normalizes colorVariants and drops nameless ones", () => {
  const out = normalizeRaw({
    colorVariants: [
      { color: "Mavi", url: "https://x/y", sizes: [{ label: "S" }], price: 10 },
      { color: "Gri", inStock: false, price: "tükendi" },
      { url: "https://x/z" },
    ],
  }) as { colorVariants: unknown };
  assert.deepEqual(out.colorVariants, [
    {
      color: "Mavi",
      url: "https://x/y",
      imageUrl: null,
      sizes: [{ label: "S", inStock: false }],
      price: 10,
    },
    { color: "Gri", url: null, imageUrl: null, inStock: false },
  ]);
});

test("normalizeRaw throws on an in-page extraction error", () => {
  assert.throws(() => normalizeRaw({ __error: "boom" }), /boom/);
});
