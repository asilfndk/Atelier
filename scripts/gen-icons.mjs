// Atelier ikon üreteci (offline): SVG → PNG/ICNS.
// Bağımlılık: sharp (mevcut) + macOS iconutil. Ağ veya yeni paket gerektirmez.
// Çalıştır: npm run gen:icons
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const res = join(root, "resources");
const iconSvg = join(res, "icon.svg");
const traySvg = join(res, "trayTemplate.svg");

async function svgToPng(svgPath, size, outPath) {
  await sharp(svgPath, { density: 384 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outPath);
}

// 1) Dev dock + Linux/Windows için tek kare PNG
await svgToPng(iconSvg, 1024, join(res, "icon.png"));

// 2) macOS .icns — .iconset üret, iconutil ile paketle
const iconset = join(res, "icon.iconset");
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });
const specs = [
  [16, "icon_16x16.png"],
  [32, "icon_16x16@2x.png"],
  [32, "icon_32x32.png"],
  [64, "icon_32x32@2x.png"],
  [128, "icon_128x128.png"],
  [256, "icon_128x128@2x.png"],
  [256, "icon_256x256.png"],
  [512, "icon_256x256@2x.png"],
  [512, "icon_512x512.png"],
  [1024, "icon_512x512@2x.png"],
];
for (const [size, name] of specs) {
  await svgToPng(iconSvg, size, join(iconset, name));
}
execFileSync("iconutil", ["-c", "icns", "-o", join(res, "icon.icns"), iconset]);
rmSync(iconset, { recursive: true, force: true });

// 3) Tray template (monokrom, siyah+alfa) — 16px @1x ve 32px @2x
await svgToPng(traySvg, 16, join(res, "trayTemplate.png"));
await svgToPng(traySvg, 32, join(res, "trayTemplate@2x.png"));

// 4) Renderer favicon (16/32/48 çok boyutlu .ico)
const icoSizes = [16, 32, 48];
const icoBuffers = await Promise.all(
  icoSizes.map((s) =>
    sharp(iconSvg, { density: 384 })
      .resize(s, s, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer(),
  ),
);
writeFileSync(join(root, "app", "favicon.ico"), buildIco(icoBuffers, icoSizes));

console.log("İkonlar üretildi: icon.icns, icon.png, trayTemplate.png(@2x), app/favicon.ico");

// PNG'leri ICO konteynerine paketle (basit, bağımlılıksız).
function buildIco(pngBuffers, sizes) {
  const count = pngBuffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // tip: ikon
  header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  pngBuffers.forEach((buf, i) => {
    const s = sizes[i];
    const d = dir.subarray(i * 16);
    d.writeUInt8(s >= 256 ? 0 : s, 0); // genişlik
    d.writeUInt8(s >= 256 ? 0 : s, 1); // yükseklik
    d.writeUInt8(0, 2); // palet
    d.writeUInt8(0, 3); // ayrılmış
    d.writeUInt16LE(1, 4); // renk düzlemi
    d.writeUInt16LE(32, 6); // bit/piksel
    d.writeUInt32LE(buf.length, 8);
    d.writeUInt32LE(offset, 12);
    offset += buf.length;
  });
  return Buffer.concat([header, dir, ...pngBuffers]);
}
