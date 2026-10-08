/// <reference types="chrome"/>
import type { SyncEngineState } from "../assistant-sync/db";
import { ASSISTANT_SYNC_RETENTION_KEY } from "../assistant-sync/preference-keys";

/** The Sync now button rests this long after a press. Matches SYNC_NOW_COOLDOWN_MS. */
const SYNC_NOW_COOLDOWN_MS = 30_000;

interface StatusReply {
  state?: SyncEngineState;
  statusLine?: string;
}

function clampDays(days: number): number {
  if (!Number.isFinite(days)) return 90;
  return Math.max(7, Math.min(365, Math.round(days)));
}

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function showFeedback(text: string, isError: boolean): void {
  const el = byId<HTMLElement>("cx-assistant-feedback");
  if (!el) return;
  el.hidden = text.length === 0;
  el.textContent = text;
  el.classList.toggle("is-error", isError);
}

let poll = 0;
let syncOn = false;
/** Sync now stays disabled until this epoch ms. */
let restUntil = 0;
let countdown = 0;

function schedule(phase: string): void {
  window.clearInterval(poll);
  // Fast while the backfill runs, then once a minute so "Synced 2 min ago" stays true.
  poll = window.setInterval(() => void refresh(), phase === "reading" || phase === "writing" ? 2000 : 60_000);
}

function paintNowButton(): void {
  const now = byId<HTMLButtonElement>("cx-assistant-now");
  if (!now) return;
  const resting = Date.now() < restUntil;
  now.disabled = !syncOn || resting || countdown !== 0;
  now.title = syncOn ? "Sync Cortex Memory now" : "Turn Assistant Sync on before syncing";
}

function rest(): void {
  restUntil = Date.now() + SYNC_NOW_COOLDOWN_MS;
  paintNowButton();
  window.setTimeout(paintNowButton, SYNC_NOW_COOLDOWN_MS + 50);
}

function paint(state: SyncEngineState, statusLine?: string): void {
  // Sync now waits for a reconnect, so the button reads as off until then.
  syncOn = state.syncEnabled && !state.authNeeded;
  const line = byId<HTMLElement>("cx-assistant-line");
  if (line && statusLine && countdown === 0) line.textContent = statusLine;
  const enabled = byId<HTMLElement>("cx-assistant-enabled");
  const last = byId<HTMLElement>("cx-assistant-last");
  const error = byId<HTMLElement>("cx-assistant-error");
  const backfill = byId<HTMLElement>("cx-assistant-backfill");
  const enable = byId<HTMLButtonElement>("cx-assistant-enable");
  const disable = byId<HTMLButtonElement>("cx-assistant-disable");
  if (enabled) enabled.textContent = state.syncEnabled ? "On" : "Off";
  if (last) last.textContent = state.lastSyncedAt > 0 ? new Date(state.lastSyncedAt).toLocaleString() : "Not yet";
  if (error) error.textContent = state.lastError || "None";
  const pose = byId<HTMLImageElement>("cx-assistant-lost");
  if (pose) {
    const connected = state.syncEnabled && !state.lastError && !state.authNeeded;
    pose.hidden = false;
    pose.classList.toggle("is-lost", !connected);
    const file = connected ? "felt-connected" : "felt-lost";
    pose.src = `mascot/${file}.webp`;
    pose.srcset = `mascot/${file}@256.webp 256w, mascot/${file}.webp 512w`;
    pose.alt = connected ? "Cortex mascot connected" : "Cortex mascot looking for a page";
  }
  if (backfill) {
    backfill.textContent = state.backfillTotal
      ? `${state.backfillDone}/${state.backfillTotal}, ${state.backfillPhase}`
      : state.backfillPhase;
  }
  if (enable) {
    // Reconnect Google Drive runs the same Enable flow.
    enable.hidden = state.syncEnabled && !state.authNeeded;
    enable.textContent = state.authNeeded ? "Reconnect Google Drive" : "Enable";
    enable.disabled = false;
  }
  if (disable) {
    disable.hidden = !state.syncEnabled;
    disable.disabled = false;
  }
  paintNowButton();
  schedule(state.backfillPhase);
}

async function refresh(): Promise<void> {
  const res = (await chrome.runtime.sendMessage({ type: "CORTEX_ASSISTANT_SYNC", action: "status" })) as StatusReply;
  if (res?.state) paint(res.state, res.statusLine);
}

/** Inside the one-flush-a-minute window the service worker queues the flush and the page counts down. */
function startCountdown(waitMs: number): void {
  const line = byId<HTMLElement>("cx-assistant-line");
  const until = Date.now() + waitMs;
  window.clearInterval(countdown);
  const tick = () => {
    const left = Math.ceil((until - Date.now()) / 1000);
    if (left <= 0) {
      window.clearInterval(countdown);
      countdown = 0;
      if (line) line.textContent = "Syncing now.";
      paintNowButton();
      window.setTimeout(() => void refresh(), 4000);
      return;
    }
    if (line) line.textContent = `Syncing in ${left}s`;
  };
  countdown = window.setInterval(tick, 1000);
  tick();
  paintNowButton();
}

/** Interactive sign-in. Called only from the Enable click, which is the user gesture. */
export function driveTokenFromClick(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (value) => {
      const err = chrome.runtime.lastError;
      if (err?.message || !value) {
        reject(new Error(err?.message || "Sign in to Google is needed before Cortex can sync."));
        return;
      }
      resolve(value);
    });
  });
}

async function saveRetention(days: number): Promise<void> {
  await chrome.storage.local.set({ [ASSISTANT_SYNC_RETENTION_KEY]: days });
}

export function mountAssistantSyncPanel(): void {
  const enable = byId<HTMLButtonElement>("cx-assistant-enable");
  const disable = byId<HTMLButtonElement>("cx-assistant-disable");
  const now = byId<HTMLButtonElement>("cx-assistant-now");
  const retention = byId<HTMLInputElement>("cx-assistant-retention");
  if (!enable || !now) return;
  window.clearInterval(countdown);
  countdown = 0;
  restUntil = 0;

  enable.addEventListener("click", () => {
    enable.disabled = true;
    showFeedback("", false);
    void driveTokenFromClick()
      .then((token) => chrome.runtime.sendMessage({ type: "CORTEX_ASSISTANT_SYNC", action: "enable", token }))
      .then((res: { ok?: boolean; error?: string; status?: string } | undefined) => {
        if (!res?.ok) showFeedback(res?.error || "Sync did not start.", true);
        else showFeedback("Sync is on.", false);
        return refresh();
      })
      .catch((error: unknown) => {
        showFeedback(
          error instanceof Error ? error.message : "Sign in to Google is needed before Cortex can sync.",
          true
        );
      })
      .finally(() => {
        enable.disabled = syncOn;
      });
  });

  disable?.addEventListener("click", () => {
    disable.disabled = true;
    showFeedback("", false);
    void chrome.runtime
      .sendMessage({ type: "CORTEX_ASSISTANT_SYNC", action: "disable" })
      .then((res: { ok?: boolean; error?: string } | undefined) => {
        if (!res?.ok) showFeedback(res?.error || "Sync could not be turned off.", true);
        else showFeedback("Sync is off. Drive files were left in place.", false);
        return refresh();
      })
      .catch((error: unknown) => {
        showFeedback(error instanceof Error ? error.message : "Sync could not be turned off.", true);
      })
      .finally(() => {
        disable.disabled = !syncOn;
      });
  });

  now.addEventListener("click", () => {
    if (!syncOn) {
      showFeedback("Turn Assistant Sync on before syncing.", true);
      return;
    }
    rest();
    showFeedback("", false);
    void chrome.runtime
      .sendMessage({ type: "CORTEX_ASSISTANT_SYNC", action: "now" })
      .then((res: { ok?: boolean; error?: string; status?: string; waitMs?: number } | undefined) => {
        if (res?.status === "waiting" && typeof res.waitMs === "number") {
          startCountdown(res.waitMs);
          return;
        }
        if (!res?.ok) showFeedback(res?.error || "Sync did not finish.", true);
        else showFeedback("Sync finished.", false);
        return refresh();
      })
      .catch((error: unknown) => {
        showFeedback(error instanceof Error ? error.message : "Sync did not finish.", true);
      });
  });

  retention?.addEventListener("change", () => {
    const days = clampDays(Number(retention.value));
    retention.value = String(days);
    void saveRetention(days);
  });

  void chrome.storage.local.get(ASSISTANT_SYNC_RETENTION_KEY).then((stored) => {
    const days = stored[ASSISTANT_SYNC_RETENTION_KEY];
    if (retention && typeof days === "number") retention.value = String(clampDays(days));
  });
  void refresh();
}
