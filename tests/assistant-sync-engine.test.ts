import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  assistantSyncDb,
  clearAssistantSyncDatabase,
  defaultSyncEngineState,
  readSyncEngineState,
  writeSyncEngineState,
  type SyncVisitRecord,
} from "../src/assistant-sync/db";
import type { StoredMemoryIds } from "../src/assistant-sync/drive-api";
import { BACKOFF_MIN_MS, SLOW_MODE_MS } from "../src/assistant-sync/schedule";
import {
  backfillHistory,
  DAY_MS,
  enableAssistantSync,
  runFlush,
  SYNC_MISSING_MESSAGE,
  type FlushDeps,
} from "../src/assistant-sync/sync-engine";
import { FakeSheets } from "./helpers/fake-sheets";

const NOW = Date.parse("2026-10-02T16:00:00.000Z");
const MIN = 60_000;
const ZONE = "America/New_York";
const READY: StoredMemoryIds = { folderId: "folder", fileId: "file" };

function visit(id: string, visitedAt: number, extra: Partial<SyncVisitRecord> = {}): SyncVisitRecord {
  return {
    id,
    visitedAt,
    title: id,
    url: `https://example.com/${id}`,
    domain: "example.com",
    dwellMinutes: 12,
    maxScrollPct: 40,
    pageType: "Article",
    topics: ["vector databases"],
    finalizedAt: visitedAt,
    ...extra,
  };
}

function deps(sheets: FakeSheets, now: number, extra: Partial<FlushDeps> = {}): FlushDeps {
  return { api: sheets, ids: READY, now, timeZone: ZONE, mode: "scheduled", random: () => 0, ...extra };
}

/** Sync on, sheet read once on Enable. Leaves the cached layout in place like a real session. */
async function enabled(sheets: FakeSheets, at = NOW): Promise<void> {
  await writeSyncEngineState({ ...defaultSyncEngineState(), syncEnabled: true });
  const first = await runFlush(deps(sheets, at, { mode: "enable" }));
  expect(first.status).toBe("ready");
}

beforeEach(async () => {
  await clearAssistantSyncDatabase();
});

describe("flush", () => {
  it("makes zero reads and one batchUpdate in a normal flush", async () => {
    const sheets = new FakeSheets();
    await enabled(sheets);
    const readsAfterEnable = sheets.reads;
    expect(readsAfterEnable).toBe(2);

    await assistantSyncDb.visits.put(visit("v1", NOW + MIN));
    await assistantSyncDb.searches.put({ id: "s1", visitedAt: NOW + MIN, engine: "Google", query: "pgvector" });
    const writes = sheets.writes;
    const result = await runFlush(deps(sheets, NOW + 6 * MIN));
    expect(result).toMatchObject({ status: "ready", reads: 0, writes: 1 });
    expect(sheets.reads).toBe(readsAfterEnable);
    expect(sheets.writes).toBe(writes + 1);
    expect(sheets.ids("Visits")).toEqual(["v1"]);
    expect(sheets.ids("Searches")).toEqual(["s1"]);
    expect(sheets.tab("Visits")[0]?.[0]).toBe("id");

    // Daily, About, and the rows went out in that one request.
    const kinds = sheets.batches.at(-1)!.map((request) => Object.keys(request)[0]);
    expect(kinds).toContain("appendCells");
    expect(kinds).toContain("updateCells");
    const about = sheets.tab("About").map((row) => row[0]);
    expect(about.some((line) => line?.includes("Rows: 1 visits"))).toBe(true);
    expect(sheets.tab("Daily").filter((row) => row[0] === "2026-10-02")).toHaveLength(1);
  });

  it("updates the Daily row in place for a day that already has one", async () => {
    const sheets = new FakeSheets();
    await enabled(sheets);
    await assistantSyncDb.visits.put(visit("v1", NOW + MIN));
    await runFlush(deps(sheets, NOW + 6 * MIN));
    await assistantSyncDb.visits.put(visit("v2", NOW + 7 * MIN));
    const second = await runFlush(deps(sheets, NOW + 12 * MIN));
    expect(second).toMatchObject({ status: "ready", reads: 0, writes: 1 });
    expect(sheets.tab("Daily").filter((row) => row[0] === "2026-10-02")).toHaveLength(1);
    expect(sheets.ids("Visits")).toEqual(["v1", "v2"]);
  });

  it("sends nothing when nothing changed", async () => {
    const sheets = new FakeSheets();
    await enabled(sheets);
    const writes = sheets.writes;
    const quiet = await runFlush(deps(sheets, NOW + 20 * MIN));
    expect(quiet).toMatchObject({ status: "ready", appended: 0, reads: 0, writes: 0 });
    expect(sheets.writes).toBe(writes);
  });

  it("holds open visits until they are finalized", async () => {
    const sheets = new FakeSheets();
    await enabled(sheets);
    await assistantSyncDb.visits.put(visit("open", NOW + MIN, { finalizedAt: undefined, dwellMinutes: null }));
    await runFlush(deps(sheets, NOW + 6 * MIN));
    expect(sheets.ids("Visits")).toEqual([]);
    await assistantSyncDb.visits.update("open", { finalizedAt: NOW + 8 * MIN, dwellMinutes: 3 });
    await runFlush(deps(sheets, NOW + 14 * MIN));
    expect(sheets.ids("Visits")).toEqual(["open"]);
  });

  it("allows one flush a minute, Sync now included", async () => {
    const sheets = new FakeSheets();
    await enabled(sheets);
    await assistantSyncDb.visits.put(visit("v1", NOW));
    await runFlush(deps(sheets, NOW + 2 * MIN));
    await assistantSyncDb.visits.put(visit("v2", NOW));
    const writes = sheets.writes;
    const early = await runFlush(deps(sheets, NOW + 2 * MIN + 20_000, { mode: "user" }));
    expect(early.status).toBe("throttled");
    expect(early.retryAt).toBe(NOW + 3 * MIN);
    expect(sheets.writes).toBe(writes);
    const onTime = await runFlush(deps(sheets, NOW + 3 * MIN, { mode: "user" }));
    expect(onTime.status).toBe("ready");
    expect(sheets.ids("Visits")).toEqual(["v1", "v2"]);
  });

  it("recovers from a crash after the inflight record without duplicates or loss", async () => {
    const sheets = new FakeSheets();
    await enabled(sheets);
    await assistantSyncDb.visits.put(visit("v1", NOW));
    // Chrome died after the inflight record was written and before Google saw the request.
    await assistantSyncDb.inflight.put({ id: "inflight", fileId: "file", keys: ["Visits:v1"], startedAt: NOW });
    const after = await runFlush(deps(sheets, NOW + 6 * MIN));
    expect(after).toMatchObject({ status: "ready", reads: 2, writes: 1 });
    expect(sheets.ids("Visits")).toEqual(["v1"]);
    expect(await assistantSyncDb.inflight.count()).toBe(0);
  });

  it("does not append twice when Google applied a batch but the reply was lost", async () => {
    const sheets = new FakeSheets();
    await enabled(sheets);
    await assistantSyncDb.visits.put(visit("v1", NOW));
    sheets.outcomes.push({ status: 503, lost: true });
    const lost = await runFlush(deps(sheets, NOW + 6 * MIN));
    expect(lost.status).toBe("error");
    expect(sheets.ids("Visits")).toEqual(["v1"]);
    expect((await readSyncEngineState()).verifyNext).toBe(true);

    await assistantSyncDb.visits.put(visit("v2", NOW + 7 * MIN));
    const next = await runFlush(deps(sheets, NOW + 20 * MIN));
    expect(next).toMatchObject({ status: "ready", reads: 2 });
    expect(sheets.ids("Visits")).toEqual(["v1", "v2"]);
    expect((await readSyncEngineState()).verifyNext).toBe(false);
  });

  it("backs off on 429 with full jitter, keeps every row, and recovers", async () => {
    const sheets = new FakeSheets();
    await enabled(sheets);
    await assistantSyncDb.visits.put(visit("v1", NOW));
    sheets.outcomes.push({ status: 429 });
    const t1 = NOW + 6 * MIN;
    const failed = await runFlush(deps(sheets, t1, { random: () => 0.5 }));
    expect(failed.status).toBe("error");
    expect(failed.retryAt).toBe(t1 + BACKOFF_MIN_MS);
    expect(sheets.ids("Visits")).toEqual([]);
    expect(await assistantSyncDb.synced.get("Visits:v1")).toBeUndefined();

    const early = await runFlush(deps(sheets, t1 + 10_000));
    expect(early.status).toBe("throttled");

    const recovered = await runFlush(deps(sheets, t1 + 2 * MIN));
    expect(recovered).toMatchObject({ status: "ready", reads: 0, writes: 1 });
    expect(sheets.ids("Visits")).toEqual(["v1"]);
    const state = await readSyncEngineState();
    expect(state).toMatchObject({ backoffFailures: 0, consecutive429: 0, nextAttemptAt: 0 });
  });

  it("enters slow mode after 3 flushes in a row end in 429", async () => {
    const sheets = new FakeSheets();
    await enabled(sheets);
    await assistantSyncDb.visits.put(visit("v1", NOW));
    let at = NOW + 6 * MIN;
    for (let i = 0; i < 3; i++) {
      sheets.outcomes.push({ status: 429 });
      const out = await runFlush(deps(sheets, at, { random: () => 1 }));
      expect(out.status).toBe("error");
      at = Math.max(out.retryAt!, at + MIN) + 1;
    }
    const state = await readSyncEngineState();
    expect(state.consecutive429).toBe(3);
    expect(state.slowUntil).toBeGreaterThanOrEqual(at - 1 + SLOW_MODE_MS - 20 * MIN);
    // Rows are still queued for the next try.
    const ok = await runFlush(deps(sheets, at));
    expect(ok.status).toBe("ready");
    expect(sheets.ids("Visits")).toEqual(["v1"]);
  });

  it("reports 401 without spending the minute, so a fresh token can retry at once", async () => {
    const sheets = new FakeSheets();
    await enabled(sheets);
    await assistantSyncDb.visits.put(visit("v1", NOW));
    sheets.outcomes.push({ status: 401 });
    const before = (await readSyncEngineState()).lastFlushAt;
    const denied = await runFlush(deps(sheets, NOW + 6 * MIN));
    expect(denied.status).toBe("auth");
    const state = await readSyncEngineState();
    expect(state.lastFlushAt).toBe(before);
    expect(state.backoffFailures).toBe(0);
    const retry = await runFlush(deps(sheets, NOW + 6 * MIN + 1_000, { mode: "user" }));
    expect(retry.status).toBe("ready");
    expect(sheets.ids("Visits")).toEqual(["v1"]);
  });

  it("stops at authNeeded until Enable runs", async () => {
    const sheets = new FakeSheets();
    await enabled(sheets);
    await writeSyncEngineState({ ...(await readSyncEngineState()), authNeeded: true });
    const out = await runFlush(deps(sheets, NOW + 20 * MIN));
    expect(out.status).toBe("auth");
    expect(sheets.writes).toBe(1);
  });

  it("deletes rows past retention by position without reading the sheet", async () => {
    const sheets = new FakeSheets();
    const old = visit("old", Date.parse("2026-06-01T16:00:00.000Z"));
    const kept = visit("kept", Date.parse("2026-09-15T16:00:00.000Z"));
    await assistantSyncDb.visits.bulkPut([old, kept]);
    await writeSyncEngineState({ ...defaultSyncEngineState(), syncEnabled: true, retentionDays: 365 });
    await runFlush(deps(sheets, NOW, { mode: "enable" }));
    expect(sheets.ids("Visits")).toEqual(["old", "kept"]);

    await writeSyncEngineState({ ...(await readSyncEngineState()), retentionDays: 90 });
    const reads = sheets.reads;
    const purge = await runFlush(deps(sheets, NOW + 6 * MIN));
    expect(purge).toMatchObject({ status: "ready", reads: 0, writes: 1 });
    expect(sheets.reads).toBe(reads);
    expect(sheets.ids("Visits")).toEqual(["kept"]);
    expect(sheets.tab("Daily").map((row) => row[0])).not.toContain("2026-06-01");
    const deletes = sheets.batches.at(-1)!.filter((request) => "deleteDimension" in request);
    expect(deletes.length).toBeGreaterThan(0);
    expect(await assistantSyncDb.visits.get("old")).toBeUndefined();
  });

  it("splits a backlog larger than one request across flushes", async () => {
    const sheets = new FakeSheets();
    await enabled(sheets);
    const big = "x".repeat(2500);
    const rows = Array.from({ length: 400 }, (_, i) =>
      visit(`v${String(i).padStart(4, "0")}`, NOW - (i % 30) * DAY_MS, { title: big, url: `https://example.com/${i}/${big}${big}` })
    );
    await assistantSyncDb.visits.bulkPut(rows);
    const first = await runFlush(deps(sheets, NOW + 6 * MIN));
    expect(first.status).toBe("ready");
    expect(first.more).toBe(true);
    expect(first.retryAt).toBe(NOW + 7 * MIN);
    const sent = JSON.stringify(sheets.batches.at(-1)).length;
    expect(sent).toBeLessThan(2_000_000);
    let at = first.retryAt!;
    for (let i = 0; i < 10 && sheets.ids("Visits").length < rows.length; i++) {
      const next = await runFlush(deps(sheets, at));
      at = next.retryAt ?? at + MIN;
    }
    expect(new Set(sheets.ids("Visits")).size).toBe(rows.length);
    expect(sheets.ids("Visits")).toHaveLength(rows.length);
  }, 30_000);

  it("re-adds a tab the user deleted", async () => {
    const sheets = new FakeSheets();
    sheets.books.get("file")!.delete("Searches");
    await writeSyncEngineState({ ...defaultSyncEngineState(), syncEnabled: true });
    await assistantSyncDb.searches.put({ id: "s1", visitedAt: NOW, engine: "Google", query: "pgvector" });
    const out = await runFlush(deps(sheets, NOW, { mode: "enable" }));
    expect(out.status).toBe("ready");
    expect(sheets.ids("Searches")).toEqual(["s1"]);
  });

  it("reports a missing file and does not create a replacement", async () => {
    const sheets = new FakeSheets();
    sheets.files.delete("file");
    await writeSyncEngineState({ ...defaultSyncEngineState(), syncEnabled: true });
    const result = await runFlush(deps(sheets, NOW));
    expect(result.status).toBe("missing");
    expect(result.error).toBe(SYNC_MISSING_MESSAGE);
    expect(sheets.creates).toBe(0);
  });
});

describe("backfill and enable", () => {
  it("accounts for backfill progress and leaves dwell and excerpts blank", async () => {
    const events: { done: number; total: number; phase: string }[] = [];
    const result = await backfillHistory({
      now: NOW,
      retentionDays: 90,
      timeZone: ZONE,
      history: [
        { id: "old", url: "https://example.com/old", title: "Old", visitedAt: NOW - 200 * DAY_MS },
        { id: "bank", url: "https://www.chase.com/account", title: "Bank", visitedAt: NOW - DAY_MS },
        { id: "a", url: "https://example.com/a?utm=1", title: "Alpha", visitedAt: NOW - 2 * DAY_MS },
        { id: "b", url: "https://www.linkedin.com/in/ada-marin/", title: "Ada", visitedAt: NOW - DAY_MS },
      ],
      people: [
        {
          profileUrl: "https://www.linkedin.com/in/ada-marin/",
          name: "Ada Marin",
          headline: "Factory software",
          company: "Tesla",
          kind: "person",
          seenAt: NOW,
        },
      ],
      onProgress: (progress) => {
        events.push(progress);
      },
    });
    expect(result).toEqual({ stored: 2, skipped: 1, total: 3 });
    expect(events[0]).toEqual({ done: 0, total: 3, phase: "reading" });
    expect(events.at(-1)).toEqual({ done: 3, total: 3, phase: "done" });
    expect(await assistantSyncDb.content.count()).toBe(0);
    expect(await assistantSyncDb.visits.get("old")).toBeUndefined();
    expect(await assistantSyncDb.visits.get("bank")).toBeUndefined();
    const alpha = await assistantSyncDb.visits.get("a");
    expect(alpha?.dwellMinutes).toBeNull();
    expect(alpha?.finalizedAt).toBeTypeOf("number");
    const person = await assistantSyncDb.people.get("b");
    expect(person?.company).toBe("Tesla");
    expect(person?.dwellMinutes).toBeNull();
  });

  it("creates a file on enable and appends each backfilled id once", async () => {
    const sheets = new FakeSheets(false);
    let ids: StoredMemoryIds = { folderId: null, fileId: null };
    const result = await enableAssistantSync({
      api: sheets,
      ids,
      now: NOW,
      timeZone: ZONE,
      history: [{ id: "h1", url: "https://example.com/h1", title: "History", visitedAt: NOW - DAY_MS }],
      saveIds: async (next) => {
        ids = next;
      },
      random: () => 0,
    });
    if ("confirm" in result) throw new Error("enable asked a question");
    expect(result.created).toBe(true);
    expect(result.flush.status).toBe("ready");
    expect(result.flush.appended).toBeGreaterThanOrEqual(1);
    const again = await runFlush({ ...deps(sheets, NOW + 6 * MIN), ids });
    expect(again.appended).toBe(0);
    expect(sheets.ids("Visits", ids.fileId!)).toEqual(["h1"]);
    expect(sheets.tab("About", ids.fileId!).length).toBeGreaterThan(3);
  });

  it("folder exists, sheet missing: Enable reuses the folder and creates one sheet, set up in one batch", async () => {
    const sheets = new FakeSheets(false);
    sheets.files.set("left-over", { name: "Cortex Memory", trashed: false });
    let ids: StoredMemoryIds = { folderId: null, fileId: null };
    const enable = () =>
      enableAssistantSync({
        api: sheets,
        ids,
        now: NOW,
        timeZone: ZONE,
        history: [{ id: "h1", url: "https://example.com/h1", title: "History", visitedAt: NOW - DAY_MS }],
        saveIds: async (next) => {
          ids = next;
        },
        random: () => 0,
      });
    const result = await enable();
    if ("confirm" in result) throw new Error("enable asked a question");
    expect(result.flush.status).toBe("ready");
    expect(ids.folderId).toBe("left-over");
    expect(sheets.folders()).toEqual(["left-over"]);
    expect(sheets.creates).toBe(1);
    const spreadsheets = [...sheets.files.values()].filter((file) => file.sheet);
    expect(spreadsheets).toHaveLength(1);
    expect(spreadsheets[0]?.parent).toBe("left-over");
    // Setup is the first batch: tabs, headers, About, and the edit warning together.
    const setup = sheets.batches[0]!.map((r) => Object.keys(r)[0]);
    expect(setup.filter((k) => k === "addSheet")).toHaveLength(6);
    expect(setup.filter((k) => k === "addProtectedRange")).toHaveLength(7);
    expect(sheets.ids("Visits", ids.fileId!)).toEqual(["h1"]);

    // Enable again, as after a reinstall with no stored ids: same folder, same sheet.
    ids = { folderId: null, fileId: null };
    await enable();
    expect(sheets.creates).toBe(1);
    expect(sheets.folders()).toEqual(["left-over"]);
    expect(sheets.ids("Visits", ids.fileId!)).toEqual(["h1"]);
  });

  it("reports a 403 as a permission problem with Google's message, never as APIs to enable", async () => {
    const sheets = new FakeSheets();
    await writeSyncEngineState({ ...defaultSyncEngineState(), syncEnabled: true, verifyNext: true });
    await assistantSyncDb.visits.put(visit("v1", NOW - 10 * MIN));
    sheets.outcomes.push({ status: 403, googleStatus: "PERMISSION_DENIED", message: "The caller does not have permission" });
    const result = await runFlush(deps(sheets, NOW, { mode: "user" }));
    expect(result.status).toBe("error");
    expect(result.error).toBe("Google did not allow Cortex to create or edit the sheet. Google said: The caller does not have permission");
    expect(result.errorDetail).toEqual({
      call: "batchUpdate",
      http_status: 403,
      status: "PERMISSION_DENIED",
      message: "The caller does not have permission",
    });
    expect((await readSyncEngineState()).lastError).toBe(result.error);
    expect(result.error).not.toMatch(/enable the/i);
  });
});

describe("service worker boundaries", () => {
  it("keeps Google fetches out of the service worker", () => {
    const source = readFileSync(join(__dirname, "..", "src", "background", "service-worker.ts"), "utf8");
    expect(source).not.toContain("assistant-sync/drive-api");
    expect(source).not.toContain("assistant-sync/sync-engine");
    expect(source).not.toContain("assistant-sync/finalize");
    expect(source).not.toContain("sheets.googleapis.com");
    expect(source).not.toContain("permissions.request");
    expect(source).not.toContain("interactive: true");
    expect(source).toContain("interactive: false");
    expect(source).toContain("removeCachedAuthToken");
    const runtime = readFileSync(join(__dirname, "..", "src", "assistant-sync", "runtime.ts"), "utf8");
    expect(runtime).not.toContain("chrome.storage");
    const syncGate = source.slice(
      source.indexOf('type === "CORTEX_ASSISTANT_SYNC"'),
      source.indexOf('type === "CORTEX_OPEN_OPTIONS"')
    );
    expect(syncGate).toContain("isOptionsPageSender(sender)");
    expect(syncGate).toContain("AssistantSyncMessageSchema");
    expect(syncGate).toContain("DwellMessageSchema");
  });

  it("keeps one open visit while the tab stays on the same canonical page", () => {
    const source = readFileSync(join(__dirname, "..", "src", "background", "service-worker.ts"), "utf8");
    const capture = source.slice(source.indexOf("async function captureAssistantSyncVisit"), source.indexOf("chrome.tabs.onRemoved"));
    expect(capture).toContain("canonicalizeUrl(visit.url)");
    expect(capture).toContain("canonicalizeUrl(current.url)");
    expect(capture).not.toContain("current.url === visit.url");
    expect(capture).toContain("ownIds");
  });

  it("parses imported history pages in the offscreen document, which has a DOM", () => {
    const source = readFileSync(join(__dirname, "..", "src", "background", "service-worker.ts"), "utf8");
    expect(source).not.toContain("content/extract");
    expect(source).not.toContain("DOMParser");
    expect(source).toContain('type: "CORTEX_HISTORY_EXTRACT"');
    const offscreen = readFileSync(join(__dirname, "..", "src", "offscreen", "offscreen.ts"), "utf8");
    const handler = offscreen.slice(offscreen.indexOf('"CORTEX_HISTORY_EXTRACT"'), offscreen.indexOf('"CORTEX_PDF_EXTRACT"'));
    expect(handler).toContain("isServiceWorkerSender(sender)");
    expect(handler).toContain("extractPageTextFromHtml");
  });
});

describe("About freshness", () => {
  const about = (sheets: FakeSheets) => sheets.tab("About").map((row) => row[0] ?? "");

  it("shows Last checked and Last new activity, refreshing Last checked alone at most once an hour", async () => {
    const sheets = new FakeSheets();
    await enabled(sheets);
    await assistantSyncDb.visits.put(visit("v1", NOW + MIN));
    expect(await runFlush(deps(sheets, NOW + 6 * MIN))).toMatchObject({ writes: 1 });
    expect(about(sheets)[1]).toBe("Last checked: 2026-10-02 12:06 America/New_York. Cortex last looked for new browsing at this time.");
    expect(about(sheets)[2]).toMatch(/^Last new activity: 2026-10-02 12:01 America\/New_York\. /);

    // Nothing new: passes inside the hour write nothing.
    for (const at of [20, 40, 65]) expect(await runFlush(deps(sheets, NOW + at * MIN))).toMatchObject({ reads: 0, writes: 0 });

    // An hour after the last write, one About-only write moves Last checked. Activity stays put.
    const idle = await runFlush(deps(sheets, NOW + 66 * MIN));
    expect(idle).toMatchObject({ status: "ready", reads: 0, writes: 1, appended: 0 });
    const sent = sheets.batches.at(-1)!;
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent)).toContain(`"sheetId":${0}`);
    expect(about(sheets)[1]).toContain("Last checked: 2026-10-02 13:06");
    expect(about(sheets)[2]).toMatch(/^Last new activity: 2026-10-02 12:01 /);
    expect(await runFlush(deps(sheets, NOW + 80 * MIN))).toMatchObject({ writes: 0 });
  });

  it("a write with new rows carries Last checked, so no extra write follows it", async () => {
    const sheets = new FakeSheets();
    await enabled(sheets);
    await assistantSyncDb.visits.put(visit("v1", NOW + 100 * MIN));
    expect(await runFlush(deps(sheets, NOW + 110 * MIN))).toMatchObject({ writes: 1, appended: 2 });
    expect(about(sheets)[1]).toContain("Last checked: 2026-10-02 13:50");
    expect(about(sheets)[2]).toContain("Last new activity: 2026-10-02 13:40");
    expect(await runFlush(deps(sheets, NOW + 150 * MIN))).toMatchObject({ writes: 0 });
  });
});
