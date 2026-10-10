import { canonicalizeUrl, domainFromUrl } from "./canonical-url";
import { assistantSyncDb, type SyncProfileFields } from "./db";
import { syncDenyReason, type OwnFileIds } from "./denylist";
import { COMPANY_SECTIONS, HOW_FOUND, type CompanySection, type HowFound } from "./linkedin-selectors";
import { linkedInSyncRow } from "./linkedin-sync";
import { localVisitStamp } from "./local-time";
import { clipText, countsAsRead, DRAFT_MAX_CHARS, readText, tidyText } from "./page-text";
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
    location?: string;
    about?: string;
    aboutTruncated?: boolean;
    experience?: { title?: string; company?: string; dates?: string; location?: string; description?: string }[];
    education?: string[];
    schools?: { school?: string; degree?: string; field?: string; years?: string }[];
    skills?: string[];
    publicView?: boolean;
    detailsPage?: "experience" | "education" | "skills";
  } | null;
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
   * measured dwell and decides whether the page was read. Page text is held locally until then.
   */
  open?: boolean;
}

export { DRAFT_MAX_CHARS };

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

/** Pages with less text than this are too thin to tag: a topic would come from the title alone. */
export const TOPIC_MIN_TEXT_CHARS = 200;

/** Search results are lists of links, so they get no topics; neither does a page with almost no text. */
export function topicsAllowed(pageText: string | null, isSearch: boolean): boolean {
  if (isSearch) return false;
  return (pageText ?? "").replace(/\s+/g, " ").trim().length >= TOPIC_MIN_TEXT_CHARS;
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
    pageText: input.pageText,
    ownIds: input.ownIds,
  });
  if (denied) return { stored: false, reason: denied };

  const previous = await assistantSyncDb.visits.get(input.id);
  if (input.open && previous?.finalizedAt != null) return { stored: false, reason: "final" };

  const title = syncTitle(input.title);
  const search = parseSearchQuery(input.url);
  const taggable = topicsAllowed(input.pageText, Boolean(search));
  const embedding = !taggable ? null : input.pageEmbedding?.length ? input.pageEmbedding : await embedForTopics(input, title);
  const tagged = embedding?.length ? tagTopics(embedding, TOPIC_SIMILARITY_THRESHOLD, await loadTopicVectors()) : [];
  // A re-read of the same visit without page text keeps the topics found earlier.
  const topics = !taggable && search ? [] : tagged.length ? tagged : (previous?.topics ?? []);
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

  const profile = profileFields(input.linkedInFields ?? null);
  // A results page is a list of links; the query is in Searches.
  const keepsText = !search && pageTypeForUrl(canonical) !== "Feed" && !isLinkedInProfileOrCompany(canonical);
  const pageText = keepsText ? redactForSync(tidyText(input.pageText ?? "").slice(0, DRAFT_MAX_CHARS)) : "";
  if (profile?.about) await flagInstructionText(input.id, "text", canonical, profile.about, input.visitedAt);
  if (input.open) {
    if (pageText || profile) await assistantSyncDb.drafts.put({ id: input.id, text: pageText, ...(profile ? { profile } : {}) });
  } else {
    const content = { id: input.id, visitedAt: input.visitedAt, title, url: canonical, topics };
    const activeMs = dwellMinutes == null ? null : dwellMinutes * 60_000;
    const text = pageText && countsAsRead(activeMs, maxScrollPct) ? readText(pageText, maxScrollPct) : "";
    if (profile) {
      await assistantSyncDb.content.put({ ...content, text: "", profile });
    } else if (text) {
      await flagInstructionText(input.id, "text", canonical, text, input.visitedAt);
      await assistantSyncDb.content.put({ ...content, text });
    }
  }

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

const oneLine = (value: string | undefined, max: number) => redactForSync((value ?? "").replace(/\s+/g, " ").trim()).slice(0, max);

/**
 * Name, headline, location, current role, About, Experience, Education, and Skills of an opened
 * profile, as labeled fields. Never photos, contact info, or messages.
 */
export function profileFields(fields: FinalizedVisitInput["linkedInFields"]): SyncProfileFields | null {
  if (!fields || fields.kind !== "person" || !fields.name.trim()) return null;
  const experience = (fields.experience ?? [])
    .map((row) => {
      const location = oneLine(row.location, 120);
      const description = oneLine(row.description, PROFILE_DESCRIPTION_CHARS + 3);
      return {
        title: oneLine(row.title, 160),
        company: oneLine(row.company, 120),
        dates: oneLine(row.dates, 80),
        ...(location ? { location } : {}),
        ...(description ? { description } : {}),
      };
    })
    .filter((row) => row.title || row.company)
    .slice(0, 10);
  const education = (fields.education ?? []).map((row) => oneLine(row, 200)).filter(Boolean).slice(0, 5);
  const schools = (fields.schools ?? [])
    .map((row) => ({ school: oneLine(row.school, 160), degree: oneLine(row.degree, 160), field: oneLine(row.field, 160), years: oneLine(row.years, 40) }))
    .filter((row) => row.school)
    .slice(0, 5);
  const skills = (fields.skills ?? []).map((row) => oneLine(row, 80)).filter(Boolean).slice(0, 10);
  const current = experience.find((row) => /\bpresent\b/i.test(row.dates));
  const currentRole = current ? [current.title, current.company].filter(Boolean).join(" at ") : "";
  const about = redactForSync(tidyText(fields.about ?? "")).slice(0, PROFILE_ABOUT_CHARS);
  return {
    name: oneLine(fields.name, 120),
    headline: oneLine(fields.headline, 220),
    location: oneLine(fields.location, 160),
    ...(currentRole ? { currentRole } : {}),
    about,
    ...(about && fields.aboutTruncated ? { aboutTruncated: true } : {}),
    experience,
    education,
    ...(schools.length ? { schools } : {}),
    ...(skills.length ? { skills } : {}),
    ...(fields.publicView ? { publicView: true } : {}),
    ...(fields.profileUrl ? { profileUrl: canonicalizeUrl(fields.profileUrl) ?? fields.profileUrl } : {}),
    ...(fields.detailsPage ? { detailsPage: fields.detailsPage } : {}),
  };
}

export const PROFILE_ABOUT_CHARS = 3000;
export const PROFILE_DESCRIPTION_CHARS = 300;

/** Text of a post saved per section. */
export const POST_MAX_CHARS = 1500;

export interface FeedPostInput {
  /** The feed page the post was seen on. */
  url: string;
  visitId: string;
  seenAt: number;
  author: string;
  text: string;
  /** LinkedIn's activity id from the post element, when it had one. */
  urn?: string;
  timeZone: string;
  syncEnabled: boolean;
  userDenylist: string[];
  ownIds?: OwnFileIds | null;
}

function shortHash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b ^ c, 2246822507);
  }
  return ((a >>> 0).toString(36) + (b >>> 0).toString(36)).slice(0, 12);
}

/** `post:<hash>`: the same post seen again that day keeps one id, so it is saved once. */
export function postId(post: { urn?: string; author: string; text: string }, date: string): string {
  const key = post.urn?.trim() || `${post.author}\n${post.text.slice(0, 300)}`;
  return `post:${shortHash(`${key}\n${date}`)}`;
}

const ACTIVITY_URN = /^urn:li:activity:\d+$/;

/** One LinkedIn feed post that stayed on screen 2 seconds or more. The feed setting is checked by the caller. */
export async function captureFeedPost(input: FeedPostInput): Promise<CaptureResult> {
  if (!input.syncEnabled) return { stored: false, reason: "disabled" };
  const denied = syncDenyReason(input.url, { userDomains: input.userDenylist, ownIds: input.ownIds });
  if (denied) return { stored: false, reason: denied };
  const author = oneLine(input.author, 120);
  const text = clipText(redactForSync(tidyText(input.text)), POST_MAX_CHARS);
  if (!text) return { stored: false, reason: "empty" };
  const date = localVisitStamp(input.seenAt, input.timeZone).date;
  const id = postId({ urn: input.urn, author, text }, date);
  if (await assistantSyncDb.posts.get(id)) return { stored: false, reason: "seen" };
  const urn = input.urn?.trim() ?? "";
  const url = ACTIVITY_URN.test(urn) ? `https://www.linkedin.com/feed/update/${urn}/` : (canonicalizeUrl(input.url) ?? input.url);
  await assistantSyncDb.posts.put({ id, visitId: input.visitId, visitedAt: input.seenAt, author, text, url });
  await flagInstructionText(id, "post", url, text, input.seenAt);
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
