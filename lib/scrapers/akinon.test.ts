import assert from "node:assert/strict";
import { test } from "node:test";
import { akinonProduct } from "./akinon.ts";

const KEYS = { color: "integration_renk", size: "integration_beden" };
const URL_ = "https://www.fashfed.com/urun/ceket/?seller_id=1";
const sku = (size: string) => ({
  price: "9999",
  attributes: { integration_renk: "010", integration_beden: size },
});
const data = (basket_offers: unknown[]) => ({
  product: {
    name: "Ceket",
    price: "9999",
    currency_type: "try",
    attributes: { integration_renk: "010" },
    basket_offers,
  },
  variants: [
    {
      attribute_key: "integration_renk",
      options: [
        { label: "010", value: "010", in_stock: true, product: sku("M") },
      ],
    },
    {
      attribute_key: "integration_beden",
      options: [
        { label: "S", value: "S", in_stock: false, product: sku("S") },
        { label: "M", value: "M", in_stock: true, product: sku("M") },
      ],
    },
  ],
});
const offer = (
  discounted_total_price: number,
  client_types: string[] = [],
) => ({
  label: "Sepette %20 İndirim",
  listing_kwargs: { quantity: 1, discounted_total_price, price: "9999" },
  client_types,
});

test("akinonProduct applies a 'Sepette' basket offer to the color's prices", () => {
  const p = akinonProduct(data([offer(7999.2)]), URL_, KEYS);
  assert.equal(p?.price, 7999.2);
  assert.deepEqual(
    p?.sizes.map((s) => s.price),
    [7999.2, 7999.2],
  );
  assert.equal(p?.colorVariants?.[0].price, 7999.2);
});

test("akinonProduct keeps list prices without a web basket offer", () => {
  assert.equal(akinonProduct(data([]), URL_, KEYS)?.price, 9999);
  // App-only campaigns don't reach the web basket.
  assert.equal(
    akinonProduct(data([offer(7999.2, ["ios"])]), URL_, KEYS)?.price,
    9999,
  );
});
