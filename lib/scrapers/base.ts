/** Shared HTTP headers that make requests look like a browser */
export const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
};

/**
 * Resolve the image URL to an absolute https URL. Protocol-relative ("//host/x")
 * and root-relative ("/x") values are resolved against the product URL; in the
 * packaged app the renderer loads from a file:// origin, so raw values fail to load.
 */
export function resolveImageUrl(
  imageUrl: string | null,
  baseUrl: string,
): string | null {
  if (!imageUrl) return null;
  try {
    const u = new URL(imageUrl, baseUrl);
    return u.protocol === "http:" || u.protocol === "https:"
      ? u.toString()
      : null;
  } catch {
    return null;
  }
}

/** fetch + timeout helper (for internal API calls); throws on a non-2xx status */
export async function fetchText(
  url: string,
  timeoutMs = 8000,
  headers: Record<string, string> = {},
): Promise<string> {
  const res = await fetch(url, {
    headers: { ...BROWSER_HEADERS, ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export const fetchJson = async (
  ...args: Parameters<typeof fetchText>
): Promise<unknown> => JSON.parse(await fetchText(...args)) as unknown;

/** The parsed `__NEXT_DATA__` script of a Next.js page (null when absent) */
export function nextData(html: string) {
  const json = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  )?.[1];
  return json ? JSON.parse(json) : null;
}

/** A `<meta property|itemprop|name="key" content="…">` value (null when absent) */
export function meta(html: string, key: string): string | null {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    html.match(
      new RegExp(
        `<meta[^>]*(?:property|itemprop|name)="${k}"[^>]*content="([^"]*)"`,
      ),
    )?.[1] ?? null
  );
}

/** tr-TR price: "6.159,00" = 6159 (dot = thousands, comma = decimal); port of page-script's parseTRNumber */
export function parseTrPrice(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v ?? "").replace(/[^\d.,]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, "");
  else if (/^\d{1,3}\.\d{3}$/.test(s)) s = s.replace(".", "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}
