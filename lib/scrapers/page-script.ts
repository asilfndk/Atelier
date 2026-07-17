/**
 * Shared script that extracts stock/price from the JSON-LD (`application/ld+json`)
 * Product schema found on Inditex brand product pages. Runs inside a hidden
 * BrowserWindow via `executeJavaScript` and returns a raw product object.
 *
 * The brands share the same e-commerce platform, so the JSON-LD structure is
 * similar; it can be overridden with a brand-specific script when needed.
 */
export const JSONLD_PAGE_SCRIPT = `
  const out = { name: "", price: null, currency: null, imageUrl: null, colors: [], sizes: [], inStock: false };
  const blocks = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  let product = null, group = null;
  for (const b of blocks) {
    try {
      let data = JSON.parse(b.textContent || "null");
      const arr = Array.isArray(data) ? data : (data && data['@graph'] ? data['@graph'] : [data]);
      for (const node of arr) {
        if (node && (node['@type'] === 'Product' || (Array.isArray(node['@type']) && node['@type'].includes('Product')))) {
          product = node; break;
        }
        if (!group && node && (node['@type'] === 'ProductGroup' || (Array.isArray(node['@type']) && node['@type'].includes('ProductGroup')))) {
          group = node;
        }
      }
    } catch (e) {}
    if (product) break;
  }
  // Pages publishing ProductGroup (hasVariant): convert variants to an Offer list
  // and reuse the same flow (o.name = size label; "S (US S)" → "S").
  if (!product && group) {
    const vars = Array.isArray(group.hasVariant) ? group.hasVariant : [];
    product = {
      name: group.name,
      image: group.image,
      offers: vars.filter(Boolean).map((v) => {
        const o = v.offers ? (Array.isArray(v.offers) ? v.offers[0] : v.offers) : {};
        return {
          price: o && o.price,
          priceCurrency: o && o.priceCurrency,
          availability: o && o.availability,
          name: v.size ? String(v.size).replace(/\\s*\\(US[^)]*\\)/i, '').trim() : '',
        };
      }),
    };
  }
  if (product) {
    out.name = product.name || "";
    if (typeof product.image === 'string') out.imageUrl = product.image;
    else if (Array.isArray(product.image)) out.imageUrl = product.image[0] || null;
    else if (product.image && product.image.url) out.imageUrl = product.image.url;

    const offers = product.offers ? (Array.isArray(product.offers) ? product.offers : [product.offers]) : [];
    const inStockStr = (s) => typeof s === 'string' && s.toLowerCase().indexOf('instock') !== -1;
    // Accept only human-readable size labels; drop SKU codes (long/dashed).
    const SIZE_TOKEN = /^(XXS|XS|S|M|L|XL|XXL|XXXL|[2-6]XL|ONE SIZE|TEK BEDEN|\\d{2}(?:[\\/\\-]\\d{2})?)$/i;
    for (const o of offers) {
      if (out.price == null && o.price != null) out.price = parseFloat(o.price);
      if (!out.currency && o.priceCurrency) out.currency = o.priceCurrency;
      const label = String(o.name || (o.itemOffered && o.itemOffered.name) || "").trim();
      if (label && SIZE_TOKEN.test(label)) {
        out.sizes.push({ label, inStock: inStockStr(o.availability) });
      }
    }
    out.inStock = out.sizes.some(s => s.inStock) || offers.some(o => inStockStr(o.availability));
  }
  // Color: collect from the selected/active color elements on the page (best-effort)
  try {
    const colorEls = document.querySelectorAll('[data-qa-qualifier="product-detail-color-selector"] [aria-label], [class*="color"] [aria-label]');
    const set = new Set();
    colorEls.forEach(el => { const t = (el.getAttribute('aria-label') || '').trim(); if (t) set.add(t); });
    out.colors = Array.from(set).slice(0, 20);
  } catch (e) {}

  // Sizes: read from known size containers, clicking the CTA first if needed.
  try {
    const TOKEN = /^(XXS|XS|S|M|L|XL|XXL|XXXL|[2-6]XL|ONE SIZE|TEK BEDEN|\\d{2}(?:[\\/\\-]\\d{2})?)$/i;
    const CONTAINERS = '.size-selector__list, [class*="size-selector" i], [class*="sizeList" i], [class*="size-list" i], [class*="sizes__list" i], [data-qa-qualifier*="size" i]';

    // Collect size elements from known containers (take the most populated tag set).
    function readFromContainers() {
      let best = [];
      document.querySelectorAll(CONTAINERS).forEach((c) => {
        ['button', 'li', '[role="button"]', '[role="option"]', '[role="radio"]'].forEach((tag) => {
          const items = Array.from(c.querySelectorAll(tag))
            .filter((e) => TOKEN.test((e.innerText || '').trim()) && e.children.length <= 1);
          if (items.length > best.length) best = items;
        });
      });
      return best;
    }

    // Fallback grouping by common parent across the whole document.
    function readByParent() {
      const cands = Array.from(
        document.querySelectorAll('button, li, [role="button"], [role="option"]'),
      ).filter((e) => TOKEN.test((e.innerText || '').trim()) && e.children.length <= 1);
      const byParent = new Map();
      cands.forEach((e) => {
        const p = e.parentElement;
        if (!p) return;
        (byParent.get(p) || byParent.set(p, []).get(p)).push(e);
      });
      let group = [];
      byParent.forEach((arr) => { if (arr.length > group.length) group = arr; });
      return group;
    }

    let els = readFromContainers();
    if (els.length < 2) {
      // If the size panel is closed: click only SEPETE EKLE / ADD TO BAG (not the wishlist).
      const cta = Array.from(document.querySelectorAll('button, [role="button"]')).find((b) => {
        const t = (b.innerText || b.getAttribute('aria-label') || '').trim();
        return /SEPETE EKLE|ADD TO (BAG|CART|BASKET)|BEDEN SEÇ/i.test(t) && !/istek|wishlist|favori/i.test(t);
      });
      if (cta) { cta.click(); await __sleep(2000); }
      els = readFromContainers();
      if (els.length < 2) els = readByParent();
    }

    if (els.length >= 2) {
      const seen = new Set();
      const domSizes = [];
      els.forEach((e) => {
        const label = (e.innerText || '').trim();
        if (!label || seen.has(label)) return;
        seen.add(label);
        const cls = (e.className || '').toString();
        const ariaDis = e.getAttribute('aria-disabled');
        const disabled =
          e.disabled || ariaDis === 'true' ||
          /out-of-stock|disabled|unavailable|sold|tüken/i.test(cls);
        domSizes.push({ label, inStock: !disabled });
      });
      if (domSizes.length) out.sizes = domSizes;
    }
  } catch (e) {}

  return out;
`;

/**
 * Zara-specific: name/price/image from JSON-LD + open the "ADD" panel and read
 * clean size labels (XS/S/M/L) and stock status (`data-qa-action`) from the
 * size selector. Async — the size panel loads on interaction, so waiting is required.
 */
export const ZARA_PAGE_SCRIPT = `
  const out = { name: "", price: null, currency: null, imageUrl: null, colors: [], sizes: [], inStock: false };

  // 1) JSON-LD: name / price / currency / image
  // In 2026 Zara publishes ProductGroup (hasVariant: one Offer per size) instead of Product.
  const blocks = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  let product = null, group = null;
  for (const b of blocks) {
    try {
      const data = JSON.parse(b.textContent || "null");
      const arr = Array.isArray(data) ? data : (data && data['@graph'] ? data['@graph'] : [data]);
      for (const n of arr) {
        const t = n && n['@type'];
        if (t === 'Product' || (Array.isArray(t) && t.includes('Product'))) { product = n; break; }
        if (!group && (t === 'ProductGroup' || (Array.isArray(t) && t.includes('ProductGroup')))) group = n;
      }
    } catch (e) {}
    if (product) break;
  }
  const instockStr = (s) => typeof s === 'string' && /instock|limitedavailability/i.test(s);
  if (product) {
    out.name = product.name || "";
    if (typeof product.image === 'string') out.imageUrl = product.image;
    else if (Array.isArray(product.image)) out.imageUrl = product.image[0] || null;
    const offers = product.offers ? (Array.isArray(product.offers) ? product.offers : [product.offers]) : [];
    if (offers[0]) {
      if (offers[0].price != null) out.price = parseFloat(offers[0].price);
      if (offers[0].priceCurrency) out.currency = offers[0].priceCurrency;
    }
  } else if (group) {
    out.name = group.name || "";
    if (typeof group.image === 'string') out.imageUrl = group.image;
    else if (Array.isArray(group.image)) out.imageUrl = group.image[0] || null;
    const vars = Array.isArray(group.hasVariant) ? group.hasVariant : [];
    const seen = new Set();
    const colorSet = new Set();
    for (const v of vars) {
      if (!v) continue;
      const o = v.offers ? (Array.isArray(v.offers) ? v.offers[0] : v.offers) : null;
      if (o) {
        if (out.price == null && o.price != null) out.price = parseFloat(o.price);
        if (!out.currency && o.priceCurrency) out.currency = o.priceCurrency;
      }
      if (v.color) colorSet.add(String(v.color));
      // "S (US S)" → "S": drop the parenthesized US equivalent, keep the local size.
      const label = v.size ? String(v.size).replace(/\\s*\\(US[^)]*\\)/i, '').trim() : '';
      if (label && !seen.has(label)) {
        seen.add(label);
        out.sizes.push({ label, inStock: !!(o && instockStr(o.availability)) });
      }
    }
    if (colorSet.size) out.colors = Array.from(colorSet);
  }

  // 2) Color: the selected color name
  try {
    const cn = document.querySelector('.product-detail-color-selector__selected-color-name, .product-detail-info__color');
    if (cn && cn.innerText.trim() && !out.colors.length) out.colors = [cn.innerText.trim()];
    const colorBtns = document.querySelectorAll('.product-detail-color-selector__color-button[aria-label], [class*="color-selector"] button[aria-label]');
    const set = new Set(out.colors);
    colorBtns.forEach(b => { const t = (b.getAttribute('aria-label')||'').trim(); if (t) set.add(t); });
    if (set.size) out.colors = Array.from(set).slice(0, 20);
  } catch (e) {}

  // 3) If JSON-LD gave no sizes: open the size panel (ADD) → read the size selector
  try {
    if (out.sizes.length < 2) {
    const addBtn = Array.from(document.querySelectorAll('button, [role="button"]'))
      .find(b => /\\bADD\\b|EKLE|SEPETE EKLE/i.test((b.innerText || '')));
    if (addBtn) { addBtn.click(); await __sleep(2000); }
    const sizeEls = document.querySelectorAll('.size-selector-sizes__size, .size-selector-sizes-size');
    const seen = new Set();
    sizeEls.forEach(el => {
      const label = (el.innerText || '').trim().split('\\n')[0].trim();
      if (!label || seen.has(label)) return;
      seen.add(label);
      const action = el.getAttribute('data-qa-action') || '';
      const cls = (el.className || '').toString();
      const inStock = action === 'size-in-stock'
        || (action !== 'size-out-of-stock' && !/out-of-stock|disabled|is-disabled/i.test(cls));
      out.sizes.push({ label, inStock });
    });
    }
  } catch (e) {}

  // 4) Color variants — primary: window.zara.viewPayload (per color: productId=v1,
  // image, sizes, price in minor units); fallback: JSON-LD hasVariant (no URL).
  try {
    const vp = window.zara && window.zara.viewPayload;
    const cols = vp && vp.product && vp.product.detail && vp.product.detail.colors;
    if (Array.isArray(cols) && cols.length) {
      const stripUS = (s) => String(s || '').replace(/\\s*\\(US[^)]*\\)/i, '').trim();
      const avail = (a) => /in_stock|low_on_stock/i.test(String(a || ''));
      const minor = (v) => (typeof v === 'number' && isFinite(v)) ? v / 100 : null;
      out.colorVariants = cols.map((c) => {
        const img = (c.mainImgs && c.mainImgs[0]) || (c.xmedia && c.xmedia[0]) || null;
        const imageUrl = img
          ? ((img.extraInfo && img.extraInfo.deliveryUrl)
             || (img.url ? String(img.url).replace('{width}', '1920') : null))
          : null;
        let url = null;
        if (c.productId) {
          const u = new URL(location.href);
          u.searchParams.set('v1', String(c.productId));
          url = u.toString();
        }
        return {
          color: String(c.name || c.id || ''),
          url,
          imageUrl,
          sizes: Array.isArray(c.sizes)
            ? c.sizes.map((s) => ({ label: stripUS(s.name), inStock: avail(s.availability), price: minor(s.price) }))
            : [],
          price: minor(c.price),
        };
      }).filter((v) => v.color);
    }
  } catch (e) {}
  if ((!out.colorVariants || !out.colorVariants.length) && group) {
    try {
      const vars = Array.isArray(group.hasVariant) ? group.hasVariant : [];
      const byColor = new Map();
      for (const v of vars) {
        if (!v || !v.color) continue;
        const key = String(v.color);
        if (!byColor.has(key)) byColor.set(key, { color: key, url: null, imageUrl: null, sizes: [] });
        const cv = byColor.get(key);
        if (!cv.imageUrl) {
          if (typeof v.image === 'string') cv.imageUrl = v.image;
          else if (Array.isArray(v.image)) cv.imageUrl = v.image[0] || null;
        }
        const o = v.offers ? (Array.isArray(v.offers) ? v.offers[0] : v.offers) : null;
        const label = v.size ? String(v.size).replace(/\\s*\\(US[^)]*\\)/i, '').trim() : '';
        if (label && !cv.sizes.some((s) => s.label === label)) {
          cv.sizes.push({ label, inStock: !!(o && instockStr(o.availability)) });
        }
      }
      if (byColor.size) out.colorVariants = Array.from(byColor.values());
    } catch (e) {}
  }
  // Keep the color label list consistent with the variants (button order = variant order).
  if (out.colorVariants && out.colorVariants.length) {
    out.colors = out.colorVariants.map((v) => v.color);
  }

  out.inStock = out.sizes.some(s => s.inStock)
    || (product && JSON.stringify(product.offers||{}).toLowerCase().indexOf('instock') !== -1);
  return out;
`;

/**
 * Bershka-specific: name/price/image from JSON-LD; color/size data comes from
 * the itxrest detail API called FROM INSIDE the page (direct HTTP requests get
 * caught by Akamai, same-origin fetch passes). \`detail.colors[]\` holds per-color
 * name, size list (\`visibilityValue: SHOW|COMING_SOON|SOLD_OUT\` — the same size
 * name repeats across multiple SKU rows, in stock if any is SHOW) and price in
 * minor units; \`out.colorVariants\` is filled from this (color URL =
 * pathname + \`?colorId=<id>\`, image = the per-color p/principal photo's
 * \`deliveryUrl\` from \`detail.xmedia[]\`, \`w=800\`; the \`#color-<id> img\` in the
 * DOM color list is a last resort only — that \`-r.jpg\` is a fabric crop, not a
 * product photo). Store/catalog/languageId are pinned to the TR store
 * (the app is TR-focused). If the API fails, fallback: sizeless colorVariants
 * from the DOM color list + sizes from \`.size-selector__list .size-button\`.
 */
export const BERSHKA_PAGE_SCRIPT = `
  const out = { name: "", price: null, currency: null, imageUrl: null, colors: [], sizes: [], inStock: false };

  // 1) JSON-LD: name / price / currency / image
  try {
    const blocks = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    let product = null;
    for (const b of blocks) {
      try {
        const data = JSON.parse(b.textContent || "null");
        const arr = Array.isArray(data) ? data : (data && data['@graph'] ? data['@graph'] : [data]);
        for (const n of arr) {
          const t = n && n['@type'];
          if (t === 'Product' || (Array.isArray(t) && t.includes('Product'))) { product = n; break; }
        }
      } catch (e) {}
      if (product) break;
    }
    if (product) {
      out.name = product.name || "";
      if (typeof product.image === 'string') out.imageUrl = product.image;
      else if (Array.isArray(product.image)) out.imageUrl = product.image[0] || null;
      const offers = product.offers ? (Array.isArray(product.offers) ? product.offers : [product.offers]) : [];
      if (offers[0]) {
        if (offers[0].price != null) out.price = parseFloat(offers[0].price);
        if (offers[0].priceCurrency) out.currency = offers[0].priceCurrency;
      }
      out.inStock = offers.some((o) => typeof o.availability === 'string' && /instock/i.test(o.availability.replace(/[^a-z]/gi, '')));
    }
  } catch (e) {}

  // DOM color-list images (-r fabric crop, w=800) — fallback only.
  const domColorImg = {};
  try {
    document.querySelectorAll('[data-qa-anchor="productDetailColorList"] li').forEach((li) => {
      const m = String(li.id || '').match(/color-(\\w+)/);
      const img = li.querySelector('img');
      if (!m || !img || !img.src) return;
      try {
        const u = new URL(img.src, location.href);
        u.searchParams.set('w', '800');
        domColorImg[m[1]] = u.toString();
      } catch (e) { domColorImg[m[1]] = img.src; }
    });
  } catch (e) {}

  // 2) Primary: itxrest detail API (in-page fetch — Akamai allows same-origin requests).
  try {
    const pm = location.pathname.match(/p(\\d+)(?:\\.html)?$/i);
    if (pm) {
      const res = await fetch(
        '/itxrest/2/catalog/store/44109521/40259535/category/0/product/' + pm[1] + '/detail?languageId=-43',
        { headers: { Accept: 'application/json' } },
      );
      if (res.ok) {
        const data = await res.json();
        const sums = Array.isArray(data.bundleProductSummaries) ? data.bundleProductSummaries : [];
        const detail = (sums[0] && sums[0].detail) || {};
        const cols = Array.isArray(detail.colors) ? detail.colors : [];
        // Real product photo per color: detail.xmedia[] (the last segment of
        // path is the colorId). The deliveryUrl of the first p/p1 (principal)
        // media; otherwise the first media that is NOT r/s (crop/swatch).
        const xmediaImg = {};
        try {
          (Array.isArray(detail.xmedia) ? detail.xmedia : []).forEach((x) => {
            const cid = String((x.path || '').split('/').filter(Boolean).pop() || '');
            if (!cid || xmediaImg[cid]) return;
            const medias = [];
            (Array.isArray(x.xmediaItems) ? x.xmediaItems : []).forEach((it) => {
              (Array.isArray(it.medias) ? it.medias : []).forEach((m) => medias.push(m));
            });
            const urlOf = (m) => (m && m.extraInfo && m.extraInfo.deliveryUrl) || (m && m.url) || null;
            const nameOf = (m) => String((m && m.extraInfo && m.extraInfo.originalName) || '');
            const pick = medias.find((m) => /^p\\d*$/i.test(nameOf(m)) && urlOf(m))
              || medias.find((m) => !/^(r|s)\\d*$/i.test(nameOf(m)) && urlOf(m));
            if (!pick) return;
            try {
              const u = new URL(urlOf(pick), location.href);
              u.searchParams.set('w', '800');
              xmediaImg[cid] = u.toString();
            } catch (e) { xmediaImg[cid] = urlOf(pick); }
          });
        } catch (e) {}
        if (cols.length) {
          const minor = (v) => { const n = parseFloat(v); return isFinite(n) ? n / 100 : null; };
          out.colorVariants = cols.map((c) => {
            const seen = new Set();
            const sizes = [];
            (Array.isArray(c.sizes) ? c.sizes : []).forEach((s) => {
              const label = String(s.name || '').trim();
              if (!label) return;
              const inStock = String(s.visibilityValue || '') === 'SHOW';
              if (seen.has(label)) {
                const prev = sizes.find((x) => x.label === label);
                if (prev && inStock) prev.inStock = true;
                return;
              }
              seen.add(label);
              sizes.push({ label, inStock, price: minor(s.price) });
            });
            return {
              color: String(c.name || c.id || ''),
              url: location.origin + location.pathname + '?colorId=' + c.id,
              imageUrl: xmediaImg[String(c.id)] || domColorImg[String(c.id)] || null,
              sizes,
              price: sizes.length ? sizes[0].price : null,
            };
          }).filter((v) => v.color);
          out.colors = out.colorVariants.map((v) => v.color);
          // Active color: the colorId in the URL, otherwise the first color.
          const colorId = new URL(location.href).searchParams.get('colorId');
          let ai = cols.findIndex((c) => String(c.id) === String(colorId));
          if (ai < 0) ai = 0;
          const active = out.colorVariants[ai];
          if (active) {
            if (active.sizes.length) {
              out.sizes = active.sizes;
              out.inStock = active.sizes.some((s) => s.inStock);
            }
            if (active.price != null) out.price = active.price;
            if (active.imageUrl && !out.imageUrl) out.imageUrl = active.imageUrl;
          }
        }
      }
    }
  } catch (e) {}

  // 3) Fallback — if the API gave no variants: DOM color list + DOM size reading.
  try {
    if (!out.colorVariants || !out.colorVariants.length) {
      const vars = [];
      document.querySelectorAll('[data-qa-anchor="productDetailColorList"] li').forEach((li) => {
        const a = li.querySelector('a');
        const name = ((a && a.getAttribute('aria-label')) || '').trim();
        if (!name) return;
        const m = String(li.id || '').match(/color-(\\w+)/);
        vars.push({
          color: name,
          url: a && a.href ? a.href : null,
          imageUrl: (m && domColorImg[m[1]]) || null,
        });
      });
      if (vars.length) {
        out.colorVariants = vars;
        out.colors = vars.map((v) => v.color);
      }
    }
  } catch (e) {}
  try {
    if (!out.sizes.length) {
      const seen = new Set();
      const domSizes = [];
      document.querySelectorAll('.size-selector__list .size-button').forEach((b) => {
        const lab = b.querySelector('.size-button__label');
        const label = ((lab ? lab.textContent : b.textContent) || '').trim();
        if (!label || seen.has(label)) return;
        seen.add(label);
        const cls = (b.className || '').toString();
        const inStock = !b.disabled
          && b.getAttribute('aria-disabled') !== 'true'
          && !/disabled|out-of-stock|sold|tüken/i.test(cls);
        domSizes.push({ label, inStock });
      });
      if (domSizes.length) {
        out.sizes = domSizes;
        out.inStock = domSizes.some((s) => s.inStock);
      }
    }
  } catch (e) {}

  return out;
`;

/** Config for the shared itxrest page-script template (newer Inditex SPAs). */
interface ItxrestScriptConfig {
  /** URL query param that selects the active color (cS for P&B, colorId for Lefties) */
  colorParam: string;
  /** URL query param that carries the API productId (pelement / parentId) */
  productIdParam: string;
  /** Last-resort store/catalog IDs; omit for discovery-only (self-healing) */
  pinned?: { storeId: string; catalogId: string; note: string };
  /** Initial languageId before discovery overrides it (default "-43", tr-TR) */
  defaultLangId?: string;
}

/**
 * Shared page script for the newer Inditex SPA platform (Pull & Bear,
 * Lefties). Layer 1: JSON-LD (name/price/image/stock — also the safety net
 * for sizeless items like perfume). Layer 2: the itxrest detail API via
 * in-page same-origin fetch (passes Akamai). Store/catalog IDs are not
 * hardcoded per se: the page calls itxrest itself, so the script discovers
 * \`/itxrest/<v>/catalog/store/<storeId>/<catalogId>/\`, \`languageId\` and
 * the real API productId from \`performance.getEntriesByType('resource')\`
 * (retrying up to ~10s), falling back to inline-script JSON
 * (\`"storeId"\`/\`"catalogId"\`), \`window.inditex\` globals, and — when
 * configured — pinned last-resort IDs. When the page's own
 * \`/product/<id>/detail\` call was captured, that exact URL is re-fetched;
 * otherwise the URL is built from candidate product ids (the configured
 * query param, JSON-LD sku, then the l/p-code digits from the pathname
 * without leading zeros). Variant URLs use the configured color param.
 * Sizeless colors get \`inStock\` from their SKU rows (visibilityValue SHOW)
 * so a perfume isn't flattened to out-of-stock. If the API path fails
 * entirely: defensive DOM fallback.
 */
function makeItxrestScript(cfg: ItxrestScriptConfig): string {
  const altColorParam = cfg.colorParam === "cS" ? "colorId" : "cS";
  const pinnedBlock = cfg.pinned
    ? `
  // Last resort: ${cfg.pinned.note} — discovery above self-heals if Inditex
  // ever rotates them.
  if (!storeId || !catalogId) { storeId = '${cfg.pinned.storeId}'; catalogId = '${cfg.pinned.catalogId}'; }`
    : "";
  return `
  const out = { name: "", price: null, currency: null, imageUrl: null, colors: [], sizes: [], inStock: false };
  let ldSku = null;

  // 1) JSON-LD: name / price / currency / image / stock
  try {
    const blocks = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    let product = null;
    for (const b of blocks) {
      try {
        const data = JSON.parse(b.textContent || "null");
        const arr = Array.isArray(data) ? data : (data && data['@graph'] ? data['@graph'] : [data]);
        for (const n of arr) {
          const t = n && n['@type'];
          if (t === 'Product' || (Array.isArray(t) && t.includes('Product'))) { product = n; break; }
        }
      } catch (e) {}
      if (product) break;
    }
    if (product) {
      out.name = product.name || "";
      if (typeof product.image === 'string') out.imageUrl = product.image;
      else if (Array.isArray(product.image)) out.imageUrl = product.image[0] || null;
      const offers = product.offers ? (Array.isArray(product.offers) ? product.offers : [product.offers]) : [];
      if (offers[0]) {
        if (offers[0].price != null) out.price = parseFloat(offers[0].price);
        if (offers[0].priceCurrency) out.currency = offers[0].priceCurrency;
      }
      out.inStock = offers.some((o) => typeof o.availability === 'string' && /instock/i.test(o.availability.replace(/[^a-z]/gi, '')));
      const sku = String(product.productID || product.sku || '');
      if (/^\\d{6,}$/.test(sku)) ldSku = sku;
    }
  } catch (e) {}

  // 2) itxrest endpoint discovery — the page's own API calls, via resource timing.
  // The loop also waits for the page's own /product/<id>/detail call: that id is
  // the only reliable API productId when the URL carries no ?${cfg.productIdParam}=.
  let storeId = null, catalogId = null, langId = '${cfg.defaultLangId ?? "-43"}', apiProductId = null, detailUrl = null, altProductId = null;
  try {
    for (let i = 0; i < 20 && !(storeId && apiProductId); i++) {
      for (const e of performance.getEntriesByType('resource')) {
        const url = String(e.name || '');
        if (url.indexOf('/itxrest/') < 0) continue;
        const m = url.match(/\\/itxrest\\/\\d+\\/catalog\\/store\\/(\\d+)\\/(\\d+)\\//);
        if (m && !storeId) { storeId = m[1]; catalogId = m[2]; }
        const lm = url.match(/[?&]languageId=(-?\\d+)/);
        if (lm) langId = lm[1];
        const pm = url.match(/\\/product\\/(\\d+)\\/detail(?:[?#]|$)/);
        if (pm) { apiProductId = pm[1]; detailUrl = url; }
        else if (!altProductId) {
          const xm = url.match(/\\/product\\/(\\d+)\\/(?:extradetail|stock|sizing-info)/)
            || url.match(/[?&]productIds=(\\d+)/);
          if (xm) altProductId = xm[1];
        }
      }
      if (!(storeId && apiProductId)) await __sleep(500);
    }
  } catch (e) {}
  // Fallback: store config embedded in inline scripts.
  try {
    if (!storeId) {
      for (const s of document.querySelectorAll('script:not([src])')) {
        const txt = s.textContent || '';
        const sm = txt.match(/["']?(?:i?[sS]toreId)["']?\\s*[:=]\\s*["']?(\\d+)/);
        const cm = txt.match(/["']?(?:i?[cC]atalogId)["']?\\s*[:=]\\s*["']?(\\d+)/);
        if (sm && cm) { storeId = sm[1]; catalogId = cm[1]; break; }
      }
    }
  } catch (e) {}
  // Fallback: legacy Inditex window globals.
  try {
    if (!storeId && window.inditex) {
      const ix = window.inditex;
      const s = ix.iStoreId || ix.storeId, c = ix.iCatalogId || ix.catalogId;
      if (s && c) { storeId = String(s); catalogId = String(c); }
      const l = ix.iLanguageId || ix.languageId;
      if (l != null) langId = String(l);
    }
  } catch (e) {}${pinnedBlock}

  // 3) Primary: itxrest detail (same-origin fetch passes Akamai).
  try {
    if (storeId && catalogId) {
      // Candidate API product ids: the page's own detail call, ?${cfg.productIdParam}=,
      // JSON-LD sku, then the l/p-code digits (leading zeros stripped).
      const cands = [];
      if (apiProductId) cands.push(apiProductId);
      const pel = new URL(location.href).searchParams.get('${cfg.productIdParam}');
      if (pel && /^\\d+$/.test(pel)) cands.push(pel);
      if (altProductId) cands.push(altProductId);
      if (ldSku) cands.push(ldSku);
      const lm = location.pathname.match(/[lp](\\d+)(?:\\.html)?$/i);
      if (lm) cands.push(String(parseInt(lm[1], 10)));
      let data = null;
      if (detailUrl) {
        try {
          const r = await fetch(detailUrl, { headers: { Accept: 'application/json' } });
          if (r.ok) data = await r.json();
        } catch (e) {}
      }
      for (const id of cands) {
        if (data && Array.isArray(data.bundleProductSummaries) && data.bundleProductSummaries.length) break;
        try {
          const r = await fetch(
            '/itxrest/2/catalog/store/' + storeId + '/' + catalogId + '/category/0/product/' + id + '/detail?languageId=' + langId,
            { headers: { Accept: 'application/json' } },
          );
          if (r.ok) data = await r.json();
        } catch (e) {}
      }
      const sums = data && Array.isArray(data.bundleProductSummaries) ? data.bundleProductSummaries : [];
      const detail = (sums[0] && sums[0].detail) || {};
      const cols = Array.isArray(detail.colors) ? detail.colors : [];
      // Real product photo per color from detail.xmedia[] (path's last segment
      // is the colorId; prefer the p/principal media, never r/s crops).
      const xmediaImg = {};
      try {
        (Array.isArray(detail.xmedia) ? detail.xmedia : []).forEach((x) => {
          const cid = String(x.colorCode || (x.path || '').split('/').filter(Boolean).pop() || '');
          if (!cid || xmediaImg[cid]) return;
          const medias = [];
          (Array.isArray(x.xmediaItems) ? x.xmediaItems : []).forEach((it) => {
            (Array.isArray(it.medias) ? it.medias : []).forEach((m) => medias.push(m));
          });
          const urlOf = (m) => (m && m.extraInfo && m.extraInfo.deliveryUrl) || (m && m.url) || null;
          const nameOf = (m) => String((m && m.extraInfo && m.extraInfo.originalName) || '');
          const pick = medias.find((m) => /^p\\d*$/i.test(nameOf(m)) && urlOf(m))
            || medias.find((m) => !/^(r|s)\\d*$/i.test(nameOf(m)) && urlOf(m));
          if (!pick) return;
          try {
            const u = new URL(urlOf(pick), location.href);
            u.searchParams.set('w', '800');
            xmediaImg[cid] = u.toString();
          } catch (e) { xmediaImg[cid] = urlOf(pick); }
        });
      } catch (e) {}
      if (cols.length) {
        const minor = (v) => { const n = parseFloat(v); return isFinite(n) ? n / 100 : null; };
        out.colorVariants = cols.map((c) => {
          const rows = Array.isArray(c.sizes) ? c.sizes : [];
          const seen = new Set();
          const sizes = [];
          rows.forEach((s) => {
            const label = String(s.name || '').trim();
            if (!label) return;
            const inStock = String(s.visibilityValue || '') === 'SHOW';
            if (seen.has(label)) {
              const prev = sizes.find((x) => x.label === label);
              if (prev && inStock) prev.inStock = true;
              return;
            }
            seen.add(label);
            sizes.push({ label, inStock, price: minor(s.price) });
          });
          const v = {
            color: String(c.name || c.id || ''),
            // Keep the page's other query params (?${cfg.productIdParam}=, style…):
            // they carry the API productId — a bare ?${cfg.colorParam}= URL
            // re-scrapes as "no sizes / sold out".
            url: (function () {
              try {
                const vu = new URL(location.href);
                vu.searchParams.set('${cfg.colorParam}', c.id);
                vu.hash = '';
                return vu.toString();
              } catch (e) {
                return location.origin + location.pathname + '?${cfg.colorParam}=' + c.id;
              }
            })(),
            imageUrl: xmediaImg[String(c.id)] || null,
            sizes,
            price: sizes.length ? sizes[0].price : (rows[0] ? minor(rows[0].price) : null),
          };
          // Sizeless color (e.g. perfume): stock from the raw SKU rows.
          if (!sizes.length && rows.length) v.inStock = rows.some((s) => String(s.visibilityValue || '') === 'SHOW');
          return v;
        }).filter((v) => v.color);
        out.colors = out.colorVariants.map((v) => v.color);
        // Active color: ?${cfg.colorParam}= in the URL, else ?${altColorParam}=, else first.
        const q = new URL(location.href).searchParams;
        const cS = q.get('${cfg.colorParam}') || q.get('${altColorParam}');
        let ai = cols.findIndex((c) => String(c.id) === String(cS));
        if (ai < 0) ai = 0;
        const active = out.colorVariants[ai];
        if (active) {
          if (active.sizes.length) {
            out.sizes = active.sizes;
            out.inStock = active.sizes.some((s) => s.inStock);
          } else if (typeof active.inStock === 'boolean') {
            out.inStock = active.inStock;
          }
          if (active.price != null) out.price = active.price;
          if (active.imageUrl) out.imageUrl = active.imageUrl;
        }
      }
    }
  } catch (e) {}

  // 4) Fallback — API gave no variants: DOM color swatches + size buttons.
  try {
    if (!out.colorVariants || !out.colorVariants.length) {
      const vars = [];
      const seen = new Set();
      document.querySelectorAll('[data-qa-anchor*="color" i] li, [class*="color-selector" i] li, [class*="colorSelector" i] li').forEach((li) => {
        const a = li.querySelector('a, button');
        const img = li.querySelector('img');
        const name = ((a && a.getAttribute('aria-label')) || (img && img.alt) || '').trim();
        if (!name || seen.has(name)) return;
        seen.add(name);
        vars.push({
          color: name,
          url: a && a.href ? a.href : null,
        });
      });
      if (vars.length) {
        out.colorVariants = vars;
        out.colors = vars.map((v) => v.color);
      }
    }
  } catch (e) {}
  try {
    if (!out.sizes.length) {
      // Scope to the FIRST size container only — a page-wide button sweep
      // merges size chips from recommendation carousels / other products
      // (e.g. "S M L … ONE SIZE 35 36 37" on Lefties).
      const cont = document.querySelector('[class*="size-selector" i], [data-qa-anchor*="size" i], [class*="sizeSelector" i]');
      const seen = new Set();
      const domSizes = [];
      (cont ? cont.querySelectorAll('button, li') : []).forEach((b) => {
        const label = (b.textContent || '').trim();
        if (!label || label.length > 12 || seen.has(label)) return;
        seen.add(label);
        const cls = (b.className || '').toString();
        const inStock = !b.disabled
          && b.getAttribute('aria-disabled') !== 'true'
          && !/disabled|out-of-stock|sold|tüken/i.test(cls);
        domSizes.push({ label, inStock });
      });
      if (domSizes.length) {
        out.sizes = domSizes;
        out.inStock = domSizes.some((s) => s.inStock);
      }
    }
  } catch (e) {}

  return out;
`;
}

export const PULLANDBEAR_PAGE_SCRIPT = makeItxrestScript({
  colorParam: "cS",
  productIdParam: "pelement",
  pinned: {
    storeId: "25009521",
    catalogId: "20309457",
    note: "P&B TR store/catalog IDs observed live on 2026-07-13",
  },
});

export const LEFTIES_PAGE_SCRIPT = makeItxrestScript({
  colorParam: "colorId",
  productIdParam: "parentId",
  pinned: {
    storeId: "94009021",
    catalogId: "90009064",
    note: "Lefties TR store/catalog IDs observed live on 2026-07-17",
  },
  // The TR site serves /tr/en (English) — the store's own calls use -1.
  defaultLangId: "-1",
});

/**
 * SHARED core for non-Inditex stores: name/price/currency/image/stock via
 * JSON-LD Product + og/meta fallback (universal signals). Fills the `out`
 * object and does NOT `return` — a brand-specific size block is appended and
 * `return out;` goes at the end.
 */
const STORE_CORE_SCRIPT = `
  const out = { name: "", price: null, currency: null, imageUrl: null, colors: [], sizes: [], inStock: false };

  // 1) JSON-LD: find the Product node
  const blocks = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  let product = null;
  for (const b of blocks) {
    try {
      const data = JSON.parse(b.textContent || "null");
      const arr = Array.isArray(data) ? data : (data && data['@graph'] ? data['@graph'] : [data]);
      for (const n of arr) {
        const t = n && n['@type'];
        if (t === 'Product' || (Array.isArray(t) && t.includes('Product'))) { product = n; break; }
      }
    } catch (e) {}
    if (product) break;
  }

  const instockStr = (s) => typeof s === 'string' && s.toLowerCase().replace(/[^a-z]/g,'').indexOf('instock') !== -1;

  if (product) {
    out.name = product.name || "";
    if (typeof product.image === 'string') out.imageUrl = product.image;
    else if (Array.isArray(product.image)) out.imageUrl = product.image[0] || null;
    else if (product.image && product.image.url) out.imageUrl = product.image.url;

    // offers: Offer | AggregateOffer | array
    let offers = product.offers ? (Array.isArray(product.offers) ? product.offers : [product.offers]) : [];
    const flat = [];
    for (const o of offers) {
      if (o && o['@type'] === 'AggregateOffer') {
        if (out.price == null && (o.lowPrice != null || o.price != null)) out.price = parseFloat(o.lowPrice != null ? o.lowPrice : o.price);
        if (!out.currency && o.priceCurrency) out.currency = o.priceCurrency;
        const inner = o.offers ? (Array.isArray(o.offers) ? o.offers : [o.offers]) : [];
        inner.forEach((x) => flat.push(x));
        if (o.availability && instockStr(o.availability)) out.inStock = true;
      } else if (o) {
        flat.push(o);
      }
    }
    for (const o of flat) {
      if (out.price == null && o.price != null) out.price = parseFloat(o.price);
      if (!out.currency && o.priceCurrency) out.currency = o.priceCurrency;
      if (instockStr(o.availability)) out.inStock = true;
    }
  }

  // 1b) If JSON-LD is missing/incomplete: meta tags + DOM fallback.
  const metaContent = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return el.getAttribute('content') || el.getAttribute('value') || (el.textContent || '').trim() || null;
  };
  if (!out.name) {
    out.name = metaContent('meta[property="og:title"]') || (document.title || '').trim() || '';
  }
  if (!out.imageUrl) {
    out.imageUrl = metaContent('meta[property="og:image"]');
  }
  if (out.price == null) {
    // TR number format: "6.159,00" = 6159.0 (dot=thousands, comma=decimal).
    const parseTRNumber = (input) => {
      let s = String(input).replace(/[^\\d.,]/g, '');
      if (!s) return null;
      if (s.indexOf(',') !== -1) s = s.replace(/\\./g, '').replace(',', '.');
      else if ((s.match(/\\./g) || []).length > 1) s = s.replace(/\\./g, '');
      else if (/^\\d{1,3}\\.\\d{3}$/.test(s)) s = s.replace('.', '');
      const n = parseFloat(s);
      return isNaN(n) ? null : n;
    };
    const raw = metaContent('meta[property="product:price:amount"]')
      || metaContent('meta[property="og:price:amount"]')
      || metaContent('[itemprop="price"]');
    if (raw) { const n = parseTRNumber(raw); if (n != null) out.price = n; }
  }
  if (!out.currency) {
    out.currency = metaContent('meta[property="product:price:currency"]')
      || metaContent('meta[property="og:price:currency"]')
      || metaContent('[itemprop="priceCurrency"]');
  }
`;

/** Generic size block: best-effort from the DOM (wide token — letters + numeric + half sizes). */
const GENERIC_SIZE_BLOCK = `
  try {
    const TOKEN = /^(XXS|XS|S|M|L|XL|XXL|XXXL|[2-6]XL|ONE SIZE|TEK BEDEN|STD|STD\\.|U|\\d{1,3}([.,/]\\d{1,2})?)$/i;
    const SEL = 'button, li, [role="button"], [role="option"], [role="radio"], label, a';
    function collect() {
      const cands = Array.from(document.querySelectorAll(SEL))
        .filter((e) => TOKEN.test((e.innerText || '').trim()) && e.children.length <= 1);
      const byParent = new Map();
      cands.forEach((e) => {
        const p = e.parentElement; if (!p) return;
        (byParent.get(p) || byParent.set(p, []).get(p)).push(e);
      });
      let group = [];
      byParent.forEach((arr) => { if (arr.length > group.length) group = arr; });
      return group;
    }

    let els = collect();
    if (els.length < 2) {
      const cta = Array.from(document.querySelectorAll('button, [role="button"], a')).find((b) => {
        const t = (b.innerText || b.getAttribute('aria-label') || '').trim();
        return /SEPETE EKLE|SEPETE AT|ADD TO (BAG|CART|BASKET)|BEDEN SEÇ|BEDEN SEÇİN/i.test(t) && !/istek|wishlist|favori/i.test(t);
      });
      if (cta) { try { cta.click(); } catch (e) {} await __sleep(1800); }
      els = collect();
    }

    if (els.length >= 2) {
      const seen = new Set();
      const domSizes = [];
      els.forEach((e) => {
        const label = (e.innerText || '').trim();
        if (!label || seen.has(label)) return;
        seen.add(label);
        const cls = (e.className || '').toString();
        const ariaDis = e.getAttribute('aria-disabled');
        const disabled = e.disabled || ariaDis === 'true'
          || /out-of-stock|disabled|unavailable|passive|sold|tüken|yok/i.test(cls);
        domSizes.push({ label, inStock: !disabled });
      });
      if (domSizes.length) {
        out.sizes = domSizes;
        out.inStock = domSizes.some((s) => s.inStock);
      }
    }
  } catch (e) {}
`;

/**
 * Platform-agnostic extraction for generic non-Inditex TR e-commerce sites
 * (T-Soft, Ikas, SFCC etc.): shared core + best-effort size block.
 */
export const GENERIC_PAGE_SCRIPT =
  STORE_CORE_SCRIPT + GENERIC_SIZE_BLOCK + "\n  return out;\n";

/**
 * SneaksUp (Ticimax) size block: `.size-options-item`; an in-stock item carries
 * the `in-stock-attribute-item` class, the size text is `.size-options-item-value`.
 * The page may have one visible + one `d-none` block; deduplicated by label.
 */
const SNEAKSUP_SIZE_BLOCK = `
  try {
    const seen = new Set();
    const domSizes = [];
    document.querySelectorAll('.size-options-item').forEach((it) => {
      const valEl = it.querySelector('.size-options-item-value') || it.querySelector('.size-options-item-label');
      const label = ((valEl ? valEl.textContent : it.textContent) || '').trim();
      if (!label || seen.has(label)) return;
      seen.add(label);
      const cls = (it.className || '').toString();
      const inStock = /in-stock-attribute-item/i.test(cls)
        && !/out-of-stock|passive|disabled|tüken|sold/i.test(cls);
      domSizes.push({ label, inStock });
    });
    if (domSizes.length) { out.sizes = domSizes; out.inStock = domSizes.some((s) => s.inStock); }
  } catch (e) {}
`;

export const SNEAKSUP_PAGE_SCRIPT =
  STORE_CORE_SCRIPT + SNEAKSUP_SIZE_BLOCK + "\n  return out;\n";

/**
 * Boyner (React/CSS-module) size block: row `[class*="selectSizeOption__"]`,
 * label is the `<h5>` inside `[class*="selectSizeOptionLabel"]`. The size panel
 * is collapsed (`max-height:0`), so `innerText` returns empty — `textContent`
 * is used. Out-of-stock sizes carry "Tükendi"/similar text in the right slot
 * or a disabled class.
 */
const BOYNER_SIZE_BLOCK = `
  try {
    const seen = new Set();
    const domSizes = [];
    document.querySelectorAll('[class*="selectSizeOption__"]').forEach((o) => {
      const lab = o.querySelector('[class*="selectSizeOptionLabel"]');
      const raw = ((lab ? lab.textContent : o.textContent) || '').replace(/\\s+/g, ' ').trim();
      // The label may contain status text like "M - Tükendi": extract the size, process the status.
      const label = raw.replace(/\\s*[-–—]?\\s*(tükendi|kalmadı|stokta yok).*$/i, '').trim();
      if (!label || seen.has(label)) return;
      seen.add(label);
      const rightEl = o.querySelector('[class*="selectSizeOptionRight"]');
      const right = ((rightEl && rightEl.textContent) || '').trim();
      const cls = (o.className || '').toString();
      const inStock = !/tüken|kalmad|stokta yok|out.?of.?stock|son\\s*0\\b/i.test(raw + ' ' + right)
        && !/disabled|passive/i.test(cls);
      domSizes.push({ label, inStock });
    });
    if (domSizes.length) { out.sizes = domSizes; out.inStock = domSizes.some((s) => s.inStock); }
  } catch (e) {}
`;

export const BOYNER_PAGE_SCRIPT =
  STORE_CORE_SCRIPT + BOYNER_SIZE_BLOCK + "\n  return out;\n";

/**
 * Wunder (Ikas) size block: `.variant-types` elements; size text is `.variant-name`.
 * A sold-out size carries the `cursor-not-allowed pointer-events-none` class and
 * `disabled` on `.variant-name`. Sold-out sizes are listed too (`inStock:false`)
 * so the user can track them for a restock notification.
 * (The generic script wrongly picked up a thumbnail/slider strip here as
 * `1 2 3 4 5` — hence brand-specific.)
 */
const WUNDER_SIZE_BLOCK = `
  try {
    const seen = new Set();
    const domSizes = [];
    document.querySelectorAll('.variant-types').forEach((v) => {
      const nameEl = v.querySelector('.variant-name');
      const label = ((nameEl ? nameEl.textContent : v.textContent) || '').trim();
      if (!label || seen.has(label)) return;
      seen.add(label);
      const cls = (v.className || '').toString();
      const nameCls = ((nameEl && nameEl.className) || '').toString();
      const inStock = !/cursor-not-allowed|pointer-events-none|disabled|passive/i.test(cls)
        && !/disabled/i.test(nameCls);
      domSizes.push({ label, inStock });
    });
    if (domSizes.length) { out.sizes = domSizes; out.inStock = domSizes.some((s) => s.inStock); }
  } catch (e) {}
`;

export const WUNDER_PAGE_SCRIPT =
  STORE_CORE_SCRIPT + WUNDER_SIZE_BLOCK + "\n  return out;\n";

/**
 * Victoria's Secret size block: real sizes live in `.size_box` elements
 * (XS/S/M/L/XL). A sold-out size carries the `size_box nostok` class and its
 * text contains a "TÜKENDİ … HABERİN OLSUN" tooltip — hence the leading size
 * token is extracted. Sold-out sizes are listed too with `inStock:false`.
 * (The generic script mistook "5.600,00TL" inside `.PriceList` for sizes
 * `5 6 7 8 9` — hence brand-specific.)
 */
const VICTORIASSECRET_SIZE_BLOCK = `
  try {
    const TOKEN = /^(XXS|XS|S|M|L|XL|XXL|XXXL|[2-6]XL|\\d{1,3}([.,]\\d)?)/i;
    const seen = new Set();
    const domSizes = [];
    document.querySelectorAll('.size_box').forEach((el) => {
      const raw = (el.textContent || '').replace(/\\s+/g, ' ').trim();
      const m = raw.match(TOKEN);
      const label = m ? m[1].toUpperCase() : '';
      if (!label || seen.has(label)) return;
      seen.add(label);
      const cls = (el.className || '').toString();
      const inStock = !/nostok|no-stock|tüken|passive|disabled/i.test(cls);
      domSizes.push({ label, inStock });
    });
    if (domSizes.length) { out.sizes = domSizes; out.inStock = domSizes.some((s) => s.inStock); }
  } catch (e) {}
`;

export const VICTORIASSECRET_PAGE_SCRIPT =
  STORE_CORE_SCRIPT + VICTORIASSECRET_SIZE_BLOCK + "\n  return out;\n";

/**
 * Mango (Next.js/RSC) block: no JSON-LD; name/image come from og meta (read by
 * the core). The primary source is the RSC flight payload (\`self.__next_f\`):
 * per color it holds a clean size list (\`available\`/\`isDelayed\`), price
 * (\`prices.price\`) and image (\`looks[*].media[0].src\`); \`out.colorVariants\`
 * is filled from it (color URL = the \`.../{productId}/{colorId}/{look}\` color
 * segment in the pathname). \`isDelayed:true\` counts as in stock — only the
 * shipping time is longer; in the DOM those sizes get "Kargoya teslimat tahmini
 * N iş günüdür" appended to the button text, so DOM reading is a fallback that
 * runs only when the payload is not found, and labels not matching the size
 * token are dropped.
 * Price fallback: a discounted product has TWO \`itemprop="price"\` metas — the
 * first is the struck-through old price, the LAST is the real sale price.
 * Sizeless products (bags etc.) have no availability meta — the EKLE/ADD button
 * is the stock signal.
 */
const MANGO_BLOCK = `
  try {
    // og:title has the form "Product name - Kadın | MANGO Türkiye": drop the tail.
    out.name = out.name
      .replace(/\\s*\\|\\s*MANGO.*$/i, '')
      .replace(/\\s*-\\s*(Kadın|Erkek|Çocuk|Genç|Bebek)\\s*$/i, '')
      .trim();
  } catch (e) {}
  try {
    const priceMetas = document.querySelectorAll('meta[itemprop="price"]');
    if (priceMetas.length > 1) {
      const v = parseFloat(priceMetas[priceMetas.length - 1].getAttribute('content') || '');
      if (!isNaN(v)) out.price = v;
    }
  } catch (e) {}

  // 1) RSC flight payload: colors + per-color sizes/price/image.
  try {
    let flight = '';
    if (Array.isArray(self.__next_f)) {
      flight = self.__next_f
        .map((x) => (Array.isArray(x) && typeof x[1] === 'string') ? x[1] : '')
        .join('');
    }
    if (flight.indexOf('"colors":[') === -1) {
      // Hydration drains __next_f; the data stays escaped inside the
      // self.__next_f.push([1,"..."]) string literals in the scripts —
      // slice the literal and decode with JSON.parse.
      const parts = [];
      document.querySelectorAll('script').forEach((s) => {
        const t = s.textContent || '';
        const a = t.indexOf('__next_f.push([1,"');
        if (a === -1) return;
        const b = t.lastIndexOf('"])');
        if (b <= a) return;
        try { parts.push(JSON.parse('"' + t.slice(a + 18, b) + '"')); } catch (e) {}
      });
      flight = parts.join('');
    }
    // Slice the JSON array after '"colors":' with a string-aware balanced scan.
    const sliceArray = (text, from) => {
      let depth = 0, inStr = false, esc = false;
      for (let k = from; k < text.length; k++) {
        const ch = text[k];
        if (esc) { esc = false; continue; }
        if (ch === '\\\\') { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === '[') depth++;
        else if (ch === ']') { depth--; if (!depth) return text.slice(from, k + 1); }
      }
      return null;
    };
    let cols = null;
    let idx = 0;
    while (!cols) {
      const at = flight.indexOf('"colors":[', idx);
      if (at === -1) break;
      idx = at + 1;
      const seg = sliceArray(flight, at + 9);
      if (!seg) continue;
      try {
        const arr = JSON.parse(seg);
        if (Array.isArray(arr) && arr.length && arr[0] && arr[0].label && Array.isArray(arr[0].sizes)) cols = arr;
      } catch (e) {}
    }
    if (cols) {
      const path = location.pathname.replace(/\\/+$/, '');
      const variants = cols.map((c) => {
        let imageUrl = null;
        if (c.looks) {
          for (const k in c.looks) {
            const media = c.looks[k] && c.looks[k].media;
            if (Array.isArray(media) && media.length && media[0].src) { imageUrl = media[0].src; break; }
          }
        }
        let url = null;
        const parts = path.split('/');
        if (parts.length >= 3) {
          parts[parts.length - 2] = String(c.id);
          url = location.origin + parts.join('/');
        }
        return {
          color: String(c.label || c.id || ''),
          url,
          imageUrl,
          sizes: Array.isArray(c.sizes)
            ? c.sizes
                .map((s) => ({ label: String(s.label || s.shortDescription || '').trim(), inStock: !!s.available }))
                .filter((s) => s.label)
            : [],
          price: (c.prices && typeof c.prices.price === 'number') ? c.prices.price : null,
        };
      }).filter((v) => v.color);
      if (variants.length) {
        out.colorVariants = variants;
        out.colors = variants.map((v) => v.color);
        // The color segment in the URL (.../{productId}/{colorId}/{look}) determines the active color.
        const segs = path.split('/').filter(Boolean);
        const colorId = segs.length >= 2 ? segs[segs.length - 2] : null;
        let activeIdx = cols.findIndex((c) => String(c.id) === String(colorId));
        if (activeIdx < 0) activeIdx = 0;
        const active = variants[activeIdx];
        if (active.sizes.length) {
          out.sizes = active.sizes;
          out.inStock = active.sizes.some((s) => s.inStock);
        }
        if (active.price != null) out.price = active.price;
        if (active.imageUrl) out.imageUrl = active.imageUrl;
      }
    }
  } catch (e) {}

  // 2) DOM fallback — only if the payload gave no sizes.
  try {
    if (!out.sizes.length) {
    const SIZE_TOKEN = /^(XXS|XS|S|M|L|XL|XXL|XXXL|[1-6]XL|ONE SIZE|TEK BEDEN|\\d{1,3}([.,]\\d{1,2})?)$/i;
    const seen = new Set();
    const domSizes = [];
    document.querySelectorAll('button[class*="SizeItem-module"]').forEach((b) => {
      const raw = (b.textContent || '').replace(/\\s+/g, ' ').trim();
      // Status is appended to the button text: "36Mevcut değil. İstiyorum!",
      // "XLKargoya teslimat tahmini 5 iş günüdür", "S2-4 iş günü içinde teslimat".
      const label = raw
        .replace(/\\s*(Mevcut değil|İstiyorum|Son ürünler|Benzerlerine bak|Kargoya teslimat|iş günü|teslimat|Bildirim al|Beni bilgilendir).*$/i, '')
        .replace(/\\s*\\d+\\s*[-–]\\s*\\d*$/, '')
        .trim();
      if (!label || !SIZE_TOKEN.test(label) || seen.has(label)) return;
      seen.add(label);
      const cls = (b.className || '').toString();
      const notAvailable = /Mevcut değil|İstiyorum/i.test(raw);
      const inStock = !notAvailable
        && /selectable/i.test(cls)
        && !/disabled|unavailable|notify|soldout/i.test(cls)
        && !b.disabled;
      domSizes.push({ label, inStock });
    });
    if (domSizes.length) { out.sizes = domSizes; out.inStock = domSizes.some((s) => s.inStock); }
    }
  } catch (e) {}
  try {
    if (!out.sizes.length && !out.inStock) {
      const addBtn = Array.from(document.querySelectorAll('button'))
        .some((b) => /^(EKLE|ADD)$/i.test((b.innerText || '').trim()));
      if (addBtn) out.inStock = true;
    }
  } catch (e) {}
`;

export const MANGO_PAGE_SCRIPT =
  STORE_CORE_SCRIPT + MANGO_BLOCK + "\n  return out;\n";

/**
 * Sephora TR (Next.js RSC) block: no JSON-LD Product; the primary source is the
 * \`"variants"\` array in the RSC flight payload (\`self.__next_f\`) — per variant:
 * id, name, its own product-page URL, thumbnailImage (real product photo,
 * upscalable via \`scaleWidth/scaleHeight\`), image (color chip/swatch),
 * isAvailable and price. The name pattern determines the variant kind: if ALL
 * names are pure sizes ("10 ml", "50 g") it is a size product → variants become
 * \`sizes[]\` (price per size); otherwise a color product → \`colorVariants[]\`
 * (image/price/stock change on color selection, tracking uses the color-specific
 * URL) and \`sizes\` stays empty.
 * The active variant is the one whose url matches the page pathname — price/stock
 * come from it. Fallback: microdata \`itemtype="...Offer"\` scopes (when the
 * flight is not found) — the name tail ("Product Name - 10 ml") is listed as
 * the size label.
 */
const SEPHORA_BLOCK = `
  try {
    // og:title has the form "Product name | BRAND ≡ SEPHORA": drop the tail.
    out.name = out.name.replace(/\\s*\\|[^|]*≡\\s*SEPHORA\\s*$/i, '').trim();
  } catch (e) {}

  // 1) RSC flight payload: variants (color or size).
  try {
    let flight = '';
    if (Array.isArray(self.__next_f)) {
      flight = self.__next_f
        .map((x) => (Array.isArray(x) && typeof x[1] === 'string') ? x[1] : '')
        .join('');
    }
    if (flight.indexOf('"variants":[') === -1) {
      // Hydration drains __next_f; the data stays escaped inside the
      // self.__next_f.push([1,"..."]) string literals in the scripts.
      const parts = [];
      document.querySelectorAll('script').forEach((s) => {
        const t = s.textContent || '';
        const a = t.indexOf('__next_f.push([1,"');
        if (a === -1) return;
        const b = t.lastIndexOf('"])');
        if (b <= a) return;
        try { parts.push(JSON.parse('"' + t.slice(a + 18, b) + '"')); } catch (e) {}
      });
      flight = parts.join('');
    }
    // Slice the JSON array after '"variants":' with a string-aware balanced scan.
    const sliceArray = (text, from) => {
      let depth = 0, inStr = false, esc = false;
      for (let k = from; k < text.length; k++) {
        const ch = text[k];
        if (esc) { esc = false; continue; }
        if (ch === '\\\\') { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === '[') depth++;
        else if (ch === ']') { depth--; if (!depth) return text.slice(from, k + 1); }
      }
      return null;
    };
    let vars = null;
    let idx = 0;
    while (!vars) {
      const at = flight.indexOf('"variants":[', idx);
      if (at === -1) break;
      idx = at + 1;
      const seg = sliceArray(flight, at + 11);
      if (!seg) continue;
      try {
        const arr = JSON.parse(seg);
        if (Array.isArray(arr) && arr.length && arr[0] && arr[0].id && arr[0].name) vars = arr;
      } catch (e) {}
    }
    if (vars) {
      const here = location.pathname.replace(/\\/$/, '');
      const isCurrent = (v) => {
        try { return new URL(v.url || '', location.href).pathname.replace(/\\/$/, '') === here; }
        catch (e) { return false; }
      };
      let active = vars.find(isCurrent) || vars[0];
      const SIZE_ONLY = /^\\d+([.,]\\d+)?\\s*(ml|g|gr)\\.?$/i;
      if (vars.every((v) => SIZE_ONLY.test(String(v.name || '').trim()))) {
        // Size product (perfume etc.): variants are the size list, price per size.
        out.sizes = vars.map((v) => ({
          label: String(v.name).trim(),
          inStock: !!v.isAvailable,
          price: (typeof v.price === 'number') ? v.price : null,
        }));
      } else {
        // Color product (shade): per-color image/price/stock + color-specific URL.
        const upscale = (src) => {
          try {
            const u = new URL(src, location.href);
            u.searchParams.set('scaleWidth', '750');
            u.searchParams.set('scaleHeight', '750');
            return u.toString();
          } catch (e) { return src || null; }
        };
        out.colorVariants = vars.map((v) => ({
          // Drop the trailing size parenthetical: "Original Rose/Gloss (5.2 ml)" → "Original Rose/Gloss"
          color: String(v.name || '').replace(/\\s*\\([^)]*\\)\\s*$/, '').trim(),
          url: v.url || null,
          // image.src (media_swatch) is the shade's real product photo; the
          // thumbnail is a fallback only with its native parameters (the CDN
          // does not upscale thumbnails — changing the scale params returns empty).
          imageUrl: (v.image && v.image.src)
            ? upscale(v.image.src)
            : ((v.thumbnailImage && v.thumbnailImage.src) || null),
          price: (typeof v.price === 'number') ? v.price : null,
          inStock: !!v.isAvailable,
        })).filter((v) => v.color);
        out.colors = out.colorVariants.map((v) => v.color);
      }
      if (active) {
        if (typeof active.price === 'number') out.price = active.price;
        if (active.currency) out.currency = active.currency;
        out.inStock = !!active.isAvailable;
      }
    }
  } catch (e) {}

  // 2) Microdata fallback — only if the flight gave no variants.
  try {
    if (!out.sizes.length && !(out.colorVariants && out.colorVariants.length)) {
    const offers = Array.from(document.querySelectorAll('[itemtype="https://schema.org/Offer"], [itemtype="http://schema.org/Offer"]'));
    const prop = (scope, name) => {
      const el = scope.querySelector('[itemprop="' + name + '"]');
      if (!el) return null;
      return el.getAttribute('content') || el.getAttribute('href') || (el.textContent || '').trim() || null;
    };
    const here = location.pathname.replace(/\\/$/, '');
    const seen = new Set();
    const variants = [];
    for (const o of offers) {
      const name = prop(o, 'name') || '';
      const m = name.match(/\\s-\\s([^-]+)$/);
      const label = (m ? m[1] : name).trim() || (prop(o, 'sku') || '');
      if (!label || seen.has(label)) continue;
      seen.add(label);
      const avail = prop(o, 'availability') || '';
      const inStock = /instock/i.test(avail.replace(/[^a-z]/gi, ''));
      let current = false;
      try {
        const u = new URL(prop(o, 'url') || '', location.href);
        current = u.pathname.replace(/\\/$/, '') === here;
      } catch (e) {}
      const price = parseFloat(prop(o, 'price') || '');
      variants.push({ label, inStock, current, price: isNaN(price) ? null : price, currency: prop(o, 'priceCurrency') });
    }
    if (variants.length) {
      out.sizes = variants.map((v) => ({ label: v.label, inStock: v.inStock, price: v.price }));
      const cur = variants.find((v) => v.current) || variants[0];
      if (cur.price != null) out.price = cur.price;
      if (cur.currency) out.currency = cur.currency;
      out.inStock = cur.inStock;
    }
    }
  } catch (e) {}
`;

export const SEPHORA_PAGE_SCRIPT =
  STORE_CORE_SCRIPT + SEPHORA_BLOCK + "\n  return out;\n";

/**
 * Gratis (Next.js RSC) block: JSON-LD Product exists but its \`price\` is a
 * promo price in minor units (18950 = the conditional "over 250 TL" campaign)
 * — not used. The primary source is the RSC flight payload (\`self.__next_f\`):
 * - \`"productData":{"product":{...}}\` — \`prices.discountedPrice\` (minor units, /100),
 *   \`stockStatus\` ("HIGH"/"LOW"/"NONE"), main image \`imageUrls[0]\`.
 * - \`"variants":[{color, colorUrl (swatch image), shareLink (color-specific URL)}]\`
 *   → \`colorVariants\` (on color selection, tracking uses the color-specific URL).
 *   Per-variant price/stock are absent from the payload — the fields are omitted
 *   and the UI falls back to the product-wide values. \`imageUrl\` is omitted too:
 *   the payload has no REAL product photo for the variant, only a color chip
 *   (swatch, \`...-variant_...jpg\`) — a swatch must not be shown as the product
 *   image. The UI falls back to the main photo; once the scheduler scrapes the
 *   tracked variant from its own page (\`recordCheck\`), the real photo arrives
 *   by itself.
 * Cosmetics: no sizes, \`sizes\` stays empty.
 */
const GRATIS_BLOCK = `
  try {
    let flight = '';
    if (Array.isArray(self.__next_f)) {
      flight = self.__next_f
        .map((x) => (Array.isArray(x) && typeof x[1] === 'string') ? x[1] : '')
        .join('');
    }
    if (flight.indexOf('"productData"') === -1) {
      // Hydration drains __next_f; the data stays escaped inside the
      // self.__next_f.push([1,"..."]) string literals in the scripts.
      const parts = [];
      document.querySelectorAll('script').forEach((s) => {
        const t = s.textContent || '';
        const a = t.indexOf('__next_f.push([1,"');
        if (a === -1) return;
        const b = t.lastIndexOf('"])');
        if (b <= a) return;
        try { parts.push(JSON.parse('"' + t.slice(a + 18, b) + '"')); } catch (e) {}
      });
      flight = parts.join('');
    }
    // Slice the JSON value after '"<key>":' with a string-aware balanced scan.
    const sliceBalanced = (text, from, open, close) => {
      let depth = 0, inStr = false, esc = false;
      for (let k = from; k < text.length; k++) {
        const ch = text[k];
        if (esc) { esc = false; continue; }
        if (ch === '\\\\') { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === open) depth++;
        else if (ch === close) { depth--; if (!depth) return text.slice(from, k + 1); }
      }
      return null;
    };
    const parseAt = (marker, open, close) => {
      let idx = 0;
      while (true) {
        const at = flight.indexOf(marker, idx);
        if (at === -1) return null;
        idx = at + 1;
        const seg = sliceBalanced(flight, at + marker.length - 1, open, close);
        if (!seg) continue;
        try { return JSON.parse(seg); } catch (e) {}
      }
    };

    // 1) Product-wide: price (minor units) + stock + image.
    const pd = parseAt('"productData":{', '{', '}');
    const prod = pd && pd.product;
    if (prod) {
      const prices = prod.prices || {};
      const kurus = (typeof prices.discountedPrice === 'number')
        ? prices.discountedPrice
        : ((typeof prices.normalPrice === 'number') ? prices.normalPrice : null);
      if (kurus != null) out.price = kurus / 100;
      if (prices.currency) out.currency = prices.currency;
      if (typeof prod.stockStatus === 'string') {
        out.inStock = prod.stockStatus.toUpperCase() !== 'NONE';
      }
      if (Array.isArray(prod.imageUrls) && prod.imageUrls[0] && prod.imageUrls[0].fileUrl) {
        out.imageUrl = prod.imageUrls[0].fileUrl;
      }
    }

    // 2) Color variants (shades) — color-specific URL + swatch image.
    let vars = null;
    let idx = 0;
    while (!vars) {
      const at = flight.indexOf('"variants":[', idx);
      if (at === -1) break;
      idx = at + 1;
      const seg = sliceBalanced(flight, at + 11, '[', ']');
      if (!seg) continue;
      try {
        const arr = JSON.parse(seg);
        if (Array.isArray(arr) && arr.length && arr[0] && arr[0].color && arr[0].shareLink) vars = arr;
      } catch (e) {}
    }
    if (vars) {
      out.colorVariants = vars.map((v) => ({
        color: String(v.color || '').trim(),
        url: v.shareLink || null,
      })).filter((v) => v.color);
      out.colors = out.colorVariants.map((v) => v.color);
    }
  } catch (e) {}
`;

export const GRATIS_PAGE_SCRIPT =
  STORE_CORE_SCRIPT + GRATIS_BLOCK + "\n  return out;\n";
