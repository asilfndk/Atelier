import esbuild from "esbuild";

const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  tsconfig: "tsconfig.json",
  // Native ve Electron'a ait modüller paketlenmez.
  external: ["electron", "better-sqlite3"],
  logLevel: "info",
};

const entries = [
  { in: "electron/main.ts", out: "dist-electron/main.js" },
  { in: "electron/preload.ts", out: "dist-electron/preload.js" },
];

for (const e of entries) {
  const opts = { ...common, entryPoints: [e.in], outfile: e.out };
  if (watch) {
    const ctx = await esbuild.context(opts);
    await ctx.watch();
    console.log(`watching ${e.in}`);
  } else {
    await esbuild.build(opts);
  }
}

if (!watch) console.log("electron build tamam → dist-electron/");
