import { canonicalizeUrl, domainFromUrl } from "./canonical-url";
import { assistantSyncDb } from "./db";
import { syncDenyReason, type OwnFileIds } from "./denylist";
import { buildExcerpt } from "./excerpt";
import { COMPANY_SECTIONS, HOW_FOUND, type CompanySection, type HowFound } from "./linkedin-selectors";
import { linkedInSyncRow } from "./linkedin-sync";
import { pageTypeForUrl } from "./page-type";
import { redactForSync, syncTitle } from "./redact-sync";
import { parseSearchQuery } from "./search-capture";
import { flagInstructionText } from "./instruction-flags";
import { loadTopicVectors, tagTopics, TOPIC_SIMILARITY_THRESHOLD } from "./topics";

export interface FinalizedVisitInput {
  id: string;
  visitedAt: number;
  title: string;
  url: string;
  /** Null on rows captured before sync measured a visit. Never invented. */
  dwellMinutes: number | null;
  maxScrollPct: number | null;
  pageText: string | null;
  pageEmbedding: number[] | null;
  hasPasswordInput: boolean;
  userDenylist: string[];
  referrer: string | null;
  linkedInDocument: Document | null;
  /**
   * Parsed LinkedIn fields from index time (no Document needed).
   * Used when extract.js already sent a person/company with the visit.
   */
  linkedInFields?: {
    kind: "person" | "company";
    name: string;
    headline?: string;
    company?: string;
    profileUrl: string;
    howFound?: string;
    sectionViewed?: string;
  } | null;
  excerptMinDwellMinutes?: number;
  /** Writes nothing unless the user has turned sync on. */
  syncEnabled: boolean;
  /** Stored Drive ids of the Cortex Memory sheet and folder. Those pages are never captured. */
  ownIds?: OwnFileIds | null;
  /**
   * On-device embedding (the search model) used for topics when `pageEmbedding` is not given.
   * Runs only after the privacy checks pass.
   */
  embed?: (text: string) => Promise<number[] | null>;
  /**
   * The tab is still on this page. The row waits for `finalizeVisit`, which adds the
   * measured dwell and decides on the excerpt. Page text is held locally until then.
   */
  open?: boolean;
}

/** Page text kept for a later excerpt. Longer than the excerpt so trimming has room. */
export const DRAFT_MAX_CHARS = 4000;

export interface CaptureResult {
  stored: boolean;
  reason?: string;
}

function clampScroll(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function blankToNull(value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  return value;
}

/**
 * Title and the start of the page, embedded the way the topic threshold was tuned: a paragraph
 * of page text (eval/queries/topic-fixtures.ts). The model reads about 256 tokens, so more is wasted.
 */
export const TOPIC_TEXT_CHARS = 1200;

export function topicText(title: string, pageText: string | null): string {
  const body = (pageText ?? "").replace(/\s+/g, " ").trim();
  if (!body) return "";
  return `${title}. ${body}`.slice(0, TOPIC_TEXT_CHARS);
}

async function embedForTopics(input: FinalizedVisitInput, title: string): Promise<number[] | null> {
  const text = topicText(title, redactForSync(input.pageText ?? ""));
  if (!text || !input.embed) return null;
  return input.embed(text).catch(() => null);
}

function isLinkedInProfileOrCompany(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!(host === "linkedin.com" || host.endsWith(".linkedin.com"))) return false;
    return parsed.pathname.includes("/in/") || parsed.pathname.includes("/company/");
  } catch {
    return false;
  }
}

/**
 * Store one finalized visit in the Assistant Sync database.
 * Denied pages and a disabled toggle write nothing.
 */
export async function captureFinalizedVisit(input: FinalizedVisitInput): Promise<CaptureResult> {
  if (!input.syncEnabled) return { stored: false, reason: "disabled" };

  const canonical = canonicalizeUrl(input.url);
  if (!canonical) return { stored: false, reason: "url" };

  const denied = syncDenyReason(input.url, {
    userDomains: input.userDenylist,
    hasPasswordInput: input.hasPasswordInput,
    title: input.title,
    ownIds: input.ownIds,
  });
  if (denied) return { stored: false, reason: denied };

  const previous = await assistantSyncDb.visits.get(input.id);
  if (input.open && previous?.finalizedAt != null) return { stored: false, reason: "final" };

  const title = syncTitle(input.title);
  const embedding = input.pageEmbedding?.length ? input.pageEmbedding : await embedForTopics(input, title);
  const tagged = embedding?.length ? tagTopics(embedding, TOPIC_SIMILARITY_THRESHOLD, await loadTopicVectors()) : [];
  // A re-read of the same visit without page text keeps the topics found earlier.
  const topics = tagged.length ? tagged : (previous?.topics ?? []);
  const dwellMinutes = blankToNull(input.dwellMinutes);
  const maxScrollPct = clampScroll(input.maxScrollPct);

  await assistantSyncDb.visits.put({
    id: input.id,
    visitedAt: previous?.visitedAt ?? input.visitedAt,
    title,
    url: canonical,
    domain: domainFromUrl(canonical),
    dwellMinutes,
    maxScrollPct,
    pageType: pageTypeForUrl(canonical),
    topics,
    ...(input.open ? {} : { finalizedAt: input.visitedAt }),
  });
  await flagInstructionText(input.id, "title", canonical, title, input.visitedAt);

  if (input.open) {
    const text = redactForSync((input.pageText ?? "").replace(/\s+/g, " ").trim().slice(0, DRAFT_MAX_CHARS));
    if (text) await assistantSyncDb.drafts.put({ id: input.id, text });
  }

  const excerpt =
    input.open || pageTypeForUrl(canonical) === "Feed"
      ? null
      : buildExcerpt(redactForSync(input.pageText ?? ""), dwellMinutes, input.excerptMinDwellMinutes);
  if (excerpt && !isLinkedInProfileOrCompany(canonical)) {
    await flagInstructionText(input.id, "excerpt", canonical, excerpt, input.visitedAt);
    await assistantSyncDb.content.put({
      id: input.id,
      visitedAt: input.visitedAt,
      title,
      url: canonical,
      topics,
      excerpt,
    });
  }

  const search = parseSearchQuery(input.url);
  if (search) {
    await assistantSyncDb.searches.put({
      id: input.id,
      visitedAt: input.visitedAt,
      engine: search.engine,
      query: redactForSync(search.query),
    });
  }

  const linkedRow = input.linkedInDocument
    ? linkedInSyncRow(input.linkedInDocument, input.url, input.referrer)
    : fieldsToLinkedRow(input.linkedInFields ?? null);
  if (linkedRow?.kind === "person") {
    await assistantSyncDb.people.put({
      id: input.id,
      visitedAt: input.visitedAt,
      name: linkedRow.person.name,
      headline: linkedRow.person.headline,
      company: linkedRow.person.company,
      profileUrl: linkedRow.person.profileUrl,
      howFound: linkedRow.person.howFound,
      dwellMinutes,
      maxScrollPct,
    });
  } else if (linkedRow?.kind === "company") {
    await assistantSyncDb.companies.put({
      id: input.id,
      visitedAt: input.visitedAt,
      company: linkedRow.company.company,
      sectionViewed: linkedRow.company.sectionViewed,
      linkedinUrl: linkedRow.company.linkedinUrl,
      dwellMinutes,
    });
  }

  return { stored: true };
}

function asHowFound(value: string | undefined): HowFound | "" {
  return value && (HOW_FOUND as readonly string[]).includes(value) ? (value as HowFound) : "";
}

function asCompanySection(value: string | undefined): CompanySection | "" {
  return value && (COMPANY_SECTIONS as readonly string[]).includes(value) ? (value as CompanySection) : "";
}

function fieldsToLinkedRow(
  fields: FinalizedVisitInput["linkedInFields"]
): ReturnType<typeof linkedInSyncRow> {
  if (!fields || !fields.name.trim() || !fields.profileUrl.trim()) return null;
  if (fields.kind === "company") {
    return {
      kind: "company",
      company: {
        company: redactForSync(fields.name.replace(/\s+/g, " ").trim()),
        sectionViewed: asCompanySection(fields.sectionViewed),
        linkedinUrl: fields.profileUrl,
      },
    };
  }
  return {
    kind: "person",
    person: {
      name: redactForSync(fields.name.replace(/\s+/g, " ").trim()),
      headline: redactForSync((fields.headline ?? "").replace(/\s+/g, " ").trim()),
      company: redactForSync((fields.company ?? "").replace(/\s+/g, " ").trim()),
      profileUrl: fields.profileUrl,
      howFound: asHowFound(fields.howFound),
    },
  };
}
