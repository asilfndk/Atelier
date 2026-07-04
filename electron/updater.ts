import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { app, shell } from "electron";
import { getMainWindow } from "./app-state";

/**
 * GitHub Releases tabanlı güncelleme denetimi.
 * Uygulama imzasız (ad-hoc) olduğundan electron-updater'ın sessiz kurulumu
 * macOS'ta güvenilir çalışmaz; bunun yerine doğru mimarinin .dmg'si indirilir
 * ve Finder'da açılır — kullanıcı Applications'a sürükler.
 */

const REPO = "asilfndk/inditex-tracker";
const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
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

  const asset =
    release.assets.find(
      (a) => a.name.endsWith(".dmg") && a.name.includes(process.arch),
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

    await shell.openPath(dmgPath);
    setState({ status: "downloaded", percent: 100 });
  } catch (err) {
    setState({
      status: "error",
      error: err instanceof Error ? err.message : "İndirme başarısız.",
    });
  }
  return getUpdateState();
}

/** Açılışta sessiz denetim: yalnızca güncelleme varsa renderer'a haber verir. */
export function checkOnStartup(): void {
  checkForUpdate().catch((err) => {
    console.warn("[updater] açılış denetimi başarısız:", err);
  });
}
