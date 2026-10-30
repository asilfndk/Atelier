// ponytail: Node type stripping only runs modules without extensionless or `@/`
// value imports, so only leaf files are testable. Add a bundler step when others need tests.
import assert from "node:assert/strict";
import { test } from "node:test";
import { meta, nextData, parseTrPrice, resolveImageUrl } from "./base.ts";

test("parseTrPrice reads tr-TR numbers", () => {
  const cases: [unknown, number | null][] = [
    ["6.159,00 TL", 6159],
    ["1.234.567", 1234567],
    ["1.234", 1234],
    ["12.50", 12.5],
    ["999,9", 999.9],
    [42.5, 42.5],
    [NaN, null],
    ["", null],
    [null, null],
    ["tükendi", null],
  ];
  for (const [input, want] of cases)
    assert.equal(parseTrPrice(input), want, String(input));
});

test("resolveImageUrl makes URLs absolute and rejects other schemes", () => {
  const base = "https://shop.example/tr/p/1";
  assert.equal(
    resolveImageUrl("//cdn.example/a.jpg", base),
    "https://cdn.example/a.jpg",
  );
  assert.equal(resolveImageUrl("/a.jpg", base), "https://shop.example/a.jpg");
  assert.equal(resolveImageUrl("data:image/png;base64,AA", base), null);
  assert.equal(resolveImageUrl(null, base), null);
  assert.equal(resolveImageUrl("x", "not a url"), null);
});

test("meta finds the tag by any key attribute and escapes the key", () => {
  const html =
    '<meta property="og:title" content="Ceket"><meta name="price" content="10">';
  assert.equal(meta(html, "og:title"), "Ceket");
  assert.equal(meta(html, "price"), "10");
  assert.equal(meta(html, "og.title"), null);
});

test("nextData parses __NEXT_DATA__ and is null when absent", () => {
  const html =
    '<script id="__NEXT_DATA__" type="application/json">{"a":1}</script>';
  assert.deepEqual(nextData(html), { a: 1 });
  assert.equal(nextData("<html></html>"), null);
});
