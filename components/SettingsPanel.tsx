"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { getApi } from "@/lib/client-api";
import { cn } from "@/lib/cn";
import type { AppSettings, UpdateState } from "@/types/global";

const INTERVALS: { label: string; cron: string }[] = [
  { label: "5 dk", cron: "*/5 * * * *" },
  { label: "15 dk", cron: "*/15 * * * *" },
  { label: "30 dk", cron: "*/30 * * * *" },
  { label: "Saatlik", cron: "0 * * * *" },
];

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<AppSettings | null>(null);
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState<UpdateState | null>(null);

  useEffect(() => {
    getApi().getSettings().then(setS);
    getApi().getAppVersion().then(setVersion);
    // Açılıştaki sessiz denetimin sonucu da dahil mevcut durumu al,
    // sonra canlı durum değişikliklerine abone ol.
    getApi().getUpdateState().then(setUpdate);
    return getApi().onUpdateState(setUpdate);
  }, []);

  async function patch(p: Partial<Omit<AppSettings, "id">>) {
    const next = await getApi().setSettings(p);
    setS(next);
  }

  if (!s) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/20 pt-24">
      <div className="w-full max-w-md border border-hairline bg-paper-raised p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-ink">Ayarlar</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-ink"
            aria-label="Kapat"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <Section label="Kontrol sıklığı">
          <div className="flex gap-1.5">
            {INTERVALS.map((it) => (
              <button
                key={it.cron}
                type="button"
                onClick={() => patch({ checkIntervalCron: it.cron })}
                className={cn(
                  "border px-3 py-1.5 text-xs transition-colors",
                  s.checkIntervalCron === it.cron
                    ? "border-ink bg-ink text-paper-raised"
                    : "border-hairline text-ink-soft hover:border-ink",
                )}
              >
                {it.label}
              </button>
            ))}
          </div>
        </Section>

        <Section label="Bildirimler">
          <Switch
            label="Stok gelince bildir"
            checked={s.notifyStock}
            onChange={(v) => patch({ notifyStock: v })}
          />
          <Switch
            label="Fiyat düşünce bildir"
            checked={s.notifyPrice}
            onChange={(v) => patch({ notifyPrice: v })}
          />
          <button
            type="button"
            onClick={() => getApi().testNotification()}
            className="mt-1 self-start border border-hairline px-3 py-1.5 text-xs text-ink-soft transition-colors hover:border-ink"
          >
            Test bildirimi gönder
          </button>
        </Section>

        <Section label="Sistem">
          <Switch
            label="Girişte otomatik başlat"
            checked={s.autolaunch}
            onChange={(v) => patch({ autolaunch: v })}
          />
        </Section>

        <Section label="Güncelleme">
          <Switch
            label="Güncellemeleri otomatik denetle (24 saatte bir)"
            checked={s.autoUpdateCheck}
            onChange={(v) => patch({ autoUpdateCheck: v })}
          />
          <UpdateRow version={version} update={update} />
        </Section>
      </div>
    </div>
  );
}

function UpdateRow({
  version,
  update,
}: {
  version: string;
  update: UpdateState | null;
}) {
  const status = update?.status ?? "idle";
  const busy =
    status === "checking" || status === "downloading" || status === "installing";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm text-ink">
        <span>Atelier v{version}</span>
        {status === "up-to-date" && (
          <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted">
            Güncel
          </span>
        )}
        {status === "available" && (
          <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-price-drop">
            v{update?.latestVersion} mevcut
          </span>
        )}
      </div>

      {status === "error" && (
        <p className="text-xs text-signal">{update?.error}</p>
      )}
      {status === "installing" && (
        <p className="text-xs text-ink-soft">
          Kuruluyor — uygulama birazdan yeniden başlayacak…
        </p>
      )}
      {status === "downloaded" && (
        <p className="text-xs text-ink-soft">
          Otomatik kurulamadı — DMG açıldı, Atelier&apos;i Applications
          klasörüne sürükleyin.
        </p>
      )}

      <div className="flex items-center gap-2">
        {status === "available" ||
        status === "downloading" ||
        status === "installing" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => getApi().downloadUpdate()}
            className="flex items-center gap-2 self-start border border-hairline px-3 py-1.5 text-xs text-ink-soft transition-colors hover:border-ink disabled:opacity-50"
          >
            {(status === "downloading" || status === "installing") && (
              <Loader2 className="h-3 w-3 animate-spin" />
            )}
            {status === "installing"
              ? "Kuruluyor…"
              : status === "downloading"
                ? `%${update?.percent ?? 0} indiriliyor…`
                : `v${update?.latestVersion} indir ve kur`}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => getApi().checkForUpdate()}
            className="flex items-center gap-2 self-start border border-hairline px-3 py-1.5 text-xs text-ink-soft transition-colors hover:border-ink disabled:opacity-50"
          >
            {status === "checking" && (
              <Loader2 className="h-3 w-3 animate-spin" />
            )}
            {status === "checking"
              ? "Denetleniyor…"
              : "Güncellemeleri denetle"}
          </button>
        )}
      </div>
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-6">
      <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
        {label}
      </p>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className="flex items-center justify-between text-sm text-ink"
    >
      <span>{label}</span>
      <span
        className={cn(
          "relative h-5 w-9 rounded-full transition-colors",
          checked ? "bg-signal" : "bg-hairline",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}
