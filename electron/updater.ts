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
 * GitHub Releases tabanlı güncelleme denetimi ve in-place kurulum.
 * Uygulama imzasız (ad-hoc) olduğundan electron-updater macOS'ta çalışmaz
 * (imza doğrulaması zorunlu); bunun yerine doğru mimarinin .dmg'si indirilir,
 * mount edilip yeni .app mevcut bundle'ın üzerine kopyalanır ve uygulama
 * yeniden başlatılır. Kurulum başarısız olursa eski davranışa düşülür:
 * DMG Finder'da açılır, kullanıcı Applications'a sürükler.
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

/** "v0.3.7" → [0,3,7]; sayısal parça karşılaştırması (semver bağımlılığı yok). */
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

/** Son sürümü denetle; varsa state "available" olur. */
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
      throw new Error("GitHub istek sınırına takıldı, biraz sonra tekrar dene.");
    }
    if (!res.ok) throw new Error(`GitHub yanıtı: ${res.status}`);
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
      error: err instanceof Error ? err.message : "Denetim başarısız.",
    });
  }
  return getUpdateState();
}

/** Mevcut sürüme uygun mimarinin .dmg'sini indirip Finder'da aç. */
export async function downloadUpdate(): Promise<UpdateState> {
  if (state.status === "downloading") return getUpdateState();
  const release = latestRelease;
  if (!release) {
    setState({ status: "error", error: "Önce güncelleme denetimi yap." });
    return getUpdateState();
  }

  // Apple Silicon'da Rosetta altında çalışan x64 kurulum doğal arm64'e geçirilir.
  const targetArch = app.runningUnderARM64Translation ? "arm64" : process.arch;
  const asset =
    release.assets.find(
      (a) => a.name.endsWith(".dmg") && a.name.includes(targetArch),
    ) ?? release.assets.find((a) => a.name.endsWith(".dmg"));
  if (!asset) {
    // Uygun paket yoksa release sayfasına yönlendir.
    await shell.openExternal(release.html_url);
    setState({ status: "available" });
    return getUpdateState();
  }

  setState({ status: "downloading", percent: 0 });
  try {
    const res = await fetch(asset.browser_download_url, {
      headers: { "User-Agent": "atelier-app" },
    });
    if (!res.ok || !res.body) throw new Error(`İndirme yanıtı: ${res.status}`);

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

    // İndirme tamam — kendi üzerine kur ve yeniden başlat.
    setState({ status: "installing", percent: 100 });
    await installUpdate(dmgPath);
    // installUpdate app.quit() çağırır; buraya normalde dönülmez.
  } catch (err) {
    setState({
      status: "error",
      error: err instanceof Error ? err.message : "İndirme başarısız.",
    });
  }
  return getUpdateState();
}

// ---- In-place kurulum ----

const execFileAsync = promisify(execFile);

/** `hdiutil attach` çıktısından mount noktasını çıkar (son satırdaki /Volumes/... sütunu). */
function parseMountPoint(stdout: string): string | null {
  for (const line of stdout.split("\n").reverse()) {
    const m = line.match(/(\/Volumes\/[^\t\n]+?)\s*$/);
    if (m) return m[1].trim();
  }
  return null;
}

/** Çalışan bundle yolu: .../Atelier.app (paketli değilse null). */
function currentBundlePath(): string | null {
  const m = process.execPath.match(/^(.*?\.app)\/Contents\/MacOS\//);
  return m ? m[1] : null;
}

/**
 * DMG'yi mount et, içindeki .app'i staging'e kopyala, çalışan bundle'ın
 * üzerine takas edecek betiği ayrık süreç olarak başlat ve uygulamadan çık.
 * Takas, uygulama kapandıktan sonra gerçekleşir; ardından yeni sürüm açılır.
 * Kullanıcı verisi (userData/app.db) bundle dışında olduğundan korunur.
 */
async function installUpdate(dmgPath: string): Promise<void> {
  const target = app.isPackaged ? currentBundlePath() : null;
  if (!target) {
    // Dev ortamı veya beklenmedik yerleşim: eski davranış (Finder'da aç).
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
    if (!mountPoint) throw new Error("DMG mount noktası bulunamadı.");

    const appName = (await readdir(mountPoint)).find((f) => f.endsWith(".app"));
    if (!appName) throw new Error("DMG içinde .app bulunamadı.");

    const staging = join(app.getPath("temp"), "Atelier-update.app");
    await rm(staging, { recursive: true, force: true });
    await execFileAsync("ditto", [join(mountPoint, appName), staging]);
    await execFileAsync("xattr", ["-dr", "com.apple.quarantine", staging]).catch(
      () => {},
    );

    // Uygulama kapanınca eski bundle'ı yenisiyle takas edip yeniden başlat.
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
    // Otomatik kurulum başarısız — DMG'yi Finder'da açıp elle kuruluma düş.
    console.warn("[updater] in-place kurulum başarısız:", err);
    await shell.openPath(dmgPath);
    setState({ status: "downloaded", percent: 100 });
  } finally {
    if (mountPoint) {
      execFileAsync("hdiutil", ["detach", mountPoint, "-quiet"]).catch(() => {});
    }
  }
}

// ---- Otomatik denetim (açılışta + 24 saatte bir) ----

const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
let autoCheckTimer: NodeJS.Timeout | null = null;
/** Aynı sürüm için bildirim yalnızca bir kez gönderilir. */
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

/** 24 saatlik periyodik denetimi başlat (ayar kapalıysa hiçbir şey yapmaz). */
export function startAutoUpdateChecks(): void {
  if (!getSettings().autoUpdateCheck) return;
  if (autoCheckTimer) return;
  autoCheckTimer = setInterval(() => {
    autoCheck().catch((err) => {
      console.warn("[updater] periyodik denetim başarısız:", err);
    });
  }, AUTO_CHECK_INTERVAL_MS);
}

export function stopAutoUpdateChecks(): void {
  if (autoCheckTimer) {
    clearInterval(autoCheckTimer);
    autoCheckTimer = null;
  }
}

/** Açılışta sessiz denetim: güncelleme varsa bildirim + renderer'a durum yayını. */
export function checkOnStartup(): void {
  if (!getSettings().autoUpdateCheck) return;
  autoCheck().catch((err) => {
    console.warn("[updater] açılış denetimi başarısız:", err);
  });
}
