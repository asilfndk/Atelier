import type { ColorVariant, ProductStock } from "./types";

/**
 * Levi's: https://www.levis.com.tr/<slug>_<id>
 *
 * Reads the server-rendered page (name and photo from meta tags, the price
 * from the inline Insider object, sizes from the `data-js="size-item"` rows)
 * plus the two AJAX endpoints its own script calls: the stock of every
 * waist × length pair (jeans; the rows' own `data-stock` is the waist total),
 * and the other colors, each its own product page. Those carry no color name,
 * so the product title's " - <colorway>" tail stands in, as on every color's page.
 * Layer 1 (levisApi) and LEVIS_PAGE_SCRIPT both run this through their own
 * `get`, so it must stay self-contained: no imports or outer helpers.
 */
export async function levisProduct(
  pageUrl: string,
  get: (url: string) => Promise<string>,
): Promise<ProductStock | null> {
  const html = await get(pageUrl);
  const origin = new URL(pageUrl).origin;
  const decode = (s?: string) =>
    (s ?? "")
      .replace(/&#(\d+);/g, (m, n) =>
        n <= 0x10ffff ? String.fromCodePoint(Number(n)) : m,
      )
      .replace(/&amp;/g, "&")
      .trim();
  const meta = (key: string) =>
    decode(html.match(new RegExp(`property="${key}" content="([^"]*)"`))?.[1]);
  const name = meta("og:title");
  const id = html.match(/name="ProductDescriptionId"[^>]*value="(\d+)"/)?.[1];
  if (!name || !id) return null;

  const rows = (kind: "size" | "drop") =>
    [
      ...html.matchAll(
        new RegExp(
          `<li[^>]*data-js="${kind}-item"[^>]*data-spec\\d="(\\d+)"[^>]*data-stock="(\\d+)"[^>]*>([^<]*)`,
          "g",
        ),
      ),
    ].map((m) => ({ spec: m[1], stock: Number(m[2]), label: decode(m[3]) }));
  const waists = rows("size");
  const lengths = await Promise.all(
    rows("drop").map(async (length) => {
      const json = JSON.parse(
        await get(
          `${origin}/lookup/getstockcountbysecondspecid?productDescriptionId=${id}&secondSpecId=${length.spec}`,
        ),
      ) as { data?: string[] };
      // "<waist spec>-<label>-<stock>", only for the waists sold in this length.
      const stock = new Map(
        (json.data ?? []).map((row) => {
          const parts = row.split("-");
          return [parts[0], Number(parts[parts.length - 1])] as const;
        }),
      );
      return { label: length.label, stock };
    }),
  );
  const sizes = lengths.length
    ? waists.flatMap((w) =>
        lengths
          .filter((l) => l.stock.has(w.spec))
          .map((l) => ({
            label: `${w.label} · ${l.label}`,
            inStock: (l.stock.get(w.spec) ?? 0) > 0,
          })),
      )
    : waists.map((w) => ({ label: w.label, inStock: w.stock > 0 }));

  const price = Number(html.match(/"unit_sale_price": ([\d.]+)/)?.[1]) || null;
  const imageUrl = meta("og:image") || null;
  const inStock = sizes.length
    ? sizes.some((s) => s.inStock)
    : Number(html.match(/"stock": (\d+)/)?.[1]) > 0;

  const code = html.match(/data-js="p-alternate" data-code="(\w+)"/)?.[1];
  const siblings = code
    ? [
        ...(
          await get(`${origin}/urun/getotherproducts/?text=${code}`)
        ).matchAll(
          /<li[^>]*data-id="(\d+)"[^>]*title="([^"]*)"[^>]*>\s*<a href="([^"]*)"/g,
        ),
      ]
        .map((m) => {
          const title = decode(m[2]);
          // ponytail: titles written "Pantolon-Wagyu" keep the whole title as the color
          const tail = title.split(" - ").slice(1).join(" - ").trim();
          return { id: m[1], color: tail || title, href: m[3] };
        })
        // Scraped links are untrusted: keep the store's own pages only.
        .filter(
          (s) =>
            URL.canParse(s.href, origin) &&
            new URL(s.href, origin).origin === origin,
        )
    : [];
  const color = decode(html.match(/Renk\s*:\s*<span>([^<]*)/)?.[1]);
  // The list should include this page; without it the panel would open on another color.
  if (siblings.length && !siblings.some((s) => s.id === id)) {
    siblings.unshift({ id, color: color || name, href: pageUrl });
  }
  // Colorways can share a title: add the product id, the same on every color's page.
  const label = (s: (typeof siblings)[number]) =>
    siblings.filter((o) => o.color === s.color).length > 1
      ? `${s.color} (${s.id})`
      : s.color;
  // Other colors carry no sizes, so no imageUrl: the panel lazily checks their URL.
  const colorVariants: ColorVariant[] = siblings
    .sort((a, b) => Number(b.id === id) - Number(a.id === id))
    .map((s) =>
      s.id === id
        ? { color: label(s), url: pageUrl, price, inStock, imageUrl, sizes }
        : { color: label(s), url: new URL(s.href, origin).href },
    );

  return {
    name,
    price,
    currency: html.match(/"currency": "(\w+)"/)?.[1] ?? "TRY",
    imageUrl,
    colors: colorVariants.length
      ? colorVariants.map((v) => v.color)
      : [color].filter(Boolean),
    sizes,
    inStock,
    ...(colorVariants.length ? { colorVariants } : {}),
  };
}
