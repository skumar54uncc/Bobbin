/**
 * The local record behind Ask any assistant: searches and page text, kept on this device
 * whenever capture is on, whether or not Assistant Sync is on. The same denylist, redaction
 * and instruction flagging as sync apply. The sync engine never reads these tables, so
 * turning sync on later uploads none of it.
 */
import { canonicalizeUrl, domainFromUrl } from "./canonical-url";
import { DEFAULT_RETENTION_DAYS } from "./db";
import { localMemoryDb } from "./local-memory-db";
import { syncDenyReason, type OwnFileIds } from "./denylist";
import { flagInstructionText, instructionFlags } from "./instruction-flags";
import { pageTypeForUrl } from "./page-type";
import { redactForSync, syncTitle } from "./redact-sync";
import { parseSearchQuery } from "./search-capture";
import { tidyText } from "./page-text";

/** Same cap as a Pages doc section. */
export const LOCAL_TEXT_CHARS = 4000;

export interface LocalMemoryInput {
  id: string;
  url: string;
  title: string;
  visitedAt: number;
  pageText: string | null;
  userDenylist: string[];
  retentionDays?: number;
  ownIds?: OwnFileIds | null;
  now?: number;
}

function keepsText(url: string, isSearch: boolean): boolean {
  if (isSearch || pageTypeForUrl(url) === "Feed") return false;
  try {
    const u = new URL(url);
    const linkedIn = u.hostname === "linkedin.com" || u.hostname.endsWith(".linkedin.com");
    return !(linkedIn && (u.pathname.includes("/in/") || u.pathname.includes("/company/")));
  } catch {
    return false;
  }
}

export async function captureLocalMemory(input: LocalMemoryInput): Promise<{ stored: boolean; reason?: string }> {
  const canonical = canonicalizeUrl(input.url);
  if (!canonical) return { stored: false, reason: "url" };
  const denied = syncDenyReason(input.url, {
    userDomains: input.userDenylist,
    hasPasswordInput: false,
    title: input.title,
    pageText: input.pageText,
    ownIds: input.ownIds,
  });
  if (denied) return { stored: false, reason: denied };

  const host = domainFromUrl(canonical);
  const search = parseSearchQuery(input.url);
  let stored = false;
  if (search) {
    await localMemoryDb.searches.put({
      id: input.id,
      visitedAt: input.visitedAt,
      host,
      engine: search.engine,
      query: redactForSync(search.query),
    });
    stored = true;
  }
  const text = keepsText(canonical, Boolean(search))
    ? redactForSync(tidyText(input.pageText ?? "").slice(0, LOCAL_TEXT_CHARS))
    : "";
  if (text) {
    // Adds a warning for review; never clears one sync recorded for the same visit.
    if (instructionFlags(text).flags.length) await flagInstructionText(input.id, "text", canonical, text, input.visitedAt);
    await localMemoryDb.texts.put({ id: input.id, visitedAt: input.visitedAt, host, url: canonical, title: syncTitle(input.title), text });
    stored = true;
  }

  const cutoff = (input.now ?? Date.now()) - (input.retentionDays ?? DEFAULT_RETENTION_DAYS) * 86_400_000;
  await localMemoryDb.searches.where("visitedAt").below(cutoff).delete();
  await localMemoryDb.texts.where("visitedAt").below(cutoff).delete();
  return { stored };
}
