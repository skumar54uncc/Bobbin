import type { SyncEngineState } from "./db";

/** One flush per user every 5 minutes while browsing. docs/sync.md has the quota math. */
export const ACTIVITY_GAP_MS = 5 * 60_000;
/** Cadence of the safety alarm, and of slow mode after repeated 429s. */
export const SAFETY_GAP_MS = 15 * 60_000;
/** Hard floor between two flushes, Sync now included. */
export const MIN_FLUSH_GAP_MS = 60_000;
/** Every scheduled flush waits a random 0 to 60 seconds so users never flush in lockstep. */
export const JITTER_MAX_MS = 60_000;
export const BACKOFF_MIN_MS = 30_000;
export const BACKOFF_MAX_MS = 15 * 60_000;
/** 429s on this many flushes in a row start slow mode. */
export const SLOW_AFTER_429 = 3;
export const SLOW_MODE_MS = 24 * 3_600_000;
/** The startup check reads the sheet at most this often. */
export const VERIFY_EVERY_MS = 24 * 3_600_000;
/** Visits shorter than this are not written to the sheet. */
export const MIN_DWELL_MS = 5_000;
/** The Sync now button rests this long after a press. */
export const SYNC_NOW_COOLDOWN_MS = 30_000;

export type FlushReason = "activity" | "safety" | "startup" | "now";

/** Exponential backoff with full jitter, between 30 seconds and 15 minutes. `failures` starts at 1. */
export function retryDelayMs(failures: number, random: () => number = Math.random): number {
  const cap = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.max(0, failures - 1));
  return Math.max(BACKOFF_MIN_MS, Math.floor(Math.min(1, Math.max(0, random())) * cap));
}

export function inSlowMode(state: Pick<SyncEngineState, "slowUntil">, now: number): boolean {
  return state.slowUntil > now;
}

/**
 * When the next flush should run, or null when sync cannot run.
 * Sync now waits only for the one-a-minute floor. Everything else also honors
 * backoff, the activity or slow cadence, and adds jitter.
 */
export function plannedFlushAt(
  state: Pick<SyncEngineState, "syncEnabled" | "authNeeded" | "lastFlushAt" | "nextAttemptAt" | "slowUntil">,
  reason: FlushReason,
  now: number,
  random: () => number = Math.random
): number | null {
  if (!state.syncEnabled || state.authNeeded) return null;
  const floor = state.lastFlushAt + MIN_FLUSH_GAP_MS;
  if (reason === "now") return Math.max(now, floor);
  let at = Math.max(floor, state.nextAttemptAt);
  if (reason === "activity") {
    at = Math.max(at, state.lastFlushAt + (inSlowMode(state, now) ? SAFETY_GAP_MS : ACTIVITY_GAP_MS));
  }
  return Math.max(now, at) + Math.floor(Math.min(1, Math.max(0, random())) * JITTER_MAX_MS);
}

function minutesWord(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return `${minutes} min`;
}

function agoWord(ms: number): string {
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min ago`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export const CADENCE_SENTENCE = "Updates about every 5 minutes while you browse, and at least every 15 minutes.";
export const RECONNECT_LINE = "Sync paused: reconnect Google Drive.";

/** A trim stays in the status line this long. */
export const TRIM_NOTE_MS = 7 * 86_400_000;

/** The status line under Assistant Sync. Built only from recorded state. */
export function syncStatusLine(
  state: Pick<
    SyncEngineState,
    "syncEnabled" | "authNeeded" | "lastError" | "lastSyncedAt" | "nextAttemptAt" | "slowUntil" | "backfillPhase" | "lastFlushAt"
  > &
    Partial<Pick<SyncEngineState, "trimNote" | "trimmedAt">>,
  pendingPages: number,
  now: number,
  timeLabel: (ms: number) => string = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
): string {
  if (!state.syncEnabled) return "Assistant Sync is off.";
  if (state.authNeeded) return RECONNECT_LINE;
  if (state.backfillPhase === "reading" || state.backfillPhase === "writing") return "Adding your recent history to the sheet.";
  if (state.lastError && state.nextAttemptAt <= now) return state.lastError;
  const pages = `${pendingPages} new ${pendingPages === 1 ? "page" : "pages"}`;
  const slow = inSlowMode(state, now);
  if (pendingPages > 0 && state.nextAttemptAt > now) {
    const head = `Waiting to sync ${pages}. Next try in ${minutesWord(state.nextAttemptAt - now)}.`;
    return slow ? `${head} Google asked Cortex to slow down, so it syncs every 15 minutes until ${timeLabel(state.slowUntil)}.` : head;
  }
  if (slow) return `Google asked Cortex to slow down. Syncing about every 15 minutes until ${timeLabel(state.slowUntil)}.`;
  if (pendingPages > 0) {
    const due = Math.max(now, state.lastFlushAt + ACTIVITY_GAP_MS);
    return `Waiting to sync ${pages}. Next sync in about ${minutesWord(due - now + JITTER_MAX_MS / 2)}.`;
  }
  const trimmed = state.trimNote && now - (state.trimmedAt ?? 0) < TRIM_NOTE_MS ? `${state.trimNote} ` : "";
  if (state.lastSyncedAt > 0) return `Synced ${agoWord(now - state.lastSyncedAt)}. ${trimmed}${CADENCE_SENTENCE}`;
  return `Not synced yet. ${CADENCE_SENTENCE}`;
}
