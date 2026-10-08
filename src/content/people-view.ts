/**
 * People tab in the overlay (Phase 5.1). DOM APIs only: names and headlines
 * come from LinkedIn pages and are rendered with textContent.
 */
import { mascotHtml } from "./mascot";
export interface PersonRow {
  id: number;
  kind: "person" | "company";
  name: string;
  headline: string;
  company: string;
  profileUrl: string;
  lastSeen: number;
  visitCount: number;
  /**
   * A plain sentence or two saying what Cortex read from the profile. Left
   * off for rows captured before summaries existed.
   */
  summary?: string;
  /** Detail captured from the profile, when the page showed it. */
  location?: string;
  roleTitle?: string;
  pastRoles?: { title: string; company: string }[];
  education?: string[];
  connectionDegree?: string;
  connectionCount?: number;
  industry?: string;
  companySize?: string;
  tagline?: string;
  /** A photo is saved on this device for this profile and photos are on. */
  hasPhoto?: boolean;
}

function norm(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** LinkedIn page chrome that gets scraped into a headline or summary. */
function isLinkedInChromeDump(text: string): boolean {
  const t = text.toLowerCase();
  if (/\b(?:contact info|enhance profile|add section)\b/.test(t)) return true;
  return /\b(?:1st|2nd|3rd)\b/.test(t) && /\b(?:followers?|connections?|contact)\b/.test(t);
}

/**
 * Drops the person's name, degree chips, and LinkedIn buttons from a scraped
 * string, leaving the role and place separated by middle dots.
 */
function scrubProfileNoise(text: string, name: string): string {
  let t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const person = String(name ?? "").replace(/\s+/g, " ").trim();
  if (person.length >= 2) {
    t = t.replace(new RegExp(`\\b${escapeRe(person).replace(/\\\./g, "\\.?")}`, "gi"), " ");
    for (const part of person.split(/\s+/)) {
      const word = part.replace(/[^A-Za-z]/g, "");
      if (word.length >= 3) t = t.replace(new RegExp(`\\b${escapeRe(word)}\\b`, "gi"), " ");
    }
  }
  t = t
    .replace(/\b(?:1st|2nd|3rd)\b/gi, " ")
    .replace(/\b(?:contact info|enhance profile|add section|open to|more pending message|pending message)\b/gi, " ")
    .replace(/\b\d{1,3}(?:,\d{3})+\s+followers?\b/gi, " ")
    .replace(/\b\d+\+\s+connections?\b/gi, " ")
    .replace(/\bfollowers?\b/gi, " ")
    .replace(/\bconnections?\b/gi, " ")
    .replace(/\s*[|]\s*/g, " · ")
    .replace(/\s*·\s*/g, " · ")
    .replace(/\s+/g, " ")
    .replace(/(?:\s*·\s*){2,}/g, " · ")
    .replace(/^\s*·\s*|\s*·\s*$/g, "")
    .trim();
  return t;
}

/** First useful clause of a scraped profile, as a single role line. */
function titleFromNoise(text: string, name: string): string {
  const scrubbed = scrubProfileNoise(text, name);
  if (!scrubbed) return "";
  const first = scrubbed.split(/\s*·\s*|\.\s+/)[0]?.trim() ?? "";
  const normalized = first.replace(/\s+@\s+/g, " at ").replace(/[.\s]+$/, "").trim();
  if (normalized.length < 2) return "";
  if (normalized.length > 88) return `${normalized.slice(0, 85).trimEnd()}...`;
  return normalized;
}

const PLACE_WORD = /^(?:Area|Metro|Metroplex|Region)$/i;

/** "Dallas-Fort Worth Metroplex" from the tail of a scraped line. */
function placeTail(text: string): string {
  const words = text.replace(/\s+/g, " ").trim().split(/\s+/);
  const idx = words.findIndex((w) => PLACE_WORD.test(w.replace(/[.,]+$/, "")));
  if (idx <= 0) return "";
  const kept: string[] = [];
  for (let i = idx - 1; i >= 0 && kept.length < 4; i--) {
    const w = words[i]!;
    if (/^(?:at|@|and|of|the|in)$/i.test(w)) break;
    if (!/^[A-Z0-9]/.test(w)) break;
    kept.unshift(w);
  }
  if (!kept.length) return "";
  return `${kept.join(" ")} ${words[idx]!.replace(/[.,]+$/, "")}`;
}

/**
 * The summary to show under the name, or "" when there is none, when it only
 * repeats the headline, or when it is LinkedIn page chrome.
 */
export function personSummaryLine(p: PersonRow): string {
  const summary = String(p.summary ?? "").replace(/\s+/g, " ").trim();
  if (!summary) return "";
  if (isLinkedInChromeDump(summary)) return "";
  // Punctuation aside, LinkedIn's headline and the first line of the profile
  // text are the same sentence, and the card already shows the headline.
  return norm(summary) === norm(p.headline) ? "" : summary;
}

/**
 * The one line under the name: a role, not the whole LinkedIn headline.
 * Headlines often arrive as "CEO · 2nd · Miami · Contact info ...".
 */
export function personCardTitle(p: PersonRow): string {
  const name = String(p.name ?? "").trim();
  const role = String(p.roleTitle ?? "").trim();
  const company = String(p.company ?? "").trim();
  if (role) {
    if (company && !role.toLowerCase().includes(company.toLowerCase())) {
      return `${role} at ${company}`;
    }
    return role;
  }
  const head = String(p.headline ?? "").replace(/\s+/g, " ").trim();
  if (head && !isLinkedInChromeDump(head)) {
    let lead = head;
    if (name && lead.toLowerCase().startsWith(name.toLowerCase())) {
      lead = lead.slice(name.length).replace(/^[\s|·,:.-]+/, "").trim();
    }
    const first = lead.split(/\s*[|·]\s*/)[0]?.trim() ?? "";
    if (first) {
      if (first.length > 88) return `${first.slice(0, 85).trimEnd()}...`;
      return first;
    }
  }
  return titleFromNoise(`${head} ${p.summary ?? ""}`, name);
}

/**
 * A place to show under the title. Uses the captured location, or the place
 * tail of a scraped headline ("Miami-Fort Lauderdale Area").
 */
export function personCardPlace(p: PersonRow): string {
  const explicit = String(p.location ?? "").replace(/\s+/g, " ").trim();
  if (explicit) return explicit.length > 48 ? `${explicit.slice(0, 45).trimEnd()}...` : explicit;
  const title = personCardTitle(p).toLowerCase();
  const blob = scrubProfileNoise(`${p.headline ?? ""} · ${p.summary ?? ""}`, p.name);
  const parts = blob.split(/\s*·\s*|\.\s+/).map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    if (title && part.toLowerCase() === title) continue;
    let rest = part;
    if (title && rest.toLowerCase().startsWith(title)) {
      rest = rest.slice(title.length).replace(/^[\s,·|@-]+/, "").trim();
    }
    const found = placeTail(rest) || placeTail(part);
    if (found && (!title || !title.includes(found.toLowerCase()))) return found;
  }
  return "";
}

/**
 * The full headline for the card. Pipe-separated LinkedIn headlines stay
 * whole. Page chrome (degree chips, Contact info, buttons) is removed, and
 * a clause that only repeats an earlier one is kept once, at its longest.
 */
/** Card label. A long surname keeps its start and an ellipsis, so one letter is not left on its own line. */
export function personCardName(name: string): string {
  const clean = name.replace(/\s+,/g, ",").replace(/\s+/g, " ").trim();
  const parts = clean.split(" ").filter(Boolean);
  if (parts.length <= 1) return clean.length > 22 ? `${clean.slice(0, 21)}…` : clean;
  const first = parts[0]!;
  const rest = parts.slice(1).join(" ");
  if (rest.length <= 16 && `${first} ${rest}`.length <= 32) return `${first} ${rest}`;
  return `${first} ${rest.slice(0, 15)}…`;
}

function chromeStat(line: string): boolean {
  return (
    /^(show all|see all|show more|see more|follow|following|message|connect|more)$/i.test(line) ||
    /^\d+([.,]\d+)?%?$/.test(line)
  );
}

export function personHeadlineLine(p: PersonRow): string {
  if (p.kind === "company") {
    const line = String(p.tagline || p.headline || "").replace(/\s+/g, " ").trim();
    if (line && !isLinkedInChromeDump(line) && !chromeStat(line) && !/^(of|at|in)\b/i.test(line)) return line;
    return "";
  }
  const headline = String(p.headline ?? "").replace(/\s+/g, " ").trim();
  const summary = String(p.summary ?? "").replace(/\s+/g, " ").trim();
  const headlineOk = !!headline && !isLinkedInChromeDump(headline);
  const summaryOk = !!summary && !isLinkedInChromeDump(summary);
  let source = "";
  if (headlineOk && summaryOk && norm(summary).includes(norm(headline)) && summary.length > headline.length + 8) {
    source = summary;
  } else if (headlineOk) source = headline;
  else if (summaryOk) source = summary;
  else source = `${headline} ${summary}`.trim();
  const tidy = scrubProfileNoise(source, p.name).replace(
    /,\s*based in\s+([^,.]+)/gi,
    (all, place: string, offset: number, whole: string) =>
      whole.slice(0, offset).toLowerCase().includes(String(place).trim().toLowerCase()) ? "" : all
  );
  const parts = tidy.split(/\s*·\s*|\.\s+/).map((s) => s.trim()).filter(Boolean);
  const kept: string[] = [];
  for (const part of parts) {
    const key = norm(part);
    if (!key) continue;
    const idx = kept.findIndex((prev) => {
      const pk = norm(prev);
      return pk === key || pk.includes(key) || key.includes(pk);
    });
    if (idx >= 0) {
      if (part.length > kept[idx]!.length) kept[idx] = part;
      continue;
    }
    kept.push(part);
  }
  return kept.join(" · ");
}

/**
 * Unsharp mask with a threshold. Real edges differ from their blurred copy by
 * more than `threshold`; JPEG noise in skin and backdrops does not, so it stays
 * smooth. Values clamp in the array. Alpha is left alone.
 */
export function unsharpMask(data: Uint8ClampedArray, blurred: Uint8ClampedArray, amount: number, threshold: number): void {
  for (let i = 0; i < data.length; i += 4) {
    for (let c = i; c < i + 3; c++) {
      const diff = data[c]! - blurred[c]!;
      if (diff > threshold || diff < -threshold) data[c] = data[c]! + diff * amount;
    }
  }
}

/** The copy saved on this device when the profile was open. Never a request to LinkedIn. */
function savedPhoto(profileUrl: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    const runtime = typeof chrome !== "undefined" ? chrome.runtime : undefined;
    if (!runtime?.sendMessage) {
      resolve(null);
      return;
    }
    runtime.sendMessage({ type: "CORTEX_PHOTO_GET", profileUrl }, (res: { ok?: boolean; mime?: string; b64?: unknown } | undefined) => {
      if (runtime.lastError || !res?.ok || typeof res.b64 !== "string" || res.b64.length < 32) {
        resolve(null);
        return;
      }
      try {
        const bin = atob(res.b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        const mime = res.mime && res.mime.startsWith("image/") ? res.mime : "image/jpeg";
        resolve(new Blob([bytes], { type: mime }));
      } catch {
        resolve(null);
      }
    });
  });
}

/** The photo's bytes, enlarged and sharpened on this device when the canvas allows it. */
export async function clearPhoto(profileUrl: string, logo: boolean): Promise<Blob | null> {
  const blob = await savedPhoto(profileUrl);
  if (!blob) return null;
  return (await sharpenBlob(blob, logo)) ?? blob;
}

function blobAsDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

async function sharpenBlob(blob: Blob, logo: boolean): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const longest = Math.max(bitmap.width, bitmap.height);
    // Sharpen at the card's pixel size. A later browser downscale would hide the mask.
    const scale = logo ? 1 : Math.min(4, 720 / longest);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, w, h);
    const frame = ctx.getImageData(0, 0, w, h);
    const soft = document.createElement("canvas");
    soft.width = w;
    soft.height = h;
    const sctx = soft.getContext("2d", { willReadFrequently: true });
    if (!sctx) {
      bitmap.close();
      return null;
    }
    // Blur radius follows the enlargement, so the mask lands on the edges the upscale softened.
    sctx.filter = `blur(${Math.max(1, Math.min(4, scale * 1.1)).toFixed(2)}px)`;
    sctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blurred = sctx.getImageData(0, 0, w, h).data;
    unsharpMask(frame.data, blurred, logo ? 0.35 : longest < 420 ? 1.5 : 0.8, logo ? 10 : 4);
    ctx.putImageData(frame, 0, 0);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  } catch {
    return null;
  }
}

/** Two letters for the card mark. One letter when the name is a single word. */
export function personInitials(name: string): string {
  const words = String(name ?? "")
    .replace(/<[^>]*>/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z]/g, ""))
    .filter((w) => w.length > 0);
  if (!words.length) return "";
  const first = words[0]![0]!.toUpperCase();
  const last = words.length > 1 ? words[words.length - 1]![0]!.toUpperCase() : "";
  return last && last !== first ? first + last : first;
}

/** One plain line of captured detail, or "" when the profile had none. */
export function personDetailLine(p: PersonRow): string {
  const parts: string[] = [];
  if (p.location) parts.push(p.location);
  if (p.roleTitle) parts.push(p.company ? `${p.roleTitle} at ${p.company}` : p.roleTitle);
  const past = p.pastRoles?.[0];
  if (past) parts.push(`previously ${[past.title, past.company].filter(Boolean).join(" at ")}`);
  if (p.education?.[0]) parts.push(p.education[0]);
  if (p.industry) parts.push(p.industry);
  if (p.companySize) parts.push(p.companySize);
  const connection = [p.connectionDegree, p.connectionCount ? `${p.connectionCount} connections` : ""]
    .filter(Boolean)
    .join(", ");
  if (connection) parts.push(connection);
  return parts.join(" · ");
}

export interface PeopleViewDeps {
  list: (q: string) => Promise<PersonRow[]>;
  remove: (id: number) => Promise<boolean>;
  announce: (text: string) => void;
}

function httpUrl(u: string): string | null {
  try {
    const x = new URL(u);
    return x.protocol === "https:" || x.protocol === "http:" ? x.href : null;
  } catch {
    return null;
  }
}

export async function renderPeopleView(container: HTMLElement, deps: PeopleViewDeps): Promise<() => void> {
  container.replaceChildren();
  const wrap = document.createElement("div");
  wrap.className = "cortex-people";

  const input = document.createElement("input");
  input.type = "search";
  input.className = "cortex-input cortex-people-filter";
  input.placeholder = "Filter by name, role, company, place or what they do";
  input.setAttribute("aria-label", "Filter people");
  input.autocomplete = "off";

  const list = document.createElement("ul");
  list.className = "cortex-people-list";
  list.setAttribute("aria-label", "People you viewed");

  wrap.append(input, list);
  container.appendChild(wrap);

  const cleared: string[] = [];
  let drawGen = 0;
  const dropCleared = (): void => {
    for (const u of cleared) URL.revokeObjectURL(u);
    cleared.length = 0;
  };
  const draw = (rows: PersonRow[]): void => {
    drawGen += 1;
    const generation = drawGen;
    dropCleared();
    list.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement("li");
      empty.className = "cortex-people-empty cortex-muted";
      if (input.value.trim()) {
        empty.textContent = "Nobody matches that filter.";
      } else {
        empty.insertAdjacentHTML("beforeend", mascotHtml("sleepy", 96));
        const note = document.createElement("p");
        note.textContent = "People memory saves profiles and company pages you open on LinkedIn.";
        const setting = document.createElement("button");
        setting.type = "button";
        setting.className = "cx-m-action";
        setting.setAttribute("data-cortex-open-options", "");
        setting.setAttribute("data-options-section", "cx-sec-capture");
        setting.textContent = "People memory setting";
        empty.append(note, setting);
      }
      list.appendChild(empty);
      return;
    }
    for (const p of rows) {
      const li = document.createElement("li");
      li.className = input.value.trim() ? "cortex-person is-match" : "cortex-person";
      const fullName = p.name.replace(/\s+,/g, ",").replace(/\s+/g, " ").trim();
      const displayName = personCardName(fullName);
      const href = httpUrl(p.profileUrl);

      const scene = document.createElement("div");
      scene.className = "cortex-person-scene";
      const flip = document.createElement("div");
      flip.className = "cortex-person-flip";

      const front = document.createElement("div");
      front.className = "cortex-person-face cortex-person-front";
      const turn = document.createElement("button");
      turn.type = "button";
      turn.className = "cortex-person-turn";
      turn.setAttribute("aria-expanded", "false");
      turn.setAttribute("aria-label", `Show details for ${fullName}`);

      const mark = document.createElement("span");
      mark.className = "cortex-person-mark";
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = personInitials(displayName);
      if (p.hasPhoto) {
        const img = document.createElement("img");
        img.className = p.kind === "company" ? "cortex-person-photo is-logo" : "cortex-person-photo";
        img.alt = "";
        // blob first, then data: for pages whose policy blocks blob: images.
        let stage: "blob" | "data" | "done" = "blob";
        let copy: Blob | null = null;
        const live = (): boolean => generation === drawGen;
        const drop = (): void => {
          stage = "done";
          img.remove();
          front.classList.remove("has-photo");
        };
        img.addEventListener("error", () => {
          if (stage === "blob" && copy) {
            stage = "data";
            void blobAsDataUrl(copy).then((url) => {
              if (!live()) return;
              if (url) img.src = url;
              else drop();
            });
            return;
          }
          drop();
        });
        void clearPhoto(p.profileUrl, p.kind === "company").then((blob) => {
          if (!live() || !img.isConnected) return;
          if (!blob) {
            drop();
            return;
          }
          copy = blob;
          const url = URL.createObjectURL(blob);
          cleared.push(url);
          img.src = url;
        });
        front.classList.add("has-photo");
        front.appendChild(img);
      }
      front.appendChild(mark);

      const name = document.createElement(href ? "a" : "span") as HTMLAnchorElement | HTMLSpanElement;
      name.className = "cortex-person-name";
      name.textContent = displayName;
      name.title = fullName;
      if (href && name instanceof HTMLAnchorElement) {
        name.href = href;
        name.target = "_blank";
        name.rel = "noopener noreferrer";
        name.addEventListener("click", (e) => e.stopPropagation());
      }
      front.append(turn, name);

      const back = document.createElement("div");
      back.className = "cortex-person-face cortex-person-back";
      back.setAttribute("aria-hidden", "true");
      const backName = document.createElement("p");
      backName.className = "cortex-person-back-name";
      backName.textContent = displayName;
      backName.title = fullName;
      const headline = document.createElement("button");
      headline.type = "button";
      headline.className = "cortex-person-headline";
      headline.tabIndex = -1;
      headline.setAttribute("aria-label", `Show photo for ${fullName}`);
      headline.textContent = personHeadlineLine(p) || "No headline saved for this profile.";
      const meta = document.createElement("div");
      meta.className = "cortex-person-meta";
      const when = new Date(p.lastSeen).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      const viewed = document.createElement("span");
      viewed.className = "cortex-person-viewed";
      viewed.textContent = p.kind === "company" ? `Company · Last viewed ${when}` : `Last viewed ${when}`;
      const visits = document.createElement("span");
      visits.className = "cortex-person-visits";
      visits.textContent = p.visitCount === 1 ? "1 visit" : `${p.visitCount} visits`;
      meta.append(viewed, visits);

      const backActions = document.createElement("div");
      backActions.className = "cortex-person-back-actions";
      let profile: HTMLAnchorElement | null = null;
      if (href) {
        profile = document.createElement("a");
        profile.className = "cortex-person-profile";
        profile.href = href;
        profile.target = "_blank";
        profile.rel = "noopener noreferrer";
        profile.tabIndex = -1;
        profile.textContent = "Profile";
        profile.addEventListener("click", (e) => e.stopPropagation());
      }
      const del = document.createElement("button");
      del.type = "button";
      del.className = "cortex-person-delete";
      del.tabIndex = -1;
      del.setAttribute("aria-label", `Delete ${p.name}`);
      del.title = "Delete";
      del.textContent = "Delete";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        void deps.remove(p.id).then((ok) => {
          if (!ok) return;
          li.remove();
          deps.announce(`Deleted ${displayName}.`);
          if (!list.querySelector(".cortex-person")) draw([]);
        });
      });
      if (profile) backActions.appendChild(profile);
      backActions.appendChild(del);
      back.append(backName, headline, meta, backActions);

      const setFlipped = (on: boolean): void => {
        li.classList.toggle("is-flipped", on);
        turn.setAttribute("aria-expanded", on ? "true" : "false");
        front.setAttribute("aria-hidden", on ? "true" : "false");
        back.setAttribute("aria-hidden", on ? "false" : "true");
        turn.tabIndex = on ? -1 : 0;
        headline.tabIndex = on ? 0 : -1;
        if (profile) profile.tabIndex = on ? 0 : -1;
        del.tabIndex = on ? 0 : -1;
        if (name instanceof HTMLAnchorElement) name.tabIndex = on ? -1 : 0;
      };
      scene.addEventListener("click", (e) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest("a, .cortex-person-delete")) return;
        const on = !li.classList.contains("is-flipped");
        setFlipped(on);
        if (on) {
          deps.announce(`Details for ${displayName}.`);
          headline.focus();
        } else {
          turn.focus();
        }
      });

      flip.append(front, back);
      scene.appendChild(flip);
      li.appendChild(scene);
      list.appendChild(li);
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  let alive = true;
  const load = (): void => {
    const q = input.value.trim();
    void deps.list(q).then((rows) => {
      if (alive) draw(rows);
    });
  };
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(load, 120);
  });

  const onStore = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (area === "session" && changes.cortexPeopleTick) load();
  };
  const storage = typeof chrome !== "undefined" ? chrome.storage?.onChanged : undefined;
  storage?.addListener(onStore);

  draw(await deps.list(""));
  return () => {
    alive = false;
    drawGen += 1;
    dropCleared();
    clearTimeout(timer);
    storage?.removeListener(onStore);
  };
}
