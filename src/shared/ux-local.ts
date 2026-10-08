/**
 * First-run coach marks and delayed product feedback.
 * Local chrome.storage.local only. No telemetry backend.
 */

import { storageLocalGet, storageLocalSet } from "./storage-local";

export const UX_LOCAL_KEY = "cortex_ux_local_v1";

export const COACH_TIP_IDS = [
  "search",
  "ask",
  "digest",
  "people",
  "agents",
  "assistSync",
] as const;

export type CoachTipId = (typeof COACH_TIP_IDS)[number];

/** Bump when the walkthrough changes, so an old Got it does not skip the new tour. */
export const TOUR_VERSION = 2;

export interface UxLocalState {
  firstSeenAt: number;
  panelOpenCount: number;
  coachDismissed: Partial<Record<CoachTipId, true>>;
  /** Tour revision the user finished or skipped. Older tips do not count. */
  tourSeen?: number;
  /** When the feedback card was last shown (ms). */
  feedbackShownAt?: number;
  /** User dismissed without submitting. */
  feedbackDismissedAt?: number;
  /** User submitted thumbs / note (or opened external link). */
  feedbackSubmittedAt?: number;
  /** Last local note (optional). Never sent automatically. */
  feedbackNote?: string;
  feedbackThumb?: "up" | "down";
}

export const FEEDBACK_MIN_DAYS = 10;
/** Quiet period after dismiss or a store visit (90 days). */
export const FEEDBACK_COOLDOWN_MS = 90 * 24 * 60 * 60 * 1000;

/** Written once on install. Review timing uses this, then first panel open. */
export const INSTALLED_AT_KEY = "cortex_installed_at";

/** Chrome Web Store listing. The id is stable; the slug can change. */
export const CHROME_WEB_STORE_LISTING =
  "https://chromewebstore.google.com/detail/happibddmmagkgneicjkndapcpmhdbfn";

const EMPTY: UxLocalState = {
  firstSeenAt: 0,
  panelOpenCount: 0,
  coachDismissed: {},
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseUxLocalState(raw: unknown): UxLocalState {
  if (!isRecord(raw)) return { ...EMPTY, coachDismissed: {} };
  const coachDismissed: Partial<Record<CoachTipId, true>> = {};
  if (isRecord(raw.coachDismissed)) {
    for (const id of COACH_TIP_IDS) {
      if (raw.coachDismissed[id] === true) coachDismissed[id] = true;
    }
  }
  const state: UxLocalState = {
    firstSeenAt: typeof raw.firstSeenAt === "number" ? raw.firstSeenAt : 0,
    panelOpenCount: typeof raw.panelOpenCount === "number" ? raw.panelOpenCount : 0,
    coachDismissed,
  };
  if (typeof raw.tourSeen === "number") state.tourSeen = raw.tourSeen;
  if (typeof raw.feedbackShownAt === "number") state.feedbackShownAt = raw.feedbackShownAt;
  if (typeof raw.feedbackDismissedAt === "number") {
    state.feedbackDismissedAt = raw.feedbackDismissedAt;
  }
  if (typeof raw.feedbackSubmittedAt === "number") {
    state.feedbackSubmittedAt = raw.feedbackSubmittedAt;
  }
  if (typeof raw.feedbackNote === "string") state.feedbackNote = raw.feedbackNote.slice(0, 2000);
  if (raw.feedbackThumb === "up" || raw.feedbackThumb === "down") {
    state.feedbackThumb = raw.feedbackThumb;
  }
  return state;
}

export async function loadUxLocalState(): Promise<UxLocalState> {
  const bag = await storageLocalGet(UX_LOCAL_KEY);
  return parseUxLocalState(bag[UX_LOCAL_KEY]);
}

export async function saveUxLocalState(state: UxLocalState): Promise<void> {
  await storageLocalSet({ [UX_LOCAL_KEY]: state });
}

/** Record a panel open. Sets firstSeenAt on first call. */
export async function recordPanelOpen(now = Date.now()): Promise<UxLocalState> {
  const state = await loadUxLocalState();
  if (!state.firstSeenAt) state.firstSeenAt = now;
  state.panelOpenCount = Math.max(0, state.panelOpenCount) + 1;
  await saveUxLocalState(state);
  return state;
}

export async function dismissCoachTip(id: CoachTipId): Promise<UxLocalState> {
  return dismissCoachTips([id]);
}

/** Marks every listed tip seen, so a skipped tour does not return. */
export async function dismissCoachTips(ids: readonly CoachTipId[]): Promise<UxLocalState> {
  const state = await loadUxLocalState();
  const coachDismissed = { ...state.coachDismissed };
  for (const id of ids) coachDismissed[id] = true;
  state.coachDismissed = coachDismissed;
  state.tourSeen = TOUR_VERSION;
  await saveUxLocalState(state);
  return state;
}

export function nextCoachTip(
  state: UxLocalState,
  available: readonly CoachTipId[]
): CoachTipId | null {
  for (const id of available) {
    if (!state.coachDismissed[id]) return id;
  }
  return null;
}

export interface FeedbackGateInput {
  state: UxLocalState;
  /** Install time when known. Falls back to the first time the panel opened. */
  installedAt?: number;
  now?: number;
}

/** Show a store-review prompt only after 10 days, and not during the quiet period. */
export function shouldShowFeedback(input: FeedbackGateInput): boolean {
  const now = input.now ?? Date.now();
  const { state } = input;
  const quietAt = Math.max(state.feedbackDismissedAt ?? 0, state.feedbackSubmittedAt ?? 0);
  if (quietAt > 0 && now - quietAt < FEEDBACK_COOLDOWN_MS) return false;

  const start = input.installedAt || state.firstSeenAt;
  if (!start) return false;
  return now - start >= FEEDBACK_MIN_DAYS * 24 * 60 * 60 * 1000;
}

export async function markFeedbackShown(now = Date.now()): Promise<UxLocalState> {
  const state = await loadUxLocalState();
  state.feedbackShownAt = now;
  await saveUxLocalState(state);
  return state;
}

export async function dismissFeedback(now = Date.now()): Promise<UxLocalState> {
  const state = await loadUxLocalState();
  state.feedbackDismissedAt = now;
  await saveUxLocalState(state);
  return state;
}

export async function submitFeedbackLocal(input: {
  thumb: "up" | "down";
  note?: string;
  now?: number;
}): Promise<UxLocalState> {
  const now = input.now ?? Date.now();
  const state = await loadUxLocalState();
  state.feedbackSubmittedAt = now;
  state.feedbackThumb = input.thumb;
  if (input.note != null) state.feedbackNote = input.note.slice(0, 2000);
  await saveUxLocalState(state);
  return state;
}

export const COACH_COPY: Record<CoachTipId, { title: string; body: string }> = {
  search: {
    title: "Search",
    body: "Find a page you already read by phrase, site, or topic. Nothing leaves this device.",
  },
  ask: {
    title: "Ask",
    body: "Ask in plain language. Answers stay on this device and cite the pages they came from.",
  },
  digest: {
    title: "Digest",
    body: "A short recap of what you read today, yesterday, or over the last 7 days.",
  },
  people: {
    title: "People and companies",
    body: "Profiles and company pages you open are saved here, with the role and photo from the page.",
  },
  agents: {
    title: "Connect AI agents",
    body: "Copy a prompt for Claude, ChatGPT, Gemini, or Cursor so it can read your Cortex Memory sheet.",
  },
  assistSync: {
    title: "Assistant Sync",
    body: "The gear opens Settings. Assistant Sync is where the live sheet is turned on.",
  },
};
