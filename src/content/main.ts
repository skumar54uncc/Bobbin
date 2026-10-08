import {
  isExtensionRuntimeAlive,
  isInvalidatedExtensionError,
  sendRuntimeMessage,
} from "../shared/extension-runtime";
import {
  getUserSettings,
  getUserSettingsFresh,
} from "../shared/extension-settings";
import { doubleShiftSwitch } from "./double-shift";
import { createDwellTracker, DWELL_TICK_MS, pageScrollPct, videoPlaying, type DwellTracker } from "./dwell";
import { shouldReindexAfterMutation } from "./mutation-throttle";
import { devLog } from "../lib/extension-logger";

declare global {
  interface Window {
    __cortexMainLoaded?: boolean;
    __cortexInstallKickListener?: boolean;
  }
}

function bootstrap(): void {
  // The overlay UI lives in overlay.js and is injected on demand by the service worker.

function normalizedUrl(): string {
  const u = new URL(location.href);
  u.hash = "";
  return u.href;
}

let indexTimer: number | undefined;
let mutationTimer: number | undefined;
/** When a mutation last caused a re-index request on this page. */
let lastMutationIndexAt: number | null = null;
let currentUrl = normalizedUrl();

function scheduleIndex(delayMs: number): void {
  window.clearTimeout(indexTimer);
  indexTimer = window.setTimeout(() => guardedIndexPage(), delayMs);
}

/** LinkedIn / heavy SPAs paint profile chrome after first paint: retry captures */
function scheduleCaptureRetries(): void {
  const linkedIn = /(^|\.)linkedin\.com$/i.test(location.hostname);
  const delays = linkedIn ? [1400, 4200] : [900, 2600, 5800, 12000];
  for (const d of delays) {
    window.setTimeout(() => guardedIndexPage(), d);
  }
}

/**
 * Asks the service worker to index this page. The worker runs the privacy
 * gate and, only if allowed, injects extract.js to do the actual extraction.
 */
async function indexPage(): Promise<void> {
  try {
    if (!isExtensionRuntimeAlive()) return;
    await sendRuntimeMessage({ type: "CORTEX_INDEX_REQUEST", url: normalizedUrl() });
  } catch (e) {
    if (isInvalidatedExtensionError(e)) return;
    if (!isExtensionRuntimeAlive()) return;
    devLog.warn("[Cortex] index request:", e);
  }
}

/** After extension reload, timers keep firing: bail before touching chrome.* */
function guardedIndexPage(): void {
  if (!isExtensionRuntimeAlive()) return;
  void indexPage().catch((e: unknown) => {
    if (isInvalidatedExtensionError(e)) return;
    if (!isExtensionRuntimeAlive()) return;
    devLog.warn("[Cortex] index:", e);
  });
}

// Dwell is measured wherever capture runs. The worker answers with the indexing gate
// (incognito, pause, block list, sensitive sites); pages with a password field never ask.
let dwell: DwellTracker | null = null;
let dwellTimer: number | undefined;
let dwellAsk = 0;

function hasPasswordField(): boolean {
  return document.querySelector('input[type="password" i]') != null;
}

/** Starts or stops the tracker for the current page. A newer call wins. */
async function refreshDwell(): Promise<void> {
  const ask = ++dwellAsk;
  if (!isExtensionRuntimeAlive()) return;
  const allowed =
    !hasPasswordField() &&
    (await sendRuntimeMessage({ type: "CORTEX_DWELL_ALLOWED", url: normalizedUrl() })
      .then((res) => (res as { ok?: boolean } | undefined)?.ok === true)
      .catch(() => false));
  if (ask !== dwellAsk) return;
  if (allowed) {
    startDwell();
    return;
  }
  dwell?.end();
  stopDwell();
}

function sendDwell(report: { url: string; activeMs: number; maxScrollPct: number; final: boolean }): void {
  if (!isExtensionRuntimeAlive()) return;
  void sendRuntimeMessage({ type: "CORTEX_DWELL", ...report }).catch(() => undefined);
}

function startDwell(): void {
  if (dwell) return;
  dwell = createDwellTracker(normalizedUrl(), {
    now: () => Date.now(),
    visible: () => document.visibilityState === "visible",
    focused: () => document.hasFocus(),
    playing: videoPlaying,
    scrollPct: pageScrollPct,
    send: sendDwell,
  });
  dwellTimer = window.setInterval(() => {
    if (!isExtensionRuntimeAlive()) return stopDwell();
    dwell?.tick();
  }, DWELL_TICK_MS);
}

function stopDwell(): void {
  window.clearInterval(dwellTimer);
  dwell = null;
}

const INTERACTION_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

function afterFirstInteraction(run: () => void): void {
  const once = () => {
    for (const event of INTERACTION_EVENTS) window.removeEventListener(event, once, true);
    run();
  };
  for (const event of INTERACTION_EVENTS) window.addEventListener(event, once, { passive: true, capture: true });
}

const markInput = () => dwell?.input();
for (const event of ["pointerdown", "pointermove", "keydown", "wheel", "scroll", "touchstart"]) {
  window.addEventListener(event, markInput, { passive: true, capture: true });
}
window.addEventListener("pagehide", () => dwell?.end());
// A page restored from the back/forward cache is not a visit until the user interacts with it.
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  stopDwell();
  afterFirstInteraction(() => {
    void refreshDwell();
    scheduleIndex(600);
  });
});

void refreshDwell();

function onLocationLikeChange(reason: "spa" | "mutation" | "title"): void {
  const next = normalizedUrl();
  if (next !== currentUrl) {
    currentUrl = next;
    // The old page gets its final report; the new page is measured only if the gate allows it.
    dwell?.end();
    stopDwell();
    void refreshDwell();
    scheduleIndex(reason === "spa" ? 900 : 1400);
    scheduleCaptureRetries();
    return;
  }

  if (reason === "mutation" || reason === "title") {
    // Pages that never settle (YouTube, feeds) would otherwise ask for a
    // re-index every few seconds and exhaust the per tab extraction budget.
    if (!shouldReindexAfterMutation(lastMutationIndexAt, Date.now())) return;
    lastMutationIndexAt = Date.now();
    scheduleIndex(3200);
  }
}

const _push = history.pushState;
history.pushState = function (
  ...args: Parameters<typeof history.pushState>
): ReturnType<typeof history.pushState> {
  const out = _push.apply(history, args);
  onLocationLikeChange("spa");
  return out;
};

const _replace = history.replaceState;
history.replaceState = function (
  ...args: Parameters<typeof history.replaceState>
): ReturnType<typeof history.replaceState> {
  const out = _replace.apply(history, args);
  onLocationLikeChange("spa");
  return out;
};
window.addEventListener("popstate", () => onLocationLikeChange("spa"));

// A content script runs in an isolated world: the wrappers above see only this script's
// own history calls, never the page's pushState or replaceState (LinkedIn, YouTube, X).
// Watch the address once a second instead, plus popstate and the title below.
window.setInterval(() => {
  if (!isExtensionRuntimeAlive()) return;
  if (normalizedUrl() === currentUrl) return;
  onLocationLikeChange("spa");
}, 1000);

// Throttle, not debounce: a page that never stops changing (feeds, players) still gets checked.
const mo = new MutationObserver(() => {
  if (mutationTimer !== undefined) return;
  mutationTimer = window.setTimeout(() => {
    mutationTimer = undefined;
    onLocationLikeChange("mutation");
  }, 950);
});
mo.observe(document.documentElement, { childList: true, subtree: true });

// SPAs often change the title before, or instead of, the address.
let lastTitle = document.title;
const titleWatch = new MutationObserver(() => {
  if (document.title === lastTitle) return;
  lastTitle = document.title;
  onLocationLikeChange("title");
});
titleWatch.observe(document.head ?? document.documentElement, { childList: true, subtree: true, characterData: true });

if (document.readyState === "complete") {
  scheduleIndex(1800);
  scheduleCaptureRetries();
} else {
  window.addEventListener(
    "load",
    () => {
      scheduleIndex(1800);
      scheduleCaptureRetries();
    },
    { once: true }
  );
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") scheduleIndex(600);
});

if (!window.__cortexInstallKickListener) {
  window.__cortexInstallKickListener = true;
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "CORTEX_PING") {
      sendResponse({ ok: true as const });
      return true;
    }
    if (msg?.type === "CORTEX_FORCE_INDEX_NOW") {
      scheduleIndex(120);
      scheduleCaptureRetries();
    }
    return undefined;
  });
}

/**
 * Double tap of Shift. This is the only keyboard way to open the panel.
 * The gesture is recognised here and asks the worker to open it, the same
 * request the popup's "Open search" button sends.
 */
function toggleCortexPanel(panelOpen: boolean): void {
  if (!isExtensionRuntimeAlive()) return;
  // Open, or close again on a second double tap. The service worker relays
  // the close to this tab, because content scripts cannot message each other.
  const type = panelOpen ? "CORTEX_CLOSE_SEARCH" : "CORTEX_POPUP_OPEN_SEARCH";
  void sendRuntimeMessage({ type }).catch((e: unknown) => {
    if (isInvalidatedExtensionError(e)) return;
    devLog.warn("[Cortex] double Shift:", e);
  });
}

const setDoubleShift = doubleShiftSwitch({ onTrigger: toggleCortexPanel });
// Storage key of CortexUserSettings (see shared/extension-settings.ts).
const USER_SETTINGS_KEY = "cortex_user_settings";

void getUserSettings()
  .then((s) => setDoubleShift(s.doubleShiftShortcutEnabled))
  .catch(() => {
    /* storage unavailable: leave the detector off */
  });

// Turning the setting off applies to open tabs, not only to the next load.
chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area !== "local") return;
  if (!changes[USER_SETTINGS_KEY]) return;
  // Pause, block list and allowlist changes apply to the page already open.
  void refreshDwell();
  void getUserSettingsFresh()
    .then((s) => setDoubleShift(s.doubleShiftShortcutEnabled))
    .catch(() => {
      /* ignore */
    });
});

}

if (!window.__cortexMainLoaded) {
  window.__cortexMainLoaded = true;
  // A prerendered page may never be shown. Start only when the user actually opens it.
  if ((document as Document & { prerendering?: boolean }).prerendering) {
    document.addEventListener("prerenderingchange", () => bootstrap(), { once: true });
  } else {
    bootstrap();
  }
}
