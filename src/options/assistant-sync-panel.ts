/// <reference types="chrome"/>
import type { SyncEngineState } from "../assistant-sync/db";
import { ASSISTANT_SYNC_RETENTION_KEY, ASSISTANT_SYNC_SHEET_DETAIL_KEY } from "../assistant-sync/preference-keys";
import { formatSheetSize, normalizeSheetDetail, SHEET_DETAIL } from "../assistant-sync/sheet-detail";

type EnableReply = { ok?: boolean; error?: string; status?: string; confirm?: "missing" | "trashed" } | undefined;

const CONFIRM_TEXT = {
  trashed: "Cortex Memory is in your Google Drive trash. Restore it to keep syncing into the same sheet.",
  missing: "Cortex Memory was deleted from Google Drive. Create a new sheet to start syncing again. Cortex fills it from the history on this device.",
} as const;
const CONFIRM_BUTTON = { trashed: "Restore from trash", missing: "Create a new sheet" } as const;

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
  const size = byId<HTMLElement>("cx-assistant-size");
  if (size) {
    const target = SHEET_DETAIL[normalizeSheetDetail(state.sheetDetail)].targetBytes;
    size.textContent = state.sheetBytes > 0 ? `${formatSheetSize(state.sheetBytes)} of ${formatSheetSize(target)}` : "Not measured yet";
  }
  paintLegacy(state);
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

function paintLegacy(state: SyncEngineState): void {
  const group = byId<HTMLElement>("cx-assistant-legacy");
  const list = byId<HTMLUListElement>("cx-assistant-legacy-list");
  if (!group || !list) return;
  const files = state.legacyCleanup === "ask" ? (state.legacyFiles ?? []) : [];
  group.hidden = files.length === 0;
  list.replaceChildren(
    ...files.map((file) => {
      const item = document.createElement("li");
      item.textContent = file.name;
      return item;
    })
  );
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

/** Token from the last Enable click, kept only while Cortex waits for an answer to its question. */
let confirmToken = "";

function showConfirm(kind: "missing" | "trashed" | null): void {
  const box = byId<HTMLElement>("cx-assistant-confirm");
  const text = byId<HTMLElement>("cx-assistant-confirm-text");
  const go = byId<HTMLButtonElement>("cx-assistant-confirm-go");
  if (!box || !text || !go) return;
  box.hidden = kind == null;
  if (!kind) {
    confirmToken = "";
    return;
  }
  text.textContent = CONFIRM_TEXT[kind];
  go.textContent = CONFIRM_BUTTON[kind];
  go.dataset.choice = kind === "trashed" ? "restore" : "create";
  go.disabled = false;
}

function afterEnable(res: EnableReply, token: string): Promise<void> {
  if (res?.status === "confirm" && res.confirm) {
    confirmToken = token;
    showFeedback("", false);
    showConfirm(res.confirm);
  } else {
    showConfirm(null);
    if (!res?.ok) showFeedback(res?.error || "Sync did not start.", true);
    else showFeedback("Sync is on.", false);
  }
  return refresh();
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
    showConfirm(null);
    void driveTokenFromClick()
      .then(async (token) =>
        afterEnable((await chrome.runtime.sendMessage({ type: "CORTEX_ASSISTANT_SYNC", action: "enable", token })) as EnableReply, token)
      )
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

  // The answer to Cortex's question continues the same Enable, with the token from that click.
  const go = byId<HTMLButtonElement>("cx-assistant-confirm-go");
  go?.addEventListener("click", () => {
    const choice = go.dataset.choice === "restore" ? "restore" : "create";
    const token = confirmToken;
    if (!token) {
      showConfirm(null);
      showFeedback("Press Enable again to continue.", true);
      return;
    }
    go.disabled = true;
    void chrome.runtime
      .sendMessage({ type: "CORTEX_ASSISTANT_SYNC", action: "enable", token, choice })
      .then((res: EnableReply) => afterEnable(res, token))
      .catch((error: unknown) => showFeedback(error instanceof Error ? error.message : "Sync did not start.", true));
  });
  byId<HTMLButtonElement>("cx-assistant-confirm-cancel")?.addEventListener("click", () => {
    showConfirm(null);
    showFeedback("Sync stays off. Your Drive was not changed.", false);
  });

  const answerLegacy = (cleanup: "trash" | "keep") => {
    const buttons = [byId<HTMLButtonElement>("cx-assistant-legacy-trash"), byId<HTMLButtonElement>("cx-assistant-legacy-keep")];
    for (const b of buttons) if (b) b.disabled = true;
    void chrome.runtime
      .sendMessage({ type: "CORTEX_ASSISTANT_SYNC", action: "cleanup", cleanup })
      .then((res: { ok?: boolean; error?: string } | undefined) => {
        if (!res?.ok) showFeedback(res?.error || "Drive did not change. Try again.", true);
        else showFeedback(cleanup === "trash" ? "The older files are in your Drive trash." : "The older files stay in Drive.", false);
        return refresh();
      })
      .finally(() => {
        for (const b of buttons) if (b) b.disabled = false;
      });
  };
  byId<HTMLButtonElement>("cx-assistant-legacy-trash")?.addEventListener("click", () => answerLegacy("trash"));
  byId<HTMLButtonElement>("cx-assistant-legacy-keep")?.addEventListener("click", () => answerLegacy("keep"));

  const details = [...document.querySelectorAll<HTMLInputElement>('input[name="cx-assistant-detail"]')];
  for (const input of details) {
    input.addEventListener("change", () => {
      if (input.checked) void chrome.storage.local.set({ [ASSISTANT_SYNC_SHEET_DETAIL_KEY]: normalizeSheetDetail(input.value) });
    });
  }

  void chrome.storage.local.get([ASSISTANT_SYNC_RETENTION_KEY, ASSISTANT_SYNC_SHEET_DETAIL_KEY]).then((stored) => {
    const days = stored[ASSISTANT_SYNC_RETENTION_KEY];
    if (retention && typeof days === "number") retention.value = String(clampDays(days));
    const detail = normalizeSheetDetail(stored[ASSISTANT_SYNC_SHEET_DETAIL_KEY]);
    for (const input of details) input.checked = input.value === detail;
  });
  void refresh();
}
