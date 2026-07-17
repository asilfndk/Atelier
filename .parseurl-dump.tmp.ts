import { getScraperForUrl } from "@/lib/scrapers";

const URLS = [
  "https://www.zara.com/tr/tr/dokulu-orme-elbise-p02334053.html?v1=410083232",
  "https://www.zara.com/us/en/woman-dresses-l1066.html",
  "https://www.bershka.com/tr/dokuma-mini-etek-c0p171norm175090.html?colorId=800",
  "https://www.bershka.com/tr/kadin/yeni-n3283.html",
  "https://www.stradivarius.com/tr/midi-elbise-l08123456.html?colorId=001",
  "https://www.pullandbear.com/tr/keten-jogger-pantolon-l03671509?cS=717&pelement=744752801",
  "https://www.lefties.com/tr/en/woman/clothing/jeans/lightweight-striped-culotte-jeans-c1030267526p747880059.html?colorId=104&parentId=747884869",
  "https://www.sneaksup.com/new-balance-9060-lifestyle-womens-shoes-u9060blk-w-1",
  "https://tr.tommy.com/erkek-hirka_206739",
  "https://www.victoriassecret.com.tr/victoria-s-secret-saten-dantel-detayli-askili-bluz-VS27291321",
  "https://www.boyner.com.tr/nike-if1448-010-short-kp-b-siyah-erkek-sort-p-15917358",
  "https://wunder.com.tr/classic-england-polo-white-ubmw0502fa328-wth0001",
  "https://www.superstep.com.tr/urun/adidas-handball-spezial-kadin-bej-spor-ayakkabi/ki6678/",
  "https://shop.mango.com/tr/tr/p/kadin/etek/anvelop-kesim-sort-etek/27094095/99/00",
  "https://www.sephora.com.tr/p/yum-boujee-marshmallow--81---eau-de-parfum-intense-733611.html",
  "https://www.gratis.com/maybelline-new-york-fit-me-fondoten-128-p-10001234",
  "https://www.watsons.com.tr/dermaskill-cilt-bakim-seti/p/1234567",
  "https://example.com/unknown",
];

const out: Record<string, unknown> = {};
for (const u of URLS) {
  const s = getScraperForUrl(u);
  out[u] = s ? { brand: s.brand, parsed: s.parseUrl(u) } : null;
}
console.log(JSON.stringify(out, null, 2));
