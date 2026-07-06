/**
 * Inditex markalarının ürün sayfalarında bulunan JSON-LD (`application/ld+json`)
 * Product şemasından stok/fiyat çıkaran ortak script. Gizli BrowserWindow içinde
 * `executeJavaScript` ile çalışır ve ham ürün nesnesi döndürür.
 *
 * Markalar aynı e-ticaret platformunu paylaştığı için JSON-LD yapısı benzerdir;
 * gerekirse marka-özel script ile override edilebilir.
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
  // ProductGroup (hasVariant) yayınlayan sayfalar: varyantları Offer listesine çevirip
  // aynı akışı kullan (o.name = beden etiketi; "S (US S)" → "S").
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
    // Sadece insan-okur beden etiketlerini kabul et; SKU kodlarını (uzun/çizgili) ele.
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
  // Renk: sayfadaki seçili/aktif renk öğelerinden topla (best-effort)
  try {
    const colorEls = document.querySelectorAll('[data-qa-qualifier="product-detail-color-selector"] [aria-label], [class*="color"] [aria-label]');
    const set = new Set();
    colorEls.forEach(el => { const t = (el.getAttribute('aria-label') || '').trim(); if (t) set.add(t); });
    out.colors = Array.from(set).slice(0, 20);
  } catch (e) {}

  // Beden: bilinen beden-konteynerlerinden, gerekirse CTA tıklayıp DOM'dan oku.
  try {
    const TOKEN = /^(XXS|XS|S|M|L|XL|XXL|XXXL|[2-6]XL|ONE SIZE|TEK BEDEN|\\d{2}(?:[\\/\\-]\\d{2})?)$/i;
    const CONTAINERS = '.size-selector__list, [class*="size-selector" i], [class*="sizeList" i], [class*="size-list" i], [class*="sizes__list" i], [data-qa-qualifier*="size" i]';

    // Bilinen konteynerlerden beden öğelerini topla (en kalabalık tag setini al).
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

    // Tüm doküman üzerinden ortak ebeveyne göre yedek gruplama.
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
      // Beden paneli kapalıysa: yalnızca SEPETE EKLE / ADD TO BAG'e tıkla (wishlist'e değil).
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
 * Zara'ya özel: JSON-LD'den ad/fiyat/görsel + "ADD" panelini açıp beden seçiciden
 * temiz beden etiketleri (XS/S/M/L) ve stok durumu (`data-qa-action`).
 * Async — beden paneli etkileşimle yüklendiği için bekleme gerekir.
 */
export const ZARA_PAGE_SCRIPT = `
  const out = { name: "", price: null, currency: null, imageUrl: null, colors: [], sizes: [], inStock: false };

  // 1) JSON-LD: ad / fiyat / para birimi / görsel
  // Zara 2026'da Product yerine ProductGroup (hasVariant: beden başına Offer) yayınlıyor.
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
      // "S (US S)" → "S": parantezli ABD karşılığını at, yerel bedeni tut.
      const label = v.size ? String(v.size).replace(/\\s*\\(US[^)]*\\)/i, '').trim() : '';
      if (label && !seen.has(label)) {
        seen.add(label);
        out.sizes.push({ label, inStock: !!(o && instockStr(o.availability)) });
      }
    }
    if (colorSet.size) out.colors = Array.from(colorSet);
  }

  // 2) Renk: seçili renk adı
  try {
    const cn = document.querySelector('.product-detail-color-selector__selected-color-name, .product-detail-info__color');
    if (cn && cn.innerText.trim() && !out.colors.length) out.colors = [cn.innerText.trim()];
    const colorBtns = document.querySelectorAll('.product-detail-color-selector__color-button[aria-label], [class*="color-selector"] button[aria-label]');
    const set = new Set(out.colors);
    colorBtns.forEach(b => { const t = (b.getAttribute('aria-label')||'').trim(); if (t) set.add(t); });
    if (set.size) out.colors = Array.from(set).slice(0, 20);
  } catch (e) {}

  // 3) JSON-LD beden vermediyse: beden panelini aç (ADD) → beden seçiciyi oku
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

  // 4) Renk varyantları — birincil: window.zara.viewPayload (renk başına productId=v1,
  // görsel, bedenler, kuruş cinsinden fiyat); yedek: JSON-LD hasVariant (URL'siz).
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
  // Renk etiket listesi varyantlarla tutarlı kalsın (buton sırası = varyant sırası).
  if (out.colorVariants && out.colorVariants.length) {
    out.colors = out.colorVariants.map((v) => v.color);
  }

  out.inStock = out.sizes.some(s => s.inStock)
    || (product && JSON.stringify(product.offers||{}).toLowerCase().indexOf('instock') !== -1);
  return out;
`;

/**
 * Inditex dışı mağazalar için ORTAK çekirdek: JSON-LD Product + og/meta yedeği ile
 * ad/fiyat/para birimi/görsel/stok (evrensel sinyaller). `out` nesnesini doldurur,
 * `return` ETMEZ — marka-özel beden bloğu eklenip sonuna `return out;` konur.
 */
const STORE_CORE_SCRIPT = `
  const out = { name: "", price: null, currency: null, imageUrl: null, colors: [], sizes: [], inStock: false };

  // 1) JSON-LD: Product düğümünü bul
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

    // offers: Offer | AggregateOffer | dizi
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

  // 1b) JSON-LD eksik/eksiltili ise meta etiketleri + DOM yedeği.
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
    // TR sayı formatı: "6.159,00" = 6159.0 (nokta=binlik, virgül=ondalık).
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

/** Genel beden bloğu: DOM'dan en iyi çaba (geniş token — harf + sayısal + yarım numara). */
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
 * Inditex dışı genel TR e-ticaret siteleri (T-Soft, Ikas, SFCC vb.) için
 * platform-bağımsız çıkarım: ortak çekirdek + en iyi çaba beden bloğu.
 */
export const GENERIC_PAGE_SCRIPT = STORE_CORE_SCRIPT + GENERIC_SIZE_BLOCK + "\n  return out;\n";

/**
 * SneaksUp (Ticimax) beden bloğu: `.size-options-item`; stokta olan öğe
 * `in-stock-attribute-item` class'ı taşır, beden metni `.size-options-item-value`.
 * Sayfada bir görünür + bir `d-none` blok olabilir; etikete göre tekilleştirilir.
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

export const SNEAKSUP_PAGE_SCRIPT = STORE_CORE_SCRIPT + SNEAKSUP_SIZE_BLOCK + "\n  return out;\n";

/**
 * Boyner (React/CSS-module) beden bloğu: satır `[class*="selectSizeOption__"]`,
 * etiket `[class*="selectSizeOptionLabel"]` içindeki `<h5>`. Beden paneli kapalı
 * (`max-height:0`) olduğundan `innerText` boş döner — `textContent` kullanılır.
 * Stok dışı bedenler sağ slotta "Tükendi"/benzeri metin ya da disabled class taşır.
 */
const BOYNER_SIZE_BLOCK = `
  try {
    const seen = new Set();
    const domSizes = [];
    document.querySelectorAll('[class*="selectSizeOption__"]').forEach((o) => {
      const lab = o.querySelector('[class*="selectSizeOptionLabel"]');
      const raw = ((lab ? lab.textContent : o.textContent) || '').replace(/\\s+/g, ' ').trim();
      // Etiket "M - Tükendi" gibi durum metni içerebilir: bedeni ayıkla, durumu işle.
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

export const BOYNER_PAGE_SCRIPT = STORE_CORE_SCRIPT + BOYNER_SIZE_BLOCK + "\n  return out;\n";

/**
 * Wunder (Ikas) beden bloğu: `.variant-types` öğeleri; beden metni `.variant-name`.
 * Tükenmiş beden `cursor-not-allowed pointer-events-none` class'ı taşır ve
 * `.variant-name` üzerinde `disabled` olur. Tükenmiş bedenler de listelenir
 * (`inStock:false`) ki kullanıcı stok gelince bildirim için takip edebilsin.
 * (Genel script burada bir thumbnail/slider şeridini `1 2 3 4 5` diye yanlış
 * yakalıyordu — bu yüzden marka-özel.)
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

export const WUNDER_PAGE_SCRIPT = STORE_CORE_SCRIPT + WUNDER_SIZE_BLOCK + "\n  return out;\n";

/**
 * Victoria's Secret beden bloğu: gerçek bedenler `.size_box` öğelerinde
 * (XS/S/M/L/XL). Tükenmiş beden `size_box nostok` class'ı taşır ve metninde
 * "TÜKENDİ … HABERİN OLSUN" tooltip'i bulunur — bu yüzden baştaki beden token'ı
 * ayıklanır. Tükenmiş bedenler de `inStock:false` ile listelenir.
 * (Genel script yanlışlıkla `.PriceList` içindeki "5.600,00TL"yi `5 6 7 8 9` diye
 * beden sanıyordu — bu yüzden marka-özel.)
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
 * Mango (Next.js/RSC) bloğu: JSON-LD yok; ad/görsel og meta'dan (çekirdek okur).
 * Fiyat: indirimli üründe İKİ \`itemprop="price"\` meta'sı var — ilki üstü çizili
 * eski fiyat, SONUNCUSU gerçek satış fiyatı (çekirdek ilkini aldığı için düzeltilir).
 * Beden: \`SizeItem-module\` butonları; stokta olan "selectable" modifier'ı taşır.
 * Bedensiz ürünlerde (çanta vb.) availability meta'sı yok — EKLE/ADD butonu stok sinyali.
 */
const MANGO_BLOCK = `
  try {
    // og:title "Ürün adı - Kadın | MANGO Türkiye" biçiminde: kuyruğu at.
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
  try {
    const seen = new Set();
    const domSizes = [];
    document.querySelectorAll('button[class*="SizeItem-module"]').forEach((b) => {
      const raw = (b.textContent || '').replace(/\\s+/g, ' ').trim();
      // Tükenmiş bedende buton metnine durum eklenir: "36Mevcut değil. İstiyorum!".
      const label = raw.replace(/\\s*(Mevcut değil|İstiyorum|Son ürünler|Benzerlerine bak).*$/i, '').trim();
      if (!label || seen.has(label)) return;
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
  } catch (e) {}
  try {
    if (!out.sizes.length && !out.inStock) {
      const addBtn = Array.from(document.querySelectorAll('button'))
        .some((b) => /^(EKLE|ADD)$/i.test((b.innerText || '').trim()));
      if (addBtn) out.inStock = true;
    }
  } catch (e) {}
`;

export const MANGO_PAGE_SCRIPT = STORE_CORE_SCRIPT + MANGO_BLOCK + "\n  return out;\n";

/**
 * Sephora TR (SFCC) bloğu: JSON-LD Product yok; ürün verisi microdata'da.
 * Her boy varyantı gizli bir \`itemtype="https://schema.org/Offer"\` scope'udur:
 * price, priceCurrency, availability, url (varyantın kendi sayfası), sku ve
 * name ("Ürün Adı - 10 ml"). Aktif varyant, url'i sayfa pathname'iyle eşleşendir —
 * fiyat/stok ondan alınır; tüm varyantlar \`sizes[]\` olarak listelenir.
 */
const SEPHORA_BLOCK = `
  try {
    // og:title "Ürün adı | MARKA ≡ SEPHORA" biçiminde: kuyruğu at.
    out.name = out.name.replace(/\\s*\\|[^|]*≡\\s*SEPHORA\\s*$/i, '').trim();
  } catch (e) {}
  try {
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
  } catch (e) {}
`;

export const SEPHORA_PAGE_SCRIPT = STORE_CORE_SCRIPT + SEPHORA_BLOCK + "\n  return out;\n";
