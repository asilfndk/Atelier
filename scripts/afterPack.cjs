const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Re-sign the .app with a proper ad-hoc signature matching the bundle id, for
 * macOS notifications. When electron-builder skips signing with `identity: null`,
 * the main executable keeps Electron's factory signature (Identifier=Electron,
 * Info.plist=not bound); UNUserNotificationCenter then cannot bind the process to
 * the com.atelier.inditex-tracker bundle and notification registration silently
 * fails. When codesign signs a bundle it derives the identity from
 * CFBundleIdentifier and binds Info.plist into the signature → problem solved.
 * Requires no Apple Developer account (ad-hoc, `--sign -`).
 *
 * Signing strategy (inside-out, not `--deep`):
 * `--deep` is deprecated and fragile for Electron bundles — it applies the outer
 * flags to nested code and can seal helpers/frameworks in the wrong order,
 * especially for the x64 bundle cross-built on an arm64 host. Instead we sign
 * every nested Mach-O first (dylibs, .node native modules, standalone helper
 * executables), then frameworks, then helper apps, then the outer app, and
 * fail the build if the final `codesign --verify --deep --strict` rejects it.
 *
 * Stable designated requirement:
 * A plain ad-hoc signature gets an implicit DR pinned to the cdhash, which
 * changes on every release. macOS keys notification/TCC records on the DR, so
 * each update made the OS treat Atelier as a brand-new app and silently drop
 * its notification registration. Signing the outer app with an explicit
 * `designated => identifier "<bundle id>"` keeps the DR stable across updates
 * so the user's notification permission survives.
 *
 * Do NOT add `--options runtime` (hardened runtime): it enables library
 * validation, which rejects ad-hoc-signed libraries and breaks Electron's JIT
 * without an entitlements plist — and buys nothing for local notifications.
 */

const MACHO_MAGICS = new Set([
  0xfeedface,
  0xcefaedfe, // 32-bit
  0xfeedfacf,
  0xcffaedfe, // 64-bit
  0xcafebabe,
  0xbebafeca, // fat/universal
]);

function isMachO(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(4);
    if (fs.readSync(fd, buf, 0, 4, 0) !== 4) return false;
    return MACHO_MAGICS.has(buf.readUInt32BE(0));
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** Recursively collect loose Mach-O files (dylibs, .node, helper executables). */
function collectMachOFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) collectMachOFiles(p, out);
    else if (entry.isFile() && isMachO(p)) out.push(p);
  }
  return out;
}

function sign(target, extraArgs = []) {
  execFileSync("codesign", ["--force", "--sign", "-", ...extraArgs, target], {
    stdio: "inherit",
  });
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appName = context.packager.appInfo.productFilename; // "Atelier"
  const bundleId = context.packager.appInfo.id; // "com.atelier.inditex-tracker"
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  const frameworksDir = path.join(appPath, "Contents", "Frameworks");

  // 1. Loose Mach-O binaries, deepest first, so every container that seals
  //    them afterwards records their final hash.
  const machOFiles = collectMachOFiles(appPath).sort(
    (a, b) => b.split(path.sep).length - a.split(path.sep).length,
  );
  for (const file of machOFiles) sign(file);

  // 2. Frameworks (Electron Framework, Mantle, ReactiveObjC, Squirrel).
  // 3. Helper apps (Atelier Helper (GPU)/(Renderer)/(Plugin)/plain).
  const bundles = fs
    .readdirSync(frameworksDir)
    .filter((n) => n.endsWith(".framework"))
    .concat(fs.readdirSync(frameworksDir).filter((n) => n.endsWith(".app")))
    .map((n) => path.join(frameworksDir, n));
  for (const bundle of bundles) sign(bundle);

  // 4. Outer app last: binds Info.plist + bundle id, with a DR that is stable
  //    across releases (identifier-based, not cdhash-based).
  sign(appPath, [
    "--identifier",
    bundleId,
    "-r=" + `designated => identifier "${bundleId}"`,
  ]);

  // 5. Fail the build on an invalid signature instead of shipping a broken DMG.
  //    (`--deep` is deprecated for signing but still correct for verification.)
  execFileSync(
    "codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", appPath],
    { stdio: "inherit" },
  );
  console.log(`[afterPack] ad-hoc signed inside-out + verified: ${appPath}`);
};
