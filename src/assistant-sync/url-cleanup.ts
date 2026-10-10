/**
 * URL cleanup for the sheet: tracking parameters removed, AMP pages collapsed to the article,
 * and redirect wrappers unwrapped to their destination. The local library keeps exact URLs,
 * because highlights and reading time look a page up by the tab's address.
 */

/** Tracking keys on any site. Matched case-insensitively. */
const TRACKING_KEYS = new Set([
  "fbclid", "gclid", "gclsrc", "dclid", "gbraid", "wbraid", "msclkid", "yclid", "twclid", "ttclid",
  "li_fat_id", "mc_cid", "mc_eid", "igshid", "igsh", "_hsenc", "_hsmi", "__hssc", "__hstc", "__hsfp",
  "hsctatracking", "mkt_tok", "oly_anon_id", "oly_enc_id", "vero_id", "vero_conv", "wickedid", "s_cid",
  "ref_src", "ref_url", "cmpid", "_ga", "_gl", "ncid", "amp", "_amp", "usqp", "outputtype",
]);
/** YouTube share and player-context keys. `v` and `t` stay. */
const YOUTUBE_TRACKING = new Set(["si", "feature", "pp", "ab_channel"]);

/** Hosts whose only job is to redirect. A visit to one is not a page view. */
const SHORTENER_HOSTS = new Set([
  "t.co", "lnkd.in", "bit.ly", "goo.gl", "ow.ly", "buff.ly", "tinyurl.com", "dlvr.it", "fb.me", "trib.al", "shorturl.at",
]);

function host(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

function parseHttp(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function isGoogle(h: string): boolean {
  return h === "google.com" || /^google\.[a-z.]+$/.test(h);
}

/** The destination of a redirect wrapper that carries it in a parameter. */
function unwrapRedirect(url: URL): URL | null {
  const h = host(url);
  const p = url.pathname;
  const param = (key: string) => parseHttp(url.searchParams.get(key));
  if (isGoogle(h) && p === "/url") return param("q") ?? param("url");
  if ((h === "l.facebook.com" || h === "lm.facebook.com") && p === "/l.php") return param("u");
  if (h === "l.instagram.com") return param("u");
  if ((h === "youtube.com" || h === "m.youtube.com") && p === "/redirect") return param("q");
  if (h === "out.reddit.com") return param("url");
  if ((h === "linkedin.com" || h.endsWith(".linkedin.com")) && p.startsWith("/safety/go")) return param("url");
  if (h === "slack-redir.net" && p === "/link") return param("url");
  return null;
}

/** The article behind a Google AMP viewer, the AMP cache, or an /amp path. */
function collapseAmp(url: URL): URL {
  const h = host(url);
  const viewer = isGoogle(h) && /^\/amp\/(s\/)?/.exec(url.pathname);
  if (viewer) {
    const target = parseHttp(`${viewer[1] ? "https" : "http"}://${url.pathname.slice(viewer[0].length)}${url.search}`);
    if (target) return collapseAmp(target);
  }
  const cache = h.endsWith(".cdn.ampproject.org") && /^\/[cv]\/(s\/)?/.exec(url.pathname);
  if (cache) {
    const target = parseHttp(`${cache[1] ? "https" : "http"}://${url.pathname.slice(cache[0].length)}${url.search}`);
    if (target) return collapseAmp(target);
  }
  if (h !== "amp.dev") url.pathname = articlePathWithoutAmp(url.pathname);
  return url;
}

/** Article-like: a hyphenated slug or a number, so /products/amp (a guitar amp) is left alone. */
const ARTICLE_SEGMENT = /-|\d/;

function articlePathWithoutAmp(path: string): string {
  if (/\.amp\.html?$/i.test(path)) return path.replace(/\.amp(\.html?)$/i, "$1");
  const segments = path.split("/").filter(Boolean);
  if (segments.length < 2) return path;
  const last = segments.length - 1;
  if (segments[last]!.toLowerCase() === "amp" && ARTICLE_SEGMENT.test(segments[last - 1]!)) {
    return `/${segments.slice(0, last).join("/")}`;
  }
  if (segments[0]!.toLowerCase() === "amp" && segments.slice(1).some((s) => ARTICLE_SEGMENT.test(s))) {
    return `/${segments.slice(1).join("/")}`;
  }
  return path;
}

/** A shortener or a redirect wrapper. The page it leads to is the visit, so this one is skipped. */
export function isRedirectUrl(raw: string): boolean {
  const url = parseHttp(raw);
  return url != null && (SHORTENER_HOSTS.has(host(url)) || unwrapRedirect(url) != null);
}

/** Cleaned http(s) URL, or null when the input is not http(s). */
export function cleanUrl(raw: string): URL | null {
  let url = parseHttp(raw);
  for (let hops = 0; url && hops < 3; hops++) {
    const next = unwrapRedirect(url);
    if (!next) break;
    url = next;
  }
  if (!url) return null;
  if (host(url) === "youtu.be" && url.pathname.length > 1) {
    const id = url.pathname.slice(1).split("/")[0]!;
    const t = url.searchParams.get("t");
    url = new URL(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}${t ? `&t=${encodeURIComponent(t)}` : ""}`);
  }
  url = collapseAmp(url);
  const youtube = /(^|\.)youtube\.com$/.test(url.hostname.toLowerCase());
  for (const key of [...url.searchParams.keys()]) {
    const name = key.toLowerCase();
    if (name.startsWith("utm_") || TRACKING_KEYS.has(name) || (youtube && YOUTUBE_TRACKING.has(name))) url.searchParams.delete(key);
  }
  return url;
}
