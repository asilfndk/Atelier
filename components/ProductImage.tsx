"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

/** Product photo with a graceful broken-image fallback (shared by the result
 * panel and the watchlist thumbnails). Give it a `key={imageUrl}` when the URL
 * can change so the failed state resets on remount. */
export function ProductImage({
  imageUrl,
  name,
  className,
  fallback = "No image",
}: {
  imageUrl: string | null;
  name: string | null;
  className?: string;
  fallback?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <div
      className={cn(
        "aspect-[3/4] overflow-hidden border border-hairline bg-paper",
        className,
      )}
    >
      {imageUrl && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={name ?? "Product image"}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full items-center justify-center font-mono text-xs uppercase tracking-widest text-muted">
          {fallback}
        </div>
      )}
    </div>
  );
}
