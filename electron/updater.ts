import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { app, shell } from "electron";
import { getSettings } from "@/lib/repo";
import { getMainWindow } from "./app-state";
import { notifyUpdateAvailable } from "./notifications";

/**
 * GitHub Releases based update check and in-place install.
 * The app is unsigned (ad-hoc), so electron-updater does not work on macOS
 * (signature verification is mandatory); instead the .dmg for the right
 * architecture is downloaded, mounted, the new .app is copied over the
 * running bundle and the app restarts. If the install fails we fall back
 * to the old behavior: the DMG opens in Finder and the user drags it to
 * Applications.
 */

const REPO = "asilfndk/inditex-tracker";
const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "downloaded"
  | "error"
  | "up-to-date";

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  latestVersion?: string;
  percent?: number;
  error?: string;
}

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface Release {
  tag_name: string;
  html_url: string;
  assets: ReleaseAsset[];
}

let state: UpdateState = { status: "idle", currentVersion: "" };
let latestRelease: Release | null = null;

function setState(next: Partial<UpdateState>): void {
  state = { ...state, currentVersion: app.getVersion(), ...next };
  getMainWindow()?.webContents.send("update-state", state);
}

export function getUpdateState(): UpdateState {
  return { ...state, currentVersion: app.getVersion() };
}

/** "v0.3.7" → [0,3,7]; numeric segment comparison (no semver dependency). */
function isNewer(tag: string, current: string): boolean {
  const parse = (v: string) =>
    v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const a = parse(tag);
  const b = parse(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

/** Check the latest release; state becomes "available" if newer. */
export async function checkForUpdate(): Promise<UpdateState> {
  if (state.status === "checking" || state.status === "downloading") {
    return getUpdateState();
  }
  setState({ status: "checking", error: undefined, percent: undefined });
  try {
    const res = await fetch(API_LATEST, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "atelier-app",
      },
    });
    if (res.status === 403 || res.status === 429) {
      throw new Error("GitHub rate limit reached — try again in a few minutes.");
    }
    if (!res.ok) throw new Error(`GitHub response: ${res.status}`);
    const release = (await res.json()) as Release;
    if (isNewer(release.tag_name, app.getVersion())) {
      latestRelease = release;
      setState({
        status: "available",
        latestVersion: release.tag_name.replace(/^v/, ""),
      });
    } else {
      latestRelease = null;
      setState({
        status: "up-to-date",
        latestVersion: release.tag_name.replace(/^v/, ""),
      });
    }
  } catch (err) {
    setState({
      status: "error",
      error: err instanceof Error ? err.message : "Update check failed.",
    });
  }
  return getUpdateState();
}

/** Download the .dmg for the current architecture and install it. */
export async function downloadUpdate(): Promise<UpdateState> {
  if (state.status === "downloading") return getUpdateState();
  const release = latestRelease;
  if (!release) {
    setState({ status: "error", error: "Check for updates first." });
    return getUpdateState();
  }

  // An x64 install running under Rosetta on Apple Silicon is migrated to native arm64.
  const targetArch = app.runningUnderARM64Translation ? "arm64" : process.arch;
  const asset =
    release.assets.find(
      (a) => a.name.endsWith(".dmg") && a.name.includes(targetArch),
    ) ?? release.assets.find((a) => a.name.endsWith(".dmg"));
  if (!asset) {
    // No suitable package — send the user to the release page.
    await shell.openExternal(release.html_url);
    setState({ status: "available" });
    return getUpdateState();
  }

  setState({ status: "downloading", percent: 0 });
  try {
    const res = await fetch(asset.browser_download_url, {
      headers: { "User-Agent": "atelier-app" },
    });
    if (!res.ok || !res.body) throw new Error(`Download response: ${res.status}`);

    const total = Number(res.headers.get("content-length")) || asset.size || 0;
    const dmgPath = join(app.getPath("temp"), asset.name);

    let received = 0;
    let lastEmit = 0;
    const progress = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        const now = Date.now();
        if (total > 0 && now - lastEmit > 250) {
          lastEmit = now;
          setState({
            status: "downloading",
            percent: Math.round((received / total) * 100),
          });
        }
        controller.enqueue(chunk);
      },
    });

    await pipeline(
      Readable.fromWeb(res.body.pipeThrough(progress) as never),
      createWriteStream(dmgPath),
    );

    // Download complete — install over itself and restart.
    setState({ status: "installing", percent: 100 });
    await installUpdate(dmgPath);
    // installUpdate calls app.quit(); normally we never return here.
  } catch (err) {
    setState({
      status: "error",
      error: err instanceof Error ? err.message : "The download couldn't be completed.",
    });
  }
  return getUpdateState();
}

// ---- In-place install ----

const execFileAsync = promisify(execFile);

/** Extract the mount point from `hdiutil attach` output (the /Volumes/... column on the last line). */
function parseMountPoint(stdout: string): string | null {
  for (const line of stdout.split("\n").reverse()) {
    const m = line.match(/(\/Volumes\/[^\t\n]+?)\s*$/);
    if (m) return m[1].trim();
  }
  return null;
}

/** Path of the running bundle: .../Atelier.app (null when not packaged). */
function currentBundlePath(): string | null {
  const m = process.execPath.match(/^(.*?\.app)\/Contents\/MacOS\//);
  return m ? m[1] : null;
}

/**
 * Mount the DMG, copy its .app to staging, start a detached script that
 * swaps it over the running bundle, and quit the app. The swap happens
 * after the app has exited; the new version then launches. User data
 * (userData/app.db) lives outside the bundle so it is preserved.
 */
async function installUpdate(dmgPath: string): Promise<void> {
  const target = app.isPackaged ? currentBundlePath() : null;
  if (!target) {
    // Dev environment or unexpected layout: old behavior (open in Finder).
    await shell.openPath(dmgPath);
    setState({ status: "downloaded", percent: 100 });
    return;
  }

  let mountPoint: string | null = null;
  try {
    const { stdout } = await execFileAsync("hdiutil", [
      "attach",
      "-nobrowse",
      "-noautoopen",
      dmgPath,
    ]);
    mountPoint = parseMountPoint(stdout);
    if (!mountPoint) throw new Error("DMG mount point not found.");

    const appName = (await readdir(mountPoint)).find((f) => f.endsWith(".app"));
    if (!appName) throw new Error("No .app found inside the DMG.");

    const staging = join(app.getPath("temp"), "Atelier-update.app");
    await rm(staging, { recursive: true, force: true });
    await execFileAsync("ditto", [join(mountPoint, appName), staging]);
    await execFileAsync("xattr", ["-dr", "com.apple.quarantine", staging]).catch(
      () => {},
    );

    // Once the app exits, swap the old bundle with the new one and relaunch.
    const script = `
      while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done
      rm -rf "${target}"
      mv "${staging}" "${target}"
      open "${target}"
    `;
    spawn("/bin/bash", ["-c", script], {
      detached: true,
      stdio: "ignore",
    }).unref();

    app.quit();
  } catch (err) {
    // Automatic install failed — open the DMG in Finder and fall back to manual install.
    console.warn("[updater] in-place install failed:", err);
    await shell.openPath(dmgPath);
    setState({ status: "downloaded", percent: 100 });
  } finally {
    if (mountPoint) {
      execFileAsync("hdiutil", ["detach", mountPoint, "-quiet"]).catch(() => {});
    }
  }
}

// ---- Automatic checks (on startup + every 24h) ----

const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
let autoCheckTimer: NodeJS.Timeout | null = null;
/** Notify only once per version. */
let notifiedVersion: string | null = null;

async function autoCheck(): Promise<void> {
  const result = await checkForUpdate();
  if (
    result.status === "available" &&
    result.latestVersion &&
    result.latestVersion !== notifiedVersion
  ) {
    notifiedVersion = result.latestVersion;
    notifyUpdateAvailable(result.latestVersion);
  }
}

/** Start the 24h periodic check (no-op when the setting is off). */
export function startAutoUpdateChecks(): void {
  if (!getSettings().autoUpdateCheck) return;
  if (autoCheckTimer) return;
  autoCheckTimer = setInterval(() => {
    autoCheck().catch((err) => {
      console.warn("[updater] periodic check failed:", err);
    });
  }, AUTO_CHECK_INTERVAL_MS);
}

export function stopAutoUpdateChecks(): void {
  if (autoCheckTimer) {
    clearInterval(autoCheckTimer);
    autoCheckTimer = null;
  }
}

/** Silent check on startup: notification if an update exists + state broadcast to the renderer. */
export function checkOnStartup(): void {
  if (!getSettings().autoUpdateCheck) return;
  autoCheck().catch((err) => {
    console.warn("[updater] startup check failed:", err);
  });
}
