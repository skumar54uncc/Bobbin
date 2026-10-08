import { describe, it, expect } from "vitest";
import { FLUSH_LOG_MAX, appendFlushLog, flushLogEntry } from "../src/assistant-sync/flush-log";

const NOW = Date.parse("2026-10-08T12:00:00Z");

describe("flush log", () => {
  it("records counts and status only", () => {
    const entry = flushLogEntry("alarm", { ok: true, status: "ready", appended: 7, reads: 0, writes: 1 }, NOW);
    expect(entry).toEqual({ at: "2026-10-08T12:00:00.000Z", action: "alarm", status: "ready", appended: 7, reads: 0, writes: 1 });
  });

  it("keeps the retry time and a short error", () => {
    const entry = flushLogEntry("now", { ok: false, status: "backoff", retryAt: NOW + 60_000, error: "x".repeat(500) }, NOW);
    expect(entry.retryAt).toBe("2026-10-08T12:01:00.000Z");
    expect(entry.error).toHaveLength(400);
    expect(entry.reads).toBeNull();
  });

  it("records which Google call failed and what Google said as error_detail", () => {
    const detail = { call: "sheet create", http_status: 403, status: "PERMISSION_DENIED", message: "The caller does not have permission" };
    const entry = flushLogEntry("enable", { ok: false, error: "x", errorDetail: detail }, NOW);
    expect(entry.error_detail).toEqual(detail);
    expect(flushLogEntry("alarm", { ok: true }, NOW)).not.toHaveProperty("error_detail");
  });

  it("keeps only the newest entries", () => {
    let log: unknown = "not a list";
    for (let i = 0; i < FLUSH_LOG_MAX + 5; i += 1) {
      log = appendFlushLog(log, flushLogEntry("alarm", { ok: true, appended: i }, NOW + i));
    }
    const list = log as { appended: number }[];
    expect(list).toHaveLength(FLUSH_LOG_MAX);
    expect(list[0]!.appended).toBe(5);
    expect(list.at(-1)!.appended).toBe(FLUSH_LOG_MAX + 4);
  });
});
