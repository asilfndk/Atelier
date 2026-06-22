// Statik export'u Electron'da yükleyip ekran görüntüsü alır (tasarım önizleme).
const { app, BrowserWindow } = require("electron");
const path = require("node:path");

const page = process.argv[2] || "index";
const outName = process.argv[3] || "atelier-ui";

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    show: false,
    webPreferences: { offscreen: true },
  });
  const file = path.join(__dirname, "..", "out", `${page}.html`);
  await win.loadFile(file);
  await new Promise((r) => setTimeout(r, 1800));
  const img = await win.webContents.capturePage();
  const fs = require("node:fs");
  fs.writeFileSync(`/tmp/${outName}.png`, img.toPNG());
  console.log(`OK /tmp/${outName}.png`);
  app.quit();
});
