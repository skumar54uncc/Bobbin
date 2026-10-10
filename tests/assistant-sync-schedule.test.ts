import { describe, expect, it } from "vitest";
import { defaultSyncEngineState } from "../src/assistant-sync/db";
import {
  ACTIVITY_GAP_MS,
  BACKOFF_MAX_MS,
  BACKOFF_MIN_MS,
  CADENCE_SENTENCE,
  JITTER_MAX_MS,
  MIN_FLUSH_GAP_MS,
  plannedFlushAt,
  RECONNECT_LINE,
  retryDelayMs,
  SAFETY_GAP_MS,
  syncStatusLine,
} from "../src/assistant-sync/schedule";

const NOW = Date.parse("2026-10-02T16:00:00.000Z");
const MIN = 60_000;
const on = { ...defaultSyncEngineState(), syncEnabled: true };

describe("schedule", () => {
  it("backs off with full jitter between 30 seconds and 15 minutes", () => {
    expect(retryDelayMs(1, () => 0)).toBe(BACKOFF_MIN_MS);
    expect(retryDelayMs(1, () => 1)).toBe(BACKOFF_MIN_MS);
    expect(retryDelayMs(3, () => 1)).toBe(4 * BACKOFF_MIN_MS);
    expect(retryDelayMs(3, () => 0.5)).toBe(2 * BACKOFF_MIN_MS);
    expect(retryDelayMs(50, () => 1)).toBe(BACKOFF_MAX_MS);
    for (let i = 0; i < 200; i++) {
      const delay = retryDelayMs(1 + (i % 12));
      expect(delay).toBeGreaterThanOrEqual(BACKOFF_MIN_MS);
      expect(delay).toBeLessThanOrEqual(BACKOFF_MAX_MS);
    }
  });

  it("waits 5 minutes after the last flush for activity, plus 0 to 60 seconds", () => {
    const state = { ...on, lastFlushAt: NOW - MIN };
    expect(plannedFlushAt(state, "activity", NOW, () => 0)).toBe(NOW - MIN + ACTIVITY_GAP_MS);
    expect(plannedFlushAt(state, "activity", NOW, () => 0.999)).toBe(NOW - MIN + ACTIVITY_GAP_MS + Math.floor(0.999 * JITTER_MAX_MS));
    // A quiet hour means the next closed page goes out within a minute.
    const idle = { ...on, lastFlushAt: NOW - 60 * MIN };
    expect(plannedFlushAt(idle, "activity", NOW, () => 0.5)).toBe(NOW + JITTER_MAX_MS / 2);
  });

  it("lets Sync now wait only for the one-a-minute floor", () => {
    expect(plannedFlushAt({ ...on, lastFlushAt: NOW - 20_000 }, "now", NOW)).toBe(NOW - 20_000 + MIN_FLUSH_GAP_MS);
    expect(plannedFlushAt({ ...on, lastFlushAt: NOW - 5 * MIN, nextAttemptAt: NOW + 10 * MIN }, "now", NOW)).toBe(NOW);
  });

  it("honors backoff and slow mode for scheduled flushes", () => {
    expect(plannedFlushAt({ ...on, nextAttemptAt: NOW + 3 * MIN }, "safety", NOW, () => 0)).toBe(NOW + 3 * MIN);
    const slow = { ...on, lastFlushAt: NOW - MIN, slowUntil: NOW + 3_600_000 };
    expect(plannedFlushAt(slow, "activity", NOW, () => 0)).toBe(NOW - MIN + SAFETY_GAP_MS);
  });

  it("plans nothing while sync is off or needs a reconnect", () => {
    expect(plannedFlushAt(defaultSyncEngineState(), "now", NOW)).toBeNull();
    expect(plannedFlushAt({ ...on, authNeeded: true }, "activity", NOW)).toBeNull();
  });
});

describe("status line", () => {
  it("states the real cadence after a sync", () => {
    expect(syncStatusLine({ ...on, lastSyncedAt: NOW - 2 * MIN }, 0, NOW)).toBe(
      "Synced 2 min ago. Updates about every 5 minutes while you browse, and at least every 15 minutes."
    );
    expect(CADENCE_SENTENCE).not.toMatch(/\u2014/);
  });

  it("names waiting pages and the next try during backoff", () => {
    expect(syncStatusLine({ ...on, lastSyncedAt: NOW - 10 * MIN, nextAttemptAt: NOW + 3 * MIN }, 14, NOW)).toBe(
      "Waiting to sync 14 new pages. Next try in 3 min."
    );
  });

  it("asks for a reconnect when Google refused the token", () => {
    expect(syncStatusLine({ ...on, authNeeded: true }, 3, NOW)).toBe(RECONNECT_LINE);
    expect(RECONNECT_LINE).toBe("Sync paused: reconnect Google Drive.");
  });

  it("says when slow mode is on and until when", () => {
    const line = syncStatusLine({ ...on, lastSyncedAt: NOW - MIN, slowUntil: NOW + 3_600_000 }, 0, NOW, () => "5:00 PM");
    expect(line).toBe("Google asked Bobbin to slow down. Syncing about every 15 minutes until 5:00 PM.");
  });

  it("reports off", () => {
    expect(syncStatusLine(defaultSyncEngineState(), 0, NOW)).toBe("Assistant Sync is off.");
  });
});
