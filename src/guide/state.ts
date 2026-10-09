import type { AssistantId } from "../config/assistants";

/** chrome.storage.session key: the open guides by tab id. */
export const GUIDE_KEY = "cortex_guide";
export const GUIDE_PANEL_PATH = "guide-panel.html";
export const POINTER_SCRIPT = "guide-pointer.js";
export const POINT_MESSAGE = "CORTEX_GUIDE_POINT";
export const HIDE_MESSAGE = "CORTEX_GUIDE_POINT_HIDE";
/** Sent by the pointer when it reads that the current step is done. */
export const DONE_MESSAGE = "CORTEX_GUIDE_DONE";

export interface GuideState {
  assistant: AssistantId;
  /** The tab the guide walks through. The side panel is set for this tab only. */
  tabId: number;
  /** Done step ids, always a prefix of the steps: they complete strictly in order. */
  done: string[];
  result: "yes" | "no" | null;
  /** A done step the user went back to. Later steps stay done. */
  reopened?: string | null;
}

export function newGuideState(assistant: AssistantId, tabId: number): GuideState {
  return { assistant, tabId, done: [], result: null };
}

/** Keyed "tab:<id>": integer-like keys would sort by number and lose the newest-first order. */
export type GuideMap = Record<string, GuideState>;

export const guideKeyFor = (tabId: number) => `tab:${tabId}`;

/** Adds or replaces one tab's guide, keeping the newest few. */
export function withGuide(map: GuideMap | undefined, next: GuideState, keep = 5): GuideMap {
  const key = guideKeyFor(next.tabId);
  const rest = Object.entries(map ?? {}).filter(([id]) => id !== key);
  return Object.fromEntries([...rest.slice(-(keep - 1)), [key, next]]);
}

export async function saveGuide(next: GuideState): Promise<void> {
  const got = await chrome.storage.session.get(GUIDE_KEY);
  await chrome.storage.session.set({ [GUIDE_KEY]: withGuide(got[GUIDE_KEY] as GuideMap | undefined, next) });
}

export async function loadGuide(tabId: number): Promise<GuideState | null> {
  const got = await chrome.storage.session.get(GUIDE_KEY);
  return (got[GUIDE_KEY] as GuideMap | undefined)?.[guideKeyFor(tabId)] ?? null;
}
