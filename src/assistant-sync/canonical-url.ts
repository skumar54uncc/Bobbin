import { cleanUrl } from "./url-cleanup";

/** Query keys kept on a synced URL. Everything else, and the fragment, is dropped. */
export const CANONICAL_QUERY_ALLOWLIST = ["q", "query", "search_query", "v"] as const;

const ALLOWED = new Set<string>(CANONICAL_QUERY_ALLOWLIST);

/** Amazon's search box puts the query in `k`. Kept only on Amazon, where it is the search. */
function allowedKey(name: string, hostname: string): boolean {
  return ALLOWED.has(name) || (name === "k" && /(^|\.)amazon\.[a-z.]+$/.test(hostname));
}

/**
 * Stable http(s) URL for the sheet: redirect wrappers unwrapped, AMP collapsed, then only the
 * allowlisted query keys kept. Returns null when the input is not http(s).
 */
export function canonicalizeUrl(raw: string): string | null {
  const url = cleanUrl(raw);
  if (!url) return null;

  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  const kept: [string, string][] = [];
  for (const [key, value] of url.searchParams) {
    const name = key.toLowerCase();
    if (allowedKey(name, url.hostname)) kept.push([name, value]);
  }
  kept.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  url.search = "";
  for (const [key, value] of kept) url.searchParams.append(key, value);
  return url.toString();
}

export function domainFromUrl(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Same page: a hash, a tracking key, or a trailing slash is not a different visit. */
export function samePage(a: string, b: string): boolean {
  return (canonicalizeUrl(a) ?? a.split("#")[0]) === (canonicalizeUrl(b) ?? b.split("#")[0]);
}
