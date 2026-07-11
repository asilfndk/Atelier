"use client";

import { useState } from "react";
import { ArrowRight, Link2, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

interface Props {
  onCheck: (url: string) => void;
  loading?: boolean;
}

/**
 * Primary action: the paste-a-product-link command bar.
 */
export function CheckBar({ onCheck, loading }: Props) {
  const [url, setUrl] = useState("");
  const valid = /^https?:\/\/.+/i.test(url.trim());

  function submit() {
    if (valid && !loading) onCheck(url.trim());
  }

  return (
    <div
      className={cn(
        "no-drag group flex items-center gap-3 border bg-paper-raised px-4 py-3 transition-colors",
        "border-hairline focus-within:border-ink",
      )}
    >
      <Link2
        className="h-5 w-5 shrink-0 text-muted group-focus-within:text-ink"
        strokeWidth={1.75}
      />
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="Paste a product link…"
        spellCheck={false}
        autoFocus
        className="flex-1 bg-transparent font-mono text-sm text-ink outline-none placeholder:text-muted"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!valid || loading}
        className={cn(
          "flex h-9 items-center gap-2 px-4 text-sm font-medium transition-all",
          "bg-signal text-white hover:brightness-95",
          "disabled:cursor-not-allowed disabled:bg-hairline disabled:text-muted",
        )}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ArrowRight className="h-4 w-4" strokeWidth={2} />
        )}
        {loading ? "Checking…" : "Check"}
      </button>
    </div>
  );
}
