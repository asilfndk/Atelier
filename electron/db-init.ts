import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "@/db";

/**
 * Migration klasörünü hem dev'de hem paketlenmiş .app içinde bulur ve uygular.
 * Paketlenmiş uygulamada klasör `process.resourcesPath/db/migrations` altına
 * extraResource olarak kopyalanır (bkz. electron-builder.yml).
 */
export function runMigrations(): void {
  const candidates = [
    join(process.cwd(), "db", "migrations"),
    join(app.getAppPath(), "db", "migrations"),
    join(process.resourcesPath ?? "", "db", "migrations"),
  ];
  const folder = candidates.find((p) => existsSync(p));
  if (!folder) {
    console.error("Migration klasörü bulunamadı:", candidates);
    return;
  }
  migrate(db, { migrationsFolder: folder });
  console.log("Migration'lar uygulandı:", folder);
}
