import esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const liveTest = process.argv.includes("--live-test");

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  tsconfig: "tsconfig.json",
  // Native and Electron-owned modules are not bundled.
  external: ["electron", "better-sqlite3"],
  logLevel: "info",
};

const entries = [
  { in: "electron/main.ts", out: "dist-electron/main.js" },
  { in: "electron/preload.ts", out: "dist-electron/preload.js" },
];
// The live-test harness is dev-only — bundled on demand (npm run live-test),
// not as part of the packaged build.
if (liveTest) {
  entries.length = 0;
  entries.push({
    in: "electron/live-test.ts",
    out: "dist-electron/live-test.js",
  });
}

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

if (!watch) console.log("electron build done → dist-electron/");
