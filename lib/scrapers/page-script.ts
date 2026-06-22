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
  let product = null;
  for (const b of blocks) {
    try {
      let data = JSON.parse(b.textContent || "null");
      const arr = Array.isArray(data) ? data : (data && data['@graph'] ? data['@graph'] : [data]);
      for (const node of arr) {
        if (node && (node['@type'] === 'Product' || (Array.isArray(node['@type']) && node['@type'].includes('Product')))) {
          product = node; break;
        }
      }
    } catch (e) {}
    if (product) break;
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
  }

  // 2) Renk: seçili renk adı
  try {
    const cn = document.querySelector('.product-detail-color-selector__selected-color-name, .product-detail-info__color');
    if (cn && cn.innerText.trim()) out.colors = [cn.innerText.trim()];
    const colorBtns = document.querySelectorAll('.product-detail-color-selector__color-button[aria-label], [class*="color-selector"] button[aria-label]');
    const set = new Set(out.colors);
    colorBtns.forEach(b => { const t = (b.getAttribute('aria-label')||'').trim(); if (t) set.add(t); });
    if (set.size) out.colors = Array.from(set).slice(0, 20);
  } catch (e) {}

  // 3) Beden panelini aç (ADD) → beden seçiciyi oku
  try {
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
  } catch (e) {}

  out.inStock = out.sizes.some(s => s.inStock)
    || (product && JSON.stringify(product.offers||{}).toLowerCase().indexOf('instock') !== -1);
  return out;
`;
