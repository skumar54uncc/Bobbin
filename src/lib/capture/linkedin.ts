/**
 * LinkedIn profile and company parsing (Phase 5.1, detail added in 1.2.x).
 * Runs inside extract.js on linkedin.com pages that passed the privacy gate.
 * Everything read here is page-controlled text: it is read with textContent
 * only (never innerHTML), trimmed, length-capped, and later rendered with
 * textContent only.
 */

/** One experience row: what the person did and where. */
export interface LinkedInRole {
  title: string;
  company: string;
  /** The row's date line as shown, for example "Jan 2023 - Present · 1 yr 10 mos". */
  dates?: string;
  /** "Bergen, Norway · On-site", when the row shows one. */
  location?: string;
  /** The start of the role description, up to 300 characters. */
  description?: string;
}

/** One education row, split the way LinkedIn shows it. */
export interface LinkedInSchool {
  school: string;
  degree: string;
  field: string;
  years: string;
}

export interface LinkedInEntity {
  kind: "person" | "company";
  name: string;
  headline: string;
  company: string;
  profileUrl: string;
  /**
   * Optional detail (release 1.2.x). Each field is left off when the page did
   * not show it, so rows captured by 1.2.0 still read.
   */
  location?: string;
  about?: string;
  /** Current role title, from the first experience row. */
  roleTitle?: string;
  pastRoles?: LinkedInRole[];
  /** Every experience row in page order, current role first, with dates. */
  experience?: LinkedInRole[];
  education?: string[];
  /** Education rows with degree, field, and years kept apart. */
  schools?: LinkedInSchool[];
  /** Skills the page lists, up to 10. */
  skills?: string[];
  /** The page held only a shortened About (no full copy in the page). */
  aboutTruncated?: boolean;
  /** The logged-out public profile, which shows less. */
  publicView?: boolean;
  /** /in/<slug>/details/experience/ and similar: one section of the profile. */
  detailsPage?: "experience" | "education" | "skills";
  /** "1st", "2nd" or "3rd" as LinkedIn labels the distance. */
  connectionDegree?: string;
  connectionCount?: number;
  /** Company pages only. */
  industry?: string;
  companySize?: string;
  tagline?: string;
  /**
   * https URL of the profile photo on LinkedIn's image host, when the top
   * card actually showed one. Left off for ghost placeholders.
   */
  photoUrl?: string;
  /**
   * One or two plain sentences saying what this profile carried: role and
   * company, where they are, and the opening of the about text. Shown on the
   * person card and searched, so the owner can find someone by what they do.
   */
  summary?: string;
  /** About, experience and education text, kept so a later search can find a vague memory. */
  profileText?: string;
}

const MAX_NAME = 120;
const MAX_HEADLINE = 220;
const MAX_COMPANY = 120;
const MAX_LOCATION = 120;
const MAX_ABOUT = 3000;
const MAX_ROLE = 140;
const MAX_EDUCATION = 160;
const MAX_INDUSTRY = 120;
const MAX_SIZE = 80;
const MAX_PAST_ROLES = 5;
const MAX_EXPERIENCE = 10;
const MAX_EDUCATION_ITEMS = 5;
const MAX_SKILLS = 10;
const MAX_DESCRIPTION = 300;
/** Guards against a page claiming an absurd network size. */
const MAX_CONNECTIONS = 1_000_000;

function clean(s: string | null | undefined, max: number): string {
  return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function isLinkedInHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "linkedin.com" || h.endsWith(".linkedin.com");
}

/** https://www.linkedin.com/in/<slug>/ or a company, school, or showcase page, else null. */
export function canonicalLinkedInUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!isLinkedInHost(u.hostname)) return null;
  const m = u.pathname.match(/^\/(in|company|school|showcase)\/([^/?#]+)/i);
  if (!m) return null;
  const slug = decodeURIComponent(m[2]!).toLowerCase();
  if (!/^[\p{L}\p{N}._%-]{1,100}$/u.test(slug)) return null;
  return `https://www.linkedin.com/${m[1]!.toLowerCase()}/${encodeURIComponent(slug).toLowerCase()}/`;
}

/**
 * True when both URLs are the same LinkedIn profile or company. Tracking
 * queries and /overlay/ paths do not make them different people.
 */
export function sameLinkedInProfile(a: string, b: string): boolean {
  const left = canonicalLinkedInUrl(a);
  return left != null && left === canonicalLinkedInUrl(b);
}

/* ------------------------------------------------------------------ names */

/** A name longer than this is chrome or a whole paragraph, not a person. */
const MAX_PLAUSIBLE_NAME = 80;
/** A slug with more parts than this is not a name either. */
const MAX_NAME_PARTS = 6;

/**
 * LinkedIn chrome that has been stored as a person's name: nav items, the
 * notification panel heading, sign in prompts, the product name itself.
 * Compared with letters and digits only, so "My Network" and "MyNetwork"
 * are the same entry.
 */
const JUNK_NAMES = new Set([
  "notifications",
  "notification",
  "home",
  "mynetwork",
  "network",
  "jobs",
  "job",
  "messaging",
  "messages",
  "message",
  "feed",
  "linkedin",
  "linkedinmember",
  "linkedincorporation",
  "linkedinuser",
  "member",
  "signin",
  "signup",
  "login",
  "logout",
  "joinnow",
  "join",
  "search",
  "searchresults",
  "premium",
  "trypremium",
  "retrypremium",
  "profile",
  "myitems",
  "me",
  "work",
  "post",
  "startapost",
  "groups",
  "events",
  "learning",
  "salesnavigator",
  "recruiter",
  "advertise",
  "settings",
  "help",
  "menu",
  "more",
  "back",
  "close",
  "unknown",
  "unknownuser",
  "deletedmember",
]);

/** Words that only ever appear together in chrome ("Home My Network Jobs"). */
const JUNK_WORDS = new Set([
  "notifications",
  "home",
  "my",
  "network",
  "jobs",
  "messaging",
  "messages",
  "feed",
  "linkedin",
  "search",
  "premium",
  "sign",
  "in",
  "join",
  "now",
  "me",
  "work",
  "post",
  "member",
  "menu",
  "more",
  "back",
  "close",
]);

/** "(12) Notifications" is the tab title with an unread counter on it. */
function stripCounter(s: string): string {
  return s.replace(/^\s*\(\s*\d+\s*\)\s*/, "");
}

/** Letters and digits only, lowercased: the key both junk lists compare on. */
function nameKey(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * True when this text must never be stored as a name: LinkedIn chrome, a
 * counter, digits or punctuation on their own, or something too long or
 * multi line to be a name at all.
 */
export function isJunkProfileName(raw: string | null | undefined): boolean {
  const original = String(raw ?? "");
  if (/[\r\n]/.test(original)) return true;
  const text = stripCounter(original).replace(/\s+/g, " ").trim();
  if (!text || text.length > MAX_PLAUSIBLE_NAME) return true;
  const key = nameKey(text);
  // Nothing but digits or punctuation, or a single character.
  if (!/\p{L}/u.test(key) || key.length < 2) return true;
  if (JUNK_NAMES.has(key)) return true;
  const words = text.split(/\s+/).map(nameKey).filter(Boolean);
  return words.length > 0 && words.every((w) => JUNK_WORDS.has(w));
}

/** "-1a2b3c4", "12345": LinkedIn's uniqueness suffix, never part of a name. */
function isIdPart(part: string): boolean {
  return /^(?=.*\d)[\p{L}\p{N}]+$/u.test(part);
}

function titleCasePart(part: string): string {
  return part.charAt(0).toLocaleUpperCase() + part.slice(1);
}

/**
 * The name a canonical profile URL carries: /in/jenna-leigh-hornbeak/ gives
 * "Jenna Leigh Hornbeak". Returns "" when the slug cannot plausibly be a name
 * (an id, a single letter, or chrome), so the caller stores nothing instead.
 */
export function nameFromProfileUrl(url: string): string {
  const canonical = canonicalLinkedInUrl(String(url ?? ""));
  if (!canonical) return "";
  const company = /\/(company|school|showcase)\//i.test(canonical);
  const slug = decodeURIComponent(canonical.split("/").filter(Boolean).pop() ?? "");
  const parts = slug.split(/[-._%+\s]+/).filter(Boolean);
  if (!company) {
    // Drop the trailing id segments LinkedIn appends to keep profile slugs unique.
    while (parts.length > 1 && isIdPart(parts[parts.length - 1]!)) parts.pop();
    if (!parts.length || parts.length > MAX_NAME_PARTS) return "";
    if (parts.some((p) => isIdPart(p) || !/\p{L}/u.test(p))) return "";
  } else if (!parts.length || parts.length > 8 || !parts.some((p) => /\p{L}/u.test(p))) {
    return "";
  }
  const name = parts.map(titleCasePart).join(" ");
  if (name.length < 2 || isJunkProfileName(name)) return "";
  return name;
}

/**
 * The name to store: the first candidate the page gave that is not chrome,
 * else the profile slug. "" means this profile must not be recorded at all.
 */
export function resolveProfileName(
  candidates: (string | null | undefined)[],
  profileUrl: string
): string {
  for (const c of candidates) {
    const text = stripCounter(String(c ?? ""))
      .replace(/\s+/g, " ")
      .trim();
    if (text && !isJunkProfileName(text)) return text.slice(0, MAX_NAME);
  }
  return nameFromProfileUrl(profileUrl);
}

/* --------------------------------------------------------------- summary */

/** About this much: one or two sentences that fit on a card. */
const MAX_SUMMARY = 200;

export interface ProfileSummaryInput {
  kind?: "person" | "company";
  name?: string;
  headline?: string;
  company?: string;
  location?: string;
  about?: string;
  roleTitle?: string;
  industry?: string;
  companySize?: string;
  tagline?: string;
}

/** Cuts on a word boundary and marks the cut, never mid word. */
function fit(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 3);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 20 ? cut.slice(0, sp) : cut).replace(/[.,;:·]+$/, "")}...`;
}

function asSentence(text: string): string {
  const t = text.replace(/\s+/g, " ").trim().replace(/[·|,;:.\s]+$/, "");
  return t ? `${t}.` : "";
}

/** Titles and abbreviations whose full stop does not end a sentence. */
const ABBREVIATION =
  /(?:^|\s)(?:mr|mrs|ms|dr|prof|sr|jr|st|inc|ltd|llc|co|corp|vs|etc|e\.g|i\.e|u\.s|ph\.d)$/i;
/** Below this a "sentence" is an initial or a stray dot, not a thought. */
const MIN_SENTENCE = 12;

/** The first sentence of an about text, or "" when there is nothing usable. */
function firstSentence(about: string): string {
  const t = about.replace(/\s+/g, " ").trim();
  if (!t) return "";
  for (const m of t.matchAll(/[.!?](?=\s|$)/g)) {
    const at = m.index ?? 0;
    if (at + 1 < MIN_SENTENCE) continue;
    if (ABBREVIATION.test(t.slice(0, at))) continue;
    return t.slice(0, at + 1).trim();
  }
  return t.length <= 140 ? asSentence(t) : "";
}

/** The headline without the trailing tagline LinkedIn joins with a bullet. */
function headlineLead(headline: string): string {
  return headline.split("·")[0]!.replace(/\s+/g, " ").trim();
}

/**
 * A short, plain description of what this profile carried. Built from the
 * strongest signals the page gave: role and company, place, and the opening
 * of the about text. "" when the page carried nothing worth saying.
 */
export function buildProfileSummary(e: ProfileSummaryInput): string {
  const t = (v: string | undefined): string => String(v ?? "").replace(/\s+/g, " ").trim();
  const company = t(e.company);
  const location = t(e.location);
  const headline = headlineLead(t(e.headline));
  let head = "";

  if (e.kind === "company") {
    head = t(e.tagline) || headline;
    const facts = [t(e.industry), location, t(e.companySize)].filter(Boolean).join(", ");
    const parts = [head ? asSentence(head) : "", facts ? asSentence(facts) : ""].filter(Boolean);
    let out = parts.join(" ");
    const opening = firstSentence(t(e.about));
    if (opening && `${out} ${opening}`.trim().length <= MAX_SUMMARY) out = `${out} ${opening}`.trim();
    return fit(out, MAX_SUMMARY);
  }

  const role = t(e.roleTitle);
  if (role && company) head = `${role} at ${company}`;
  else if (role) head = role;
  else if (headline && company && !headline.toLowerCase().includes(company.toLowerCase()))
    head = `${headline} at ${company}`;
  else if (headline) head = headline;
  else if (company) head = `Works at ${company}`;

  if (head && location) head = `${head}, based in ${location}`;
  else if (!head && location) head = `Based in ${location}`;

  let out = head ? asSentence(head) : "";
  const opening = firstSentence(t(e.about));
  if (opening) {
    const joined = `${out} ${opening}`.trim();
    if (joined.length <= MAX_SUMMARY) out = joined;
  }
  return fit(out, MAX_SUMMARY);
}

/* ----------------------------------------------------------------- parse */

function titleParts(doc: Document): { name: string; rest: string } {
  const raw = (doc.title || "")
    .replace(/^\(\d+\)\s*/, "")
    .replace(/\s*\|\s*LinkedIn\s*$/i, "")
    .trim();
  const idx = raw.indexOf(" - ");
  if (idx === -1) {
    const colon = raw.indexOf(":");
    return { name: colon > 0 ? raw.slice(0, colon).trim() : raw, rest: "" };
  }
  return { name: raw.slice(0, idx).trim(), rest: raw.slice(idx + 3).trim() };
}

/**
 * Nav, header, footer and the notification or messaging overlays. Text inside
 * these belongs to the viewer's own LinkedIn, not to the profile subject, so
 * the parse never reads a name out of it.
 */
function isChromeElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "nav" || tag === "footer" || tag === "aside") return true;
  // The profile card has its own header. Only the site header, outside the
  // profile column, is chrome.
  if (tag === "header" && !el.closest("main, [role='main']")) return true;
  const role = (el.getAttribute("role") ?? "").toLowerCase();
  if (role === "navigation" || role === "banner" || role === "contentinfo" || role === "dialog") return true;
  const cls = typeof el.className === "string" ? el.className : "";
  return /notification|global-nav|global-footer|msg-overlay|nav-item|scaffold-layout-toolbar|search-global/i.test(
    `${el.id} ${cls}`
  );
}

function inChrome(el: Element | null): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (isChromeElement(node)) return true;
  }
  return false;
}

/** The og:title meta, which LinkedIn fills with "Name - Headline". */
function ogTitleName(doc: Document): string {
  const raw = doc.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? "";
  const cleaned = raw.replace(/\s*\|\s*LinkedIn\s*$/i, "").trim();
  const idx = cleaned.indexOf(" - ");
  return (idx === -1 ? cleaned : cleaned.slice(0, idx)).trim();
}

/**
 * Every heading that could be the profile subject's name, best first and with
 * the page chrome left out.
 */
/** A post on a company home tab. Its heading is not the company name. */
function inFeedPost(el: Element): boolean {
  return Boolean(
    el.closest("article, .feed-shared-update-v2, .update-components-actor, [data-urn*='activity'], [data-id*='urn:li:activity']")
  );
}

function headingCandidates(main: Element, isCompany: boolean): string[] {
  const selectors = isCompany
    ? [".org-top-card-summary__title", ".org-top-card h1", ".org-top-card h2", "h1"]
    : [
        "section[data-member-id] h1",
        "section[data-member-id] h2",
        ".pv-top-card h1",
        ".pv-top-card h2",
        ".pv-text-details__left-panel h1",
        ".top-card-layout__title",
        "h1.text-heading-xlarge",
        "h1",
      ];
  const out: string[] = [];
  const seen = new Set<Element>();
  const push = (el: Element): void => {
    if (seen.has(el) || inChrome(el) || inFeedPost(el)) return;
    seen.add(el);
    const text = clean(el.textContent, MAX_NAME)
      .replace(/\s*[·|]\s*(?:1st|2nd|3rd)\b.*$/i, "")
      .trim();
    if (text) out.push(text);
  };
  const card = topCardOf(main);
  if (card !== main) {
    for (const el of Array.from(card.querySelectorAll("h1, h2"))) push(el);
  }
  for (const el of Array.from(main.querySelectorAll("header h1, header h2"))) push(el);
  for (const sel of selectors) {
    for (const el of Array.from(main.querySelectorAll(sel))) push(el);
  }
  return out;
}

function companyFromHeadline(headline: string): string {
  const m = headline.match(/\bat\s+([^·|,]+?)\s*(?:[·|,]|$)/i);
  return m ? m[1]!.trim() : "";
}

function looksLikePlace(line: string): boolean {
  return /^[\p{L}].{1,48},\s*[\p{L}]/u.test(line) && !/\bat\b/i.test(line);
}

/** "Show all", "10%", "37": buttons and stats, never a headline. */
export function isChromeSnippet(raw: string | null | undefined): boolean {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return true;
  if (/^(show all|see all|show more|see more|follow|following|message|connect|more|visit website|view page|learn more)$/i.test(s)) return true;
  if (/^\d+([.,]\d+)?%?$/.test(s)) return true;
  if (/^\d[\d,.\s]*[kmb]?\+?$/i.test(s)) return true;
  return false;
}

/** A line that can be the headline. Long role lines stay; names, places and buttons do not. */
function usableHeadline(t: string, name: string): boolean {
  if (t.length < 2 || t.toLowerCase() === name.toLowerCase()) return false;
  if (isChromeSnippet(t)) return false;
  if (/^(1st|2nd|3rd)$/i.test(t) || /^united states$/i.test(t)) return false;
  if (/\b(contact info|connections?|followers?|mutual|open to work)\b/i.test(t)) return false;
  if (looksLikePlace(t)) return false;
  return true;
}

/** The line under the name. The old class is preferred; current pages have neither that class nor a headline in the tab title. */
function headlineFrom(card: Element, name: string, titleRest: string): string {
  const classic = clean(
    card.querySelector(".text-body-medium, .top-card-layout__headline")?.textContent,
    MAX_HEADLINE
  );
  if (usableHeadline(classic, name)) return classic;
  const fromTitle = clean(titleRest, MAX_HEADLINE);
  if (usableHeadline(fromTitle, name) && !isJunkProfileName(fromTitle)) return fromTitle;
  const lines: string[] = [];
  for (const el of Array.from(card.querySelectorAll("h1, h2, span, p, div"))) {
    if (el.tagName !== "H1" && el.tagName !== "H2" && el.querySelector("h1, h2, span, div, p")) continue;
    const t = clean(el.textContent, MAX_HEADLINE);
    if (usableHeadline(t, name)) lines.push(t);
  }
  return lines.find((t) => t.includes("|") || t.length > 48) ?? lines[0] ?? "";
}

/**
 * Sign-in modals, login forms, ads, and rails about other people. Their text is never the
 * profile's: the live About once held the login popup's text.
 */
const FOREIGN_CLASS =
  /modal|contextual-sign-in|sign-in-form|signin|authwall|join-form|join-now|guest-|cta-|ad-banner|\bads?\b|\bad-|promoted|browsemap|similar-profiles|people-also-viewed|aside|right-rail/i;
/** Section headings of rails that list other profiles or posts. */
const FOREIGN_HEADING =
  /^(people also viewed|other similar profiles|people you may know|more profiles for you|people also follow|pages people also viewed|similar pages|explore (more )?(posts|collaborative articles|premium profiles)|you might like|promoted|ad options|others named .+|add new skills.*)$/i;

function isForeignBlock(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "form" || tag === "dialog" || tag === "aside") return true;
  const role = (el.getAttribute("role") ?? "").toLowerCase();
  if (role === "dialog" || role === "alertdialog" || el.getAttribute("aria-modal") === "true") return true;
  const cls = typeof el.className === "string" ? el.className : "";
  if (FOREIGN_CLASS.test(`${el.id} ${cls}`)) return true;
  if (tag === "section") {
    const heading = el.querySelector("h2, h3");
    if (heading && FOREIGN_HEADING.test(clean(heading.textContent, 80))) return true;
  }
  return false;
}

function inForeignBlock(el: Element | null): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const tag = node.tagName.toLowerCase();
    if (tag === "main" || tag === "body") return false;
    if (isForeignBlock(node)) return true;
  }
  return false;
}

/** Buttons, form fields, and media are controls or pictures, never profile text. */
const NOT_TEXT = "button, input, select, textarea, label, script, style, svg, img, video, [role='button']";

/**
 * A copy of one profile section with overlays, forms, controls, and rails taken out.
 * Public pages keep a shortened and a full copy of long text; the full one stays.
 * A date range split over <time> elements becomes one line.
 */
function cleanCopy(section: Element): Element {
  const copy = section.cloneNode(true) as Element;
  for (const el of Array.from(copy.querySelectorAll("*"))) {
    if (!copy.contains(el)) continue;
    if (el.matches(NOT_TEXT) || isForeignBlock(el)) el.remove();
  }
  for (const box of Array.from(copy.querySelectorAll(".show-more-less-text"))) {
    if (box.querySelector(".show-more-less-text__text--more")) {
      box.querySelectorAll(".show-more-less-text__text--less").forEach((el) => el.remove());
    }
  }
  for (const range of Array.from(copy.querySelectorAll(".date-range"))) {
    range.textContent = clean(range.textContent, MAX_ROLE);
  }
  return copy;
}

/** LinkedIn controls and the login form, as whole lines. */
const UI_LINE =
  /^(?:\u2026|\.\.\.)?\s*(?:see more|see less|show more|show less|show all.*|message|connect|follow|following|join now|join|sign in|sign up|more|pending|save|send|report|endorse|endorsed|dismiss|close|cancel|continue|agree & join|email or phone|password|show|forgot password\??|new to linkedin\?.*|or|sign in to (?:view|see) .+|view .+ full profile|welcome back|contact info|\d+ endorsements?|endorsed by .+|.+ endorsed .+|\d+ (?:followers?|connections?)|by clicking (?:continue|agree).+|.*user agreement.*privacy policy.*)$/i;

export function isUiLine(line: string): boolean {
  const s = line.replace(/\s+/g, " ").trim();
  return !s || UI_LINE.test(s) || isChromeSnippet(s);
}

/** Drops a trailing "...see more" and reports whether the text was cut on the page. */
function untruncate(text: string): { text: string; truncated: boolean } {
  let t = clean(text, MAX_ABOUT + 40);
  const cut = /(?:\u2026|\.\.\.)\s*(?:see more|show more|more)$/i.test(t);
  t = t.replace(/\s*(?:\u2026|\.\.\.)?\s*(?:see more|show more)$/i, "").trim();
  const ellipsis = /(?:\u2026|\.\.\.)$/.test(t);
  return { text: t.replace(/\s*(?:\u2026|\.\.\.)$/, "").trim(), truncated: cut || ellipsis };
}

const SECTION_LABEL: Record<string, RegExp> = {
  about: /^about(?:\s+us)?$/i,
  experience: /^experience$/i,
  education: /^education$/i,
  skills: /^skills$/i,
};

/**
 * LinkedIn used to mark sections with an empty anchor (`<div id="experience">`).
 * The current profile drops those anchors and keeps a plain heading. Public profiles
 * mark the section with data-section.
 */
function sectionFor(main: Element, id: string): Element | null {
  const anchor = main.querySelector(`#${id}`);
  if (anchor && !inForeignBlock(anchor)) return anchor.closest("section") ?? anchor.parentElement ?? anchor;
  const publicName = id === "about" ? '"summary"' : id === "education" ? '"educationsDetails"], section[data-section="education"' : `"${id}"`;
  const publicSection = main.querySelector(`section[data-section=${publicName}]`);
  if (publicSection && !inForeignBlock(publicSection)) return publicSection;
  const label = SECTION_LABEL[id];
  if (!label) return null;
  for (const h of Array.from(main.querySelectorAll("h2, h3"))) {
    if (inChrome(h) || inForeignBlock(h)) continue;
    if (!label.test(clean(h.textContent, 40))) continue;
    return h.closest("section") ?? h.parentElement;
  }
  return null;
}

/** List rows of a section, skipping rows that only wrap other rows. */
function leafItems(section: Element): Element[] {
  return Array.from(section.querySelectorAll("li")).filter((li) => !li.querySelector("li"));
}

const LEAF = "h3, h4, div, span, p";

/**
 * The visible lines of one experience or education row. LinkedIn renders each
 * line twice: once for sighted readers (aria-hidden) and once for screen
 * readers, so the aria-hidden copies alone give each line once.
 */
function entryLines(item: Element): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string | null | undefined, max = MAX_ROLE): void => {
    const v = clean(s, max);
    const key = v.toLowerCase();
    if (!v || seen.has(key) || isUiLine(v)) return;
    seen.add(key);
    out.push(v);
  };
  const hidden = Array.from(item.querySelectorAll('span[aria-hidden="true"]'));
  if (hidden.length) {
    hidden.forEach((el) => push(el.textContent, 1200));
    return out;
  }
  // Public and older markup: one line per leaf element.
  // A date range is one line however many elements it spans; lines stay in page order.
  const leaves = Array.from(item.querySelectorAll(`${LEAF}, .date-range`)).filter((el) =>
    el.matches(".date-range") ? !el.parentElement?.closest(".date-range") : !el.closest(".date-range") && !el.querySelector(`${LEAF}, .date-range`)
  );
  for (const el of leaves.length ? leaves : [item]) push(el.textContent, 1200);
  return out;
}

/** "Jan 2023 to Present", "2012 to 2014", "5 mos": not a title or a school. */
function isDateLine(line: string): boolean {
  return (
    /^(?:[A-Za-z]{3,9}\.?\s+)?\d{4}\b/.test(line) ||
    /\bpresent\b/i.test(line) ||
    /^\d+\s+(?:yrs?|mos?|years?|months?)\b/i.test(line)
  );
}

/** "Bergen, Norway · On-site", "Remote", "Oslo Area". */
function isPlaceLine(line: string): boolean {
  if (line.length > 90) return false;
  return looksLikePlace(line) || /(?:^|·\s*)(?:on-site|remote|hybrid)$/i.test(line) || /\b(?:area|region|metropolitan)$/i.test(line);
}

/** The company half of "Tidora · Full-time". */
function companyOfLine(line: string): string {
  return clean(line.split("·")[0], MAX_COMPANY);
}

function clip(text: string, max: number): string {
  const t = clean(text, max + 1);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trim()}...`;
}

/** First line of a grouped company block (several roles at one company), outside its nested rows. */
function groupCompany(item: Element, section: Element): string {
  const parent = item.parentElement?.closest("li");
  if (!parent || !section.contains(parent)) return "";
  for (const el of Array.from(parent.querySelectorAll('span[aria-hidden="true"], h3, h4'))) {
    if (el.closest("li") !== parent) continue;
    const t = clean(el.textContent, MAX_COMPANY);
    if (t && !isUiLine(t) && !isDateLine(t)) return companyOfLine(t);
  }
  return "";
}

function rolesFrom(main: Element, wholePage = false): LinkedInRole[] {
  const found = sectionFor(main, "experience") ?? (wholePage ? main : null);
  if (!found) return [];
  const section = cleanCopy(found);
  const roles: LinkedInRole[] = [];
  for (const item of leafItems(section)) {
    const all = entryLines(item);
    const dateAt = all.findIndex(isDateLine);
    const dates = dateAt >= 0 ? all[dateAt]! : "";
    const head = (dateAt >= 0 ? all.slice(0, dateAt) : all.slice(0, 2)).filter((l) => !isDateLine(l));
    const title = clean(head[0], MAX_ROLE);
    if (!title || /^(about|experience|education|activity|skills|featured)$/i.test(title)) continue;
    const linked = clean(item.querySelector('a[href*="/company/"]')?.textContent, MAX_COMPANY);
    const company = companyOfLine(head[1] ?? "") || linked || groupCompany(item, section);
    const rest = (dateAt >= 0 ? all.slice(dateAt + 1) : all.slice(2)).filter((l) => !isDateLine(l));
    const location = rest[0] && isPlaceLine(rest[0]) ? rest[0] : "";
    const description = clip(
      (location ? rest.slice(1) : rest).filter((l) => !/^skills:/i.test(l)).join(" "),
      MAX_DESCRIPTION
    );
    roles.push({
      title,
      company,
      ...(dates ? { dates: clean(dates, 80) } : {}),
      ...(location ? { location: clean(location, MAX_LOCATION) } : {}),
      ...(description ? { description } : {}),
    });
    if (roles.length >= MAX_EXPERIENCE) break;
  }
  return roles;
}

/** "Master of Science - MS, Electrical Engineering" to degree and field. */
function splitDegree(line: string): { degree: string; field: string } {
  const at = line.indexOf(", ");
  if (at < 0) return { degree: clean(line, MAX_EDUCATION), field: "" };
  return { degree: clean(line.slice(0, at), MAX_EDUCATION), field: clean(line.slice(at + 2), MAX_EDUCATION) };
}

function schoolsFrom(main: Element, wholePage = false): LinkedInSchool[] {
  const found = sectionFor(main, "education") ?? (wholePage ? main : null);
  if (!found) return [];
  const section = cleanCopy(found);
  const out: LinkedInSchool[] = [];
  for (const item of leafItems(section)) {
    const all = entryLines(item);
    const lines = all.filter((l) => !isDateLine(l));
    const school = clean(lines[0], MAX_EDUCATION);
    if (!school) continue;
    // Public pages put the field on its own line.
    const split = splitDegree(lines[1] ?? "");
    const field = split.field || (lines[2] && lines[2].length <= 120 && !/^(activities|grade)/i.test(lines[2]) ? clean(lines[2], MAX_EDUCATION) : "");
    out.push({ school, degree: split.degree, field, years: clean(all.find(isDateLine), 40) });
    if (out.length >= MAX_EDUCATION_ITEMS) break;
  }
  return out;
}

function skillsFrom(main: Element, wholePage = false): string[] {
  const found = sectionFor(main, "skills") ?? (wholePage ? main : null);
  if (!found) return [];
  const out: string[] = [];
  for (const item of leafItems(cleanCopy(found))) {
    const name = clean(entryLines(item)[0], 80);
    if (name && !out.includes(name)) out.push(name);
    if (out.length >= MAX_SKILLS) break;
  }
  return out;
}

const MAX_PROFILE_TEXT = 4000;

/** The readable profile body: about, roles and education, capped. */
function profileTextFrom(main: Element): string {
  const parts: string[] = [];
  for (const id of ["about", "experience", "education"]) {
    const section = sectionFor(main, id);
    if (!section) continue;
    const t = clean(cleanCopy(section).textContent, 2000);
    if (t) parts.push(t);
  }
  return clean(parts.join(" "), MAX_PROFILE_TEXT);
}

/**
 * The full About text. LinkedIn keeps the whole text in the page and shortens it with CSS,
 * often with a second screen reader copy, so the longest copy wins. Nothing is clicked.
 */
function aboutFrom(main: Element): { text: string; truncated: boolean } {
  const section = sectionFor(main, "about");
  const scope = section ?? main.querySelector('[class*="org-about-us-organization-description"]');
  if (!scope) return { text: "", truncated: false };
  const copy = cleanCopy(scope);
  copy.querySelectorAll("h2, h3").forEach((el) => {
    if (SECTION_LABEL.about!.test(clean(el.textContent, 40))) el.remove();
  });
  // Single copies first. A wrapper holds the visible and the screen reader copy back to back.
  const pick = (selectors: string[]) => {
    const out: string[] = [];
    for (const sel of selectors) {
      for (const el of Array.from(copy.querySelectorAll(sel))) {
        const t = clean(el.textContent, MAX_ABOUT + 40);
        if (t && !isUiLine(t)) out.push(t);
      }
    }
    return out;
  };
  let copies = pick([".show-more-less-text__text--more", 'span[aria-hidden="true"]', ".visually-hidden"]);
  if (!copies.length) copies = pick([".inline-show-more-text", ".core-section-container__content", "p"]);
  if (!copies.length) {
    const whole = clean(copy.textContent, MAX_ABOUT + 40).replace(/^about(?:\s+us)?\s+/i, "");
    if (whole && !isUiLine(whole)) copies.push(whole);
  }
  const longest = copies.sort((x, y) => y.length - x.length)[0] ?? "";
  const { text, truncated } = untruncate(longest);
  return { text: text.slice(0, MAX_ABOUT), truncated: truncated || longest.length > MAX_ABOUT };
}

/** Logged-out public layout: LinkedIn's guest top card with no signed-in navigation. */
function isPublicLayout(doc: Document): boolean {
  const guest = doc.querySelector(".top-card-layout, [data-tracking-control-name^='public_profile'], section.core-section-container");
  const signedIn = doc.querySelector(".global-nav__me, section[data-member-id], .pv-top-card, .scaffold-layout__main");
  return Boolean(guest) && !signedIn;
}

/** /in/<slug>/details/experience/ and its education and skills siblings. */
function detailsPageOf(url: string): LinkedInEntity["detailsPage"] {
  const m = (() => {
    try {
      return new URL(url).pathname.match(/^\/in\/[^/]+\/details\/(experience|education|skills)\/?/i);
    } catch {
      return null;
    }
  })();
  return m ? (m[1]!.toLowerCase() as LinkedInEntity["detailsPage"]) : undefined;
}

const PHOTO_HOSTS = new Set(["media.licdn.com", "static.licdn.com", "avatars.githubusercontent.com"]);

/** A real LinkedIn profile or logo image. Ghost placeholders and other hosts are dropped. */
export function profilePhotoUrl(raw: string | null | undefined): string | undefined {
  const t = String(raw ?? "").trim();
  if (!t || t.startsWith("data:")) return undefined;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return undefined;
  }
  if (u.protocol !== "https:") return undefined;
  if (!PHOTO_HOSTS.has(u.hostname.toLowerCase())) return undefined;
  if (/ghost-person|ghost-company|\/sc\/h\//i.test(`${u.pathname}${u.search}`)) return undefined;
  if (u.hostname.toLowerCase() === "avatars.githubusercontent.com") {
    const size = Number(u.searchParams.get("s") || "0");
    if (!size || size < 400) u.searchParams.set("s", "460");
  }
  return u.href.slice(0, 800);
}

/** The sharpest photo URL the top card actually listed, not a guessed size. */
function bestListedPhoto(img: Element): string | undefined {
  const ranked: { href: string; px: number }[] = [];
  const push = (raw: string | null, hint: number): void => {
    const href = profilePhotoUrl(raw);
    if (!href) return;
    const size = href.match(/(?:shrink|scale)_(\d+)_\d+/i);
    const px = size ? Number(size[1]) : hint;
    if (!ranked.some((r) => r.href === href)) ranked.push({ href, px });
  };
  for (const part of (img.getAttribute("srcset") ?? "").split(",")) {
    const bits = part.trim().split(/\s+/);
    const hinted = Number((bits[1] ?? "").replace(/w$/i, ""));
    if (bits[0]) push(bits[0], Number.isFinite(hinted) ? hinted : 0);
  }
  push(img.getAttribute("src"), 0);
  push(img.getAttribute("data-delayed-url"), 0);
  ranked.sort((a, b) => b.px - a.px);
  const face = ranked.find((r) => /profile-displayphoto|company-logo|displayphoto/i.test(r.href));
  return (face ?? ranked[0])?.href;
}

function pathKey(url: string): string {
  try {
    return new URL(url, "https://www.linkedin.com").pathname.replace(/\/+$/, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Another profile or company. /in/x/overlay/photo/ is still x. */
function linksElsewhere(href: string, selfUrl: string): boolean {
  if (!/\/(?:in|company|school|showcase)\//i.test(href)) return false;
  let abs = "";
  try {
    abs = new URL(href, "https://www.linkedin.com").href;
  } catch {
    return false;
  }
  const self = canonicalLinkedInUrl(selfUrl) ?? pathKey(selfUrl);
  const theirs = canonicalLinkedInUrl(abs) ?? pathKey(abs);
  return Boolean(self && theirs && self !== theirs);
}

/** A face or logo that belongs to a different profile than the page open now. */
function otherEntityPhoto(img: Element, selfUrl: string): boolean {
  return linksElsewhere(img.closest("a[href]")?.getAttribute("href") ?? "", selfUrl);
}

/** Drawn width on the live page. 0 when the page has no layout (tests, hidden tab). */
function shownWidth(img: Element): number {
  try {
    return Math.round(img.getBoundingClientRect().width) || 0;
  } catch {
    return 0;
  }
}

/** The label on the photo itself, not a section that happens to contain it. */
function localLabel(img: Element): string {
  const bits = [img.getAttribute("alt") ?? "", img.getAttribute("aria-label") ?? ""];
  const btn = img.closest("button, a");
  if (btn) bits.push(btn.getAttribute("aria-label") ?? "");
  return bits.join(" ").replace(/\s+/g, " ").trim().toLowerCase();
}

function isProfilePhotoWidget(img: Element): boolean {
  let node: Element | null = img;
  for (let i = 0; i < 4 && node; i += 1, node = node.parentElement) {
    if (/profile-photo|profile-picture|pv-top-card-profile|presence-entity/i.test(node.getAttribute("class") ?? "")) return true;
  }
  return false;
}

const LATER_SECTION = /^(about|experience|education|activity|featured|highlights|interests|skills|licenses|recommendations|more profiles for you|people also viewed|people you may know|analytics)$/i;

/** A face that sits under Experience, Featured, or More profiles, not in the identity block. */
function afterLaterSection(img: Element, card: Element): boolean {
  for (const h of Array.from(card.querySelectorAll("h2, h3"))) {
    const label = clean(h.textContent, 60);
    if (!LATER_SECTION.test(label)) continue;
    if ((h.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) return true;
  }
  return false;
}

/** The picture lives in a card that links to a different profile, even when the img is not inside the anchor. */
function inOtherProfileCard(img: Element, selfUrl: string): boolean {
  const box = img.closest("li, article");
  if (!box) return false;
  const link = box.querySelector("a[href*='/in/'], a[href*='/company/'], a[href*='/school/']");
  return linksElsewhere(link?.getAttribute("href") ?? "", selfUrl);
}

/** Alt text that names someone else, so a recommendation cannot replace this profile. */
function altNamesSomeoneElse(img: Element, name: string): boolean {
  const alt = (img.getAttribute("alt") ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (alt.length < 3 || /logo|icon|cover|background|banner|premium/i.test(alt)) return false;
  const who = name.replace(/\s+/g, " ").trim().toLowerCase();
  if (!who) return false;
  return !alt.includes(who) && !who.includes(alt);
}

function inRecommendationRail(img: Element): boolean {
  return Boolean(
    img.closest('aside, [role="complementary"], .scaffold-layout__aside, [data-view-name*="browse-map"], [data-view-name*="pymk"]')
  );
}

function profilePhotoFrom(
  root: Element,
  kind: "person" | "company",
  name = "",
  selfUrl = ""
): string | undefined {
  const card = topCardOf(root);
  const who = name.replace(/\s+/g, " ").trim().toLowerCase();
  let best = "";
  let bestScore = -1;
  for (const img of Array.from(card.querySelectorAll("img"))) {
    if (inChrome(img) || inFeedPost(img) || inRecommendationRail(img) || otherEntityPhoto(img, selfUrl)) continue;
    if (inOtherProfileCard(img, selfUrl)) continue;
    if (kind === "person" && altNamesSomeoneElse(img, name)) continue;
    // Mutual-connection faces and the viewer's own avatar are drawn at 24 to 48px. The profile photo is far larger.
    const drawn = shownWidth(img);
    if (drawn > 0 && drawn < 64) continue;
    const href = bestListedPhoto(img);
    if (!href) continue;
    const listed = href.match(/(?:shrink|scale)_(\d+)_\d+/i);
    const px = listed ? Number(listed[1]) : 0;
    const school = img.closest('a[href*="/company/"], a[href*="/school/"]');
    const isLogo = /company-logo|school-logo|displaybackground|backgroundimage/i.test(href) || (kind === "person" && Boolean(school));
    if (kind === "person" && isLogo) continue;
    if (kind === "company" && !/company-logo|school-logo/i.test(href)) continue;
    const label = localLabel(img);
    let score = px;
    if (/profile-displayphoto/i.test(href) && !/framed/i.test(href)) score += 2000;
    else if (/framedphoto/i.test(href)) score += 800;
    else if (/company-logo|school-logo/i.test(href)) score += 2000;
    if (who && label.includes(who)) score += 6000;
    if (isProfilePhotoWidget(img)) score += 4000;
    if (/\/overlay\/photo/i.test(img.closest("a[href]")?.getAttribute("href") ?? "")) score += 5000;
    score += drawn * 10;
    // A larger face under "More profiles" must not replace the person at the top.
    if (afterLaterSection(img, card)) score -= 9000;
    if (score > bestScore) {
      best = href;
      bestScore = score;
    }
  }
  return best || undefined;
}

/** Company identity block. On current pages it sits above <main>, not inside the posts column. */
function orgSurface(doc: Document, main: Element): Element {
  const found = doc.querySelector(".org-top-card, .org-top-card-summary, [class*='org-top-card']");
  if (found && !inChrome(found)) return found;
  return topCardOf(main);
}

/** The top card, where the location and the network line live. */
function topCardOf(main: Element): Element {
  for (const sel of [
    "section[data-member-id]",
    ".pv-top-card",
    ".org-top-card",
    ".pv-text-details__left-panel",
    ".top-card-layout",
  ]) {
    for (const el of Array.from(main.querySelectorAll(sel))) {
      if (!inChrome(el)) return el;
    }
  }
  const header = main.querySelector("header");
  if (header && !inChrome(header)) return header;
  const first = main.querySelector("section");
  if (first && !inChrome(first)) {
    const label = clean(first.querySelector("h1, h2")?.textContent, 40);
    if (label && !/^(about|experience|education)$/i.test(label)) return first;
  }
  return main;
}

function locationFrom(card: Element): string {
  const cands = card.querySelectorAll(
    ".pv-text-details__left-panel .text-body-small, .text-body-small, .top-card__subline-item, .org-top-card-summary-info-list__info-item"
  );
  for (const el of Array.from(cands)) {
    const t = clean(el.textContent, MAX_LOCATION);
    if (!t) continue;
    if (/\b(connections?|followers?|contact info|mutual|employees)\b/i.test(t)) continue;
    if (/^\d/.test(t)) continue;
    return t;
  }
  for (const el of Array.from(card.querySelectorAll("span, p"))) {
    if (el.children.length) continue;
    const t = clean(el.textContent, MAX_LOCATION);
    if (looksLikePlace(t) && !/\b(connections?|followers?|employees)\b/i.test(t)) return t;
  }
  return "";
}

function connectionsFrom(card: Element): { degree: string; count?: number } {
  const badge = clean(card.querySelector(".dist-value, .distance-badge")?.textContent, 60);
  const dm = badge.match(/\b(1st|2nd|3rd)\b/i);
  const degree = dm ? dm[1]!.toLowerCase() : "";

  const text = clean(card.textContent, 4000);
  const cm = text.match(/(\d[\d,.]*)\s*\+?\s*connections?\b/i);
  const raw = cm ? Number(cm[1]!.replace(/[,.]/g, "")) : NaN;
  const count = Number.isFinite(raw) && raw > 0 && raw <= MAX_CONNECTIONS ? raw : undefined;
  return { degree, ...(count !== undefined ? { count } : {}) };
}

/** "Renewable Energy", "Bergen", "4,120 followers", "51-200 employees" */
function companyInfoItems(main: Element): string[] {
  const list = main.querySelector(".org-top-card-summary-info-list");
  if (!list) return [];
  const items = Array.from(list.querySelectorAll(".org-top-card-summary-info-list__info-item"))
    .map((el) => clean(el.textContent, MAX_INDUSTRY))
    .filter(Boolean);
  if (items.length) return items;
  return clean(list.textContent, 600)
    .split("·")
    .map((s) => clean(s, MAX_INDUSTRY))
    .filter(Boolean);
}

function companyMetaLine(t: string): boolean {
  return (
    t.includes("·") ||
    /\b(followers?|employees|connections? follow)\b/i.test(t) ||
    /^(home|about|about us|posts|jobs|people|overview|life|insights)$/i.test(t)
  );
}

/** The line under the company name. A campus caption or the about paragraph is not the tagline. */
function companyHeadlineFrom(main: Element, name: string): string {
  const classic = clean(
    main.querySelector(".org-top-card-summary__tagline, [class*='tagline']")?.textContent,
    MAX_HEADLINE
  );
  if (classic && !isChromeSnippet(classic) && classic.toLowerCase() !== name.toLowerCase() && !companyMetaLine(classic)) return classic;
  const card = topCardOf(main);
  const heading = Array.from(card.querySelectorAll("h1, h2")).find((el) => !inChrome(el) && clean(el.textContent, 80));
  const headingText = heading ? clean(heading.textContent, 80).toLowerCase() : "";
  const lines: string[] = [];
  let afterHeading = !heading;
  for (const el of Array.from(card.querySelectorAll("p, span, div"))) {
    if (heading && (el === heading || heading.contains(el))) continue;
    if (!afterHeading && heading) {
      afterHeading = (heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      if (!afterHeading) continue;
    }
    if (inChrome(el) || inFeedPost(el) || el.querySelector("p, span, div, h1, h2, a, button, li")) continue;
    const t = clean(el.textContent, MAX_HEADLINE);
    const low = t.toLowerCase();
    if (t.length < 2 || t.length > 160) continue;
    if (low === name.toLowerCase() || (headingText && low === headingText)) continue;
    if (isChromeSnippet(t) || companyMetaLine(t) || looksLikePlace(t) || /^(of|at|in)\b/i.test(t)) continue;
    lines.push(t);
  }
  // The tagline is the first real line under the name. The shortest line on a jobs tab is "37" or "Show all".
  const tagline = lines.find((t) => t.length <= 90 && !/[.!?]$/.test(t));
  return tagline ?? lines[0] ?? "";
}

/** How much of the company slug this name explains. The tab title often matches the slug. */
function slugAffinity(name: string, profileUrl: string): number {
  const slug = (profileUrl.match(/\/(?:company|school|showcase)\/([^/]+)/i)?.[1] ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  const tokens = name.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  if (!slug || !tokens.length) return 0;
  if (tokens.join("") === slug) return 100;
  let rest = slug;
  let covered = 0;
  for (const token of tokens) {
    const at = rest.indexOf(token);
    if (at < 0) continue;
    covered += token.length;
    rest = rest.slice(at + token.length);
  }
  return Math.round((covered / slug.length) * 80);
}

export function parseLinkedInPage(doc: Document, url: string): LinkedInEntity | null {
  const profileUrl = canonicalLinkedInUrl(url);
  if (!profileUrl) return null;
  const isCompany = /\/(company|school|showcase)\//.test(profileUrl);
  const main = doc.querySelector("main") ?? doc.body;
  if (!main) return null;
  const title = titleParts(doc);
  const { text: about, truncated: aboutTruncated } = aboutFrom(main);
  const profileText = profileTextFrom(main);

  if (isCompany) {
    const surface = orgSurface(doc, main);
    const nameCandidates = [...headingCandidates(surface, true), title.name, ogTitleName(doc)];
    let name = resolveProfileName(nameCandidates, profileUrl);
    let nameScore = slugAffinity(name, profileUrl);
    for (const candidate of nameCandidates) {
      const shown = String(candidate ?? "").replace(/\s+/g, " ").trim();
      if (!shown || isJunkProfileName(shown)) continue;
      const next = shown.slice(0, MAX_NAME);
      const score = slugAffinity(next, profileUrl);
      if (score > nameScore) {
        name = next;
        nameScore = score;
      }
    }
    // A post heading or a tab that still says "Feed" must not replace the company.
    if (nameScore < 55) {
      const fromSlug = nameFromProfileUrl(profileUrl);
      if (fromSlug) name = fromSlug;
    }
    if (!name) return null;
    const headline = companyHeadlineFrom(surface, name);
    const items = companyInfoItems(surface.closest("main") ?? doc.body);
    const size = items.find((i) => /\bemployees\b/i.test(i)) ?? "";
    const rest = items.filter((i) => !/\b(employees|followers?)\b/i.test(i));
    const industry = rest[0] ?? "";
    const location = rest[1] ?? "";
    const photoUrl = profilePhotoFrom(surface, "company", name, profileUrl);
    const entity: LinkedInEntity = {
      kind: "company",
      name,
      headline,
      company: name,
      profileUrl,
      ...(photoUrl ? { photoUrl } : {}),
      ...(location ? { location: clean(location, MAX_LOCATION) } : {}),
      ...(about ? { about } : {}),
      ...(industry ? { industry: clean(industry, MAX_INDUSTRY) } : {}),
      ...(size ? { companySize: clean(size, MAX_SIZE) } : {}),
      ...(headline ? { tagline: headline } : {}),
      ...(profileText ? { profileText } : {}),
    };
    const companySummary = buildProfileSummary(entity);
    return companySummary ? { ...entity, summary: companySummary } : entity;
  }

  const detailsPage = detailsPageOf(url);
  const sectionName = /^(experience|education|skills|licenses.*|projects|volunteering|languages)$/i;
  const named = (candidates: string[]) =>
    candidates.map((c) => c.replace(/^(experience|education|skills)\s*[|\-\u2013\u00b7]\s*/i, "")).filter((c) => !sectionName.test(c.trim()));
  const name =
    resolveProfileName(named([...headingCandidates(main, false), title.name, ogTitleName(doc)]), profileUrl) ||
    (detailsPage ? nameFromProfileUrl(profileUrl) : "");
  if (!name) return null;
  const card = topCardOf(main);
  const headline = detailsPage ? "" : headlineFrom(card, name, title.rest);
  const companyButton = main
    .querySelector('[aria-label^="Current company"]')
    ?.getAttribute("aria-label")
    ?.match(/^Current company:\s*([^.]+)/i)?.[1];
  const roles = detailsPage && detailsPage !== "experience" ? [] : rolesFrom(main, detailsPage === "experience");
  const current = roles[0];
  const company = clean(
    companyButton || companyFromHeadline(headline) || current?.company || "",
    MAX_COMPANY
  );
  const location = detailsPage ? "" : locationFrom(card);
  const { degree, count } = connectionsFrom(card);
  const schools = detailsPage && detailsPage !== "education" ? [] : schoolsFrom(main, detailsPage === "education");
  const education = schools.map((row) => clean([row.school, [row.degree, row.field].filter(Boolean).join(", ")].filter(Boolean).join(", "), MAX_EDUCATION));
  const skills = detailsPage && detailsPage !== "skills" ? [] : skillsFrom(main, detailsPage === "skills");
  const publicView = isPublicLayout(doc);
  const pastRoles = roles.slice(1, 1 + MAX_PAST_ROLES).map(({ title, company }) => ({ title, company }));
  const experience = roles.slice(0, MAX_EXPERIENCE);

  const photoUrl = profilePhotoFrom(main, "person", name, profileUrl);
  const entity: LinkedInEntity = {
    kind: "person",
    name,
    headline,
    company,
    profileUrl,
    ...(photoUrl ? { photoUrl } : {}),
    ...(location ? { location } : {}),
    ...(about ? { about } : {}),
    ...(about && aboutTruncated ? { aboutTruncated: true } : {}),
    ...(current?.title ? { roleTitle: current.title } : {}),
    ...(pastRoles.length ? { pastRoles } : {}),
    ...(experience.length ? { experience } : {}),
    ...(education.length ? { education } : {}),
    ...(schools.length ? { schools } : {}),
    ...(skills.length ? { skills } : {}),
    ...(publicView ? { publicView: true } : {}),
    ...(detailsPage ? { detailsPage } : {}),
    ...(degree ? { connectionDegree: degree } : {}),
    ...(count !== undefined ? { connectionCount: count } : {}),
    ...(profileText ? { profileText } : {}),
  };
  const summary = buildProfileSummary(entity);
  return summary ? { ...entity, summary } : entity;
}

/** A stored summary may run a little past the built one, never further. */
const MAX_STORED_SUMMARY = 240;

/**
 * Validates the optional profile detail that arrives with CORTEX_INDEX before
 * it is stored. The payload comes from a page, so every field is type checked,
 * trimmed and capped here, and anything unknown or malformed is dropped.
 *
 * It also guards the name: a page that hands over LinkedIn chrome ("(1)
 * Notifications") gets the name the profile slug carries instead, and the
 * field is left off when nothing plausible can be had, so the caller stores
 * nothing rather than junk.
 */
export function sanitizePersonDetail(raw: unknown): Partial<LinkedInEntity> {
  const o = (raw ?? {}) as Record<string, unknown>;
  const text = (v: unknown, max: number): string | undefined => {
    if (typeof v !== "string") return undefined;
    const t = v.replace(/\s+/g, " ").trim().slice(0, max);
    return t || undefined;
  };
  const out: Partial<LinkedInEntity> = {};

  const profileUrl = typeof o.profileUrl === "string" ? o.profileUrl : "";
  const name = resolveProfileName([typeof o.name === "string" ? o.name : ""], profileUrl);
  if (name) out.name = name;

  const location = text(o.location, 160);
  if (location) out.location = location;
  const about = text(o.about, MAX_ABOUT);
  if (about) out.about = about;
  if (about && o.aboutTruncated === true) out.aboutTruncated = true;
  if (o.publicView === true) out.publicView = true;
  if (o.detailsPage === "experience" || o.detailsPage === "education" || o.detailsPage === "skills") out.detailsPage = o.detailsPage;
  const roleTitle = text(o.roleTitle, 160);
  if (roleTitle) out.roleTitle = roleTitle;

  if (Array.isArray(o.pastRoles)) {
    const roles: LinkedInRole[] = [];
    for (const r of o.pastRoles) {
      if (roles.length >= 5) break;
      const row = r as Record<string, unknown> | null;
      const title = text(row?.title, 160);
      const company = text(row?.company, 120);
      if (title || company) roles.push({ title: title ?? "", company: company ?? "" });
    }
    if (roles.length) out.pastRoles = roles;
  }

  if (Array.isArray(o.experience)) {
    const roles: LinkedInRole[] = [];
    for (const r of o.experience) {
      if (roles.length >= MAX_EXPERIENCE) break;
      const row = r as Record<string, unknown> | null;
      const title = text(row?.title, 160);
      const company = text(row?.company, 120);
      const dates = text(row?.dates, 80);
      const location = text(row?.location, MAX_LOCATION);
      const description = text(row?.description, MAX_DESCRIPTION + 3);
      if (title || company) {
        roles.push({
          title: title ?? "",
          company: company ?? "",
          ...(dates ? { dates } : {}),
          ...(location ? { location } : {}),
          ...(description ? { description } : {}),
        });
      }
    }
    if (roles.length) out.experience = roles;
  }

  if (Array.isArray(o.education)) {
    const schools = o.education.map((e) => text(e, 200)).filter((e): e is string => !!e).slice(0, MAX_EDUCATION_ITEMS);
    if (schools.length) out.education = schools;
  }

  if (Array.isArray(o.schools)) {
    const rows: LinkedInSchool[] = [];
    for (const r of o.schools) {
      if (rows.length >= MAX_EDUCATION_ITEMS) break;
      const row = r as Record<string, unknown> | null;
      const school = text(row?.school, MAX_EDUCATION);
      if (!school) continue;
      rows.push({ school, degree: text(row?.degree, MAX_EDUCATION) ?? "", field: text(row?.field, MAX_EDUCATION) ?? "", years: text(row?.years, 40) ?? "" });
    }
    if (rows.length) out.schools = rows;
  }

  if (Array.isArray(o.skills)) {
    const skills = o.skills.map((e) => text(e, 80)).filter((e): e is string => !!e).slice(0, MAX_SKILLS);
    if (skills.length) out.skills = skills;
  }

  const degree = text(o.connectionDegree, 8);
  if (degree && /^(1st|2nd|3rd)$/.test(degree)) out.connectionDegree = degree;
  const count = o.connectionCount;
  if (typeof count === "number" && Number.isFinite(count) && count >= 0) {
    out.connectionCount = Math.min(Math.floor(count), 1_000_000);
  }

  const industry = text(o.industry, 120);
  if (industry) out.industry = industry;
  const companySize = text(o.companySize, 80);
  if (companySize) out.companySize = companySize;
  const tagline = text(o.tagline, 220);
  if (tagline) out.tagline = tagline;
  const photoUrl = profilePhotoUrl(typeof o.photoUrl === "string" ? o.photoUrl : "");
  if (photoUrl) out.photoUrl = photoUrl;

  // The summary the capture built, capped. Nothing is invented here: a
  // payload without one is left without one, so a restored backup comes back
  // exactly as it was exported, and upsertPerson builds the summary instead.
  const summary = text(o.summary, MAX_STORED_SUMMARY);
  if (summary) out.summary = summary;
  const profileText = text(o.profileText, 4000);
  if (profileText) out.profileText = profileText;

  return out;
}
