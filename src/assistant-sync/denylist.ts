import { isBlockedDomain, looksSensitiveHostname } from "../lib/privacy";
import { shouldAlwaysSkipUrl } from "../lib/sensitive-domains";
import { isChallengePage } from "./challenge";
import { isRedirectUrl } from "./url-cleanup";

export const PASSWORD_INPUT_SELECTOR = 'input[type="password"]';

export type SyncDenyReason = "password" | "sensitive" | "user" | "local" | "browser" | "cortex" | "redirect" | "challenge";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);

/** Hosts where Cortex's own Drive files open. */
const OWN_FILE_HOSTS = new Set(["docs.google.com", "drive.google.com"]);
/**
 * "Cortex Memory - Google Sheets", "Cortex Memory - Google Drive", the day docs
 * ("Cortex Pages 2026-10-08 Thursday - Google Docs"), and the files older builds made.
 */
const OWN_FILE_TITLE =
  /^Cortex (Memory( Archive \d{4}-\d{2}| Backup\.json| Seed)?|Pages \d{4}-\d{2}-\d{2} [A-Za-z]+)(\s+[-\u2013\u2014]\s+.*)?$/i;

export interface OwnFileIds {
  fileId?: string | null;
  folderId?: string | null;
  pagesFolderId?: string | null;
}

/** The Cortex Memory sheet, folders, or a Pages doc, by stored Drive id or by title on a Google Docs or Drive page. */
export function isCortexOwnFile(raw: string, title?: string | null, ids?: OwnFileIds | null): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (!OWN_FILE_HOSTS.has(host)) return false;
  const segments = url.pathname.split("/");
  for (const id of [ids?.fileId, ids?.folderId, ids?.pagesFolderId]) {
    if (id && (segments.includes(id) || url.searchParams.get("id") === id)) return true;
  }
  return title != null && OWN_FILE_TITLE.test(title.replace(/\s+/g, " ").trim());
}

function browserProtocol(protocol: string): boolean {
  return (
    protocol === "chrome:" ||
    protocol === "chrome-extension:" ||
    protocol === "edge:" ||
    protocol === "about:" ||
    protocol === "devtools:" ||
    protocol === "file:"
  );
}

/**
 * Hard skip for the sync path. Returns null when the page may be stored.
 * Does not change what Cortex indexes locally.
 */
export function syncDenyReason(
  raw: string,
  opts?: {
    userDomains?: string[];
    hasPasswordInput?: boolean;
    title?: string | null;
    pageText?: string | null;
    ownIds?: OwnFileIds | null;
  }
): SyncDenyReason | null {
  if (opts?.hasPasswordInput) return "password";
  if (isCortexOwnFile(raw, opts?.title, opts?.ownIds)) return "cortex";

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "browser";
  }

  if (browserProtocol(url.protocol)) return "browser";
  if (LOCAL_HOSTS.has(url.hostname.toLowerCase())) return "local";
  if (shouldAlwaysSkipUrl(raw)) return "sensitive";
  if (looksSensitiveHostname(url.hostname, url.pathname)) return "sensitive";
  if (isBlockedDomain(url.hostname, opts?.userDomains ?? [])) return "user";
  if (isRedirectUrl(raw)) return "redirect";
  if (isChallengePage({ url: raw, title: opts?.title, text: opts?.pageText })) return "challenge";
  return null;
}

export function documentHasPasswordInput(doc: { querySelector: (selector: string) => unknown }): boolean {
  return doc.querySelector(PASSWORD_INPUT_SELECTOR) != null;
}
