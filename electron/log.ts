import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { app } from "electron";

/**
 * Persistent file log: the packaged app is a dockless menu-bar app, so
 * console output goes nowhere a user can see. Tees console.log/warn/error
 * into userData/logs/app.log (rotated once at ~1 MB) — scheduler failures and
 * updater steps stay diagnosable after the fact.
 */

let logPath: string | null = null;
const MAX_BYTES = 1024 * 1024;

function fmt(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Error) return v.stack ?? v.message;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function write(level: string, args: unknown[]): void {
  if (!logPath) return;
  try {
    appendFileSync(
      logPath,
      `${new Date().toISOString()} [${level}] ${args.map(fmt).join(" ")}\n`,
    );
  } catch {
    // Logging must never break the app.
  }
}

export function initFileLog(): void {
  try {
    const dir = join(app.getPath("userData"), "logs");
    mkdirSync(dir, { recursive: true });
    logPath = join(dir, "app.log");
    if (existsSync(logPath) && statSync(logPath).size > MAX_BYTES) {
      renameSync(logPath, join(dir, "app.log.1"));
    }
    for (const level of ["log", "warn", "error"] as const) {
      const orig = console[level].bind(console);
      console[level] = (...args: unknown[]) => {
        orig(...args);
        write(level, args);
      };
    }
    write("log", [`--- Atelier ${app.getVersion()} started ---`]);
  } catch {
    logPath = null;
  }
}
