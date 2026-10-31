import type { ColorVariant, ProductStock, SizeAvailability } from "./types";

/** The subset of an ikas product page's `__NEXT_DATA__` that we use */
interface IkasVariantType {
  id?: string;
  name?: string;
  selectionType?: string;
  values?: { id?: string; name?: string }[];
}

interface IkasVariant {
  id?: string;
  isActive?: boolean;
  stock?: number;
  sellIfOutOfStock?: boolean;
  prices?: {
    sellPrice?: number;
    discountPrice?: number | null;
    currency?: string;
  }[];
  images?: { imageId?: string; isMain?: boolean; isVideo?: boolean }[];
  variantValues?: { name?: string; variantTypeId?: string }[];
}

interface IkasNextData {
  props?: {
    pageProps?: {
      pageType?: string;
      configJson?: { merchantSettings?: { merchantId?: string } };
      pageSpecificData?: {
        id?: string;
        name?: string;
        variantTypes?: { variantType?: IkasVariantType }[];
        selectedVariantValues?: { id?: string }[];
        variants?: IkasVariant[];
        productGroupItems?: {
          productId?: string;
          href?: string;
          groupValues?: { value?: string }[];
          hasStock?: boolean;
        }[];
      };
    };
  };
}

/**
 * ikas stores (Konfuse, Bushido): https://<store>/<slug>?renk=<color>
 *
 * Reads the server-rendered `__NEXT_DATA__`: one row per color × size, so every
 * color's sizes, photo and price are embedded. Some products sell each color as
 * its own product instead (`productGroupItems`, /the-kelaynak-beyaz vs
 * /the-kelaynak-siyah); those colors are fetched from their own page. Any other
 * variant type, such as "Kumaş Tipi", goes into the size label. The server ignores `?renk=` and
 * `?vid=<variant>` (the page applies them in the client), hence the color comes
 * from the URL here too. Layer 2 runs this same function in the page (IKAS_PAGE_SCRIPT), so it must
 * stay self-contained: no references outside its own body.
 *
 * ponytail: the page is ISR-cached, and each visit triggers the next render, so
 * a change shows up one check late (the store's own page lags the same way).
 * ikas' GraphQL API (`api.myikas.com/api/sf`) is the upgrade if that matters.
 */
export function ikasProduct(data: unknown, pageUrl: string): ProductStock {
  const props = (data as IkasNextData | null)?.props?.pageProps;
  const product = props?.pageSpecificData;
  const variants = product?.variants?.filter((v) => v.isActive !== false);
  if (props?.pageType !== "PRODUCT" || !product?.name || !variants?.length) {
    throw new Error("ikas product data is missing");
  }

  // Store URLs carry ASCII slugs; pasted ones may keep the Turkish letters.
  const slug = (s: string) =>
    s
      .toLocaleLowerCase("tr")
      .replace(/[çğıöşü]/g, (c) => "cgiosu"["çğıöşü".indexOf(c)])
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  const isInStock = (v: IkasVariant) =>
    Number(v.stock) > 0 || v.sellIfOutOfStock === true;
  const priceOf = (v: IkasVariant) => {
    const p = v.prices?.[0];
    return p?.discountPrice ?? p?.sellPrice ?? null;
  };
  const imageOf = (v: IkasVariant) => {
    const merchantId = props.configJson?.merchantSettings?.merchantId;
    const photos = v.images?.filter((i) => !i.isVideo) ?? [];
    const photo = photos.find((i) => i.isMain) ?? photos[0];
    return merchantId && photo
      ? `https://cdn.myikas.com/images/${merchantId}/${photo.imageId}/image_1080.webp`
      : null;
  };

  // Not always named "Renk" ("Şort Rengi", "Cüzdan Renk"), and the swatch type
  // alone doesn't make a color: "Kumaş Tipi" and "Gemstone" have swatches too.
  const colorType = product.variantTypes
    ?.map((t) => t.variantType)
    .find(
      (t) => t?.selectionType === "COLOR" && /ren[kg]/.test(slug(t.name ?? "")),
    );
  const colorOf = (v: IkasVariant) =>
    colorType &&
    v.variantValues?.find((x) => x.variantTypeId === colorType.id)?.name;
  const toSizes = (rows: IkasVariant[]): SizeAvailability[] =>
    rows.flatMap((v) => {
      const label = (v.variantValues ?? [])
        .filter((x) => !colorType || x.variantTypeId !== colorType.id)
        .map((x) => x.name)
        .join(" · ");
      return label ? [{ label, inStock: isInStock(v), price: priceOf(v) }] : [];
    });
  // Lowest of the rows, not the first in stock: a sell-out must not read as a price drop.
  const lowestPrice = (rows: IkasVariant[]) => {
    const prices = rows.flatMap((v) => priceOf(v) ?? []);
    return prices.length ? Math.min(...prices) : null;
  };

  const colorValues = (colorType?.values ?? []).filter((c) =>
    variants.some((v) => colorOf(v) === c.name),
  );
  const colorKey = slug(colorType?.name ?? "");
  const url = new URL(pageUrl);
  const requested =
    colorType && [...url.searchParams].find(([k]) => slug(k) === colorKey)?.[1];
  const linked = variants.find((v) => v.id === url.searchParams.get("vid"));
  const selected = requested
    ? colorValues.find((c) => slug(c.name ?? "") === slug(requested))
    : (colorValues.find((c) => linked && c.name === colorOf(linked)) ??
      colorValues.find((c) =>
        product.selectedVariantValues?.some((s) => s.id === c.id),
      ) ??
      colorValues[0]);
  if (requested && !selected) {
    throw new Error("ikas requested color is missing");
  }

  // Requested color first, as colors[0] is what the result shows.
  const colorVariants: ColorVariant[] = colorValues
    .sort((a, b) => Number(b === selected) - Number(a === selected))
    .map((c) => {
      const rows = variants.filter((v) => colorOf(v) === c.name);
      return {
        color: c.name ?? "",
        // The store applies ?renk= only with every variant type in the URL, so a
        // color alone opens its default color; ?vid= opens it. Re-checks use ?renk=:
        // it survives a deleted variant, and a missing color throws.
        url: `${url.origin}${url.pathname}?${colorKey}=${slug(c.name ?? "")}&vid=${rows[0].id}`,
        price: lowestPrice(rows),
        inStock: rows.some(isInStock),
        imageUrl: imageOf(rows[0]),
        sizes: toSizes(rows),
      };
    });

  // Colors sold as sibling products. Only this page's data is known: a sibling
  // has no imageUrl, so the UI fetches its photo, sizes and price from its url.
  if (!colorType) {
    const siblings = (product.productGroupItems ?? []).flatMap(
      (item): ColorVariant[] => {
        const color = item.groupValues?.[0]?.value;
        if (!color || !item.href?.startsWith("/")) return [];
        const itemUrl = `${url.origin}${item.href}`;
        return item.productId === product.id
          ? [
              {
                color,
                url: itemUrl,
                price: lowestPrice(variants),
                inStock: variants.some(isInStock),
                imageUrl: imageOf(variants[0]),
                sizes: toSizes(variants),
              },
            ]
          : [{ color, url: itemUrl, inStock: item.hasStock === true }];
      },
    );
    colorVariants.push(
      ...siblings.filter((c) => c.sizes),
      ...siblings.filter((c) => !c.sizes),
    );
  }

  const active = selected
    ? variants.filter((v) => colorOf(v) === selected.name)
    : variants;
  return {
    name: product.name.trim(),
    price: lowestPrice(active),
    currency: active[0].prices?.[0]?.currency || "TRY",
    imageUrl: imageOf(active[0]),
    colors: colorVariants.map((c) => c.color),
    sizes: toSizes(active),
    inStock: active.some(isInStock),
    ...(colorVariants.length ? { colorVariants } : {}),
  };
}
