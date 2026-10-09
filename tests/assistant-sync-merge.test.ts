import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  assistantSyncDb,
  clearAssistantSyncDatabase,
  countUnsyncedVisits,
  defaultSyncEngineState,
  readSyncEngineState,
  writeSyncEngineState,
  type SyncVisitRecord,
} from "../src/assistant-sync/db";
import type { StoredMemoryIds } from "../src/assistant-sync/drive-api";
import { canonicalizeUrl } from "../src/assistant-sync/canonical-url";
import { mergeDailyRepeats } from "../src/assistant-sync/merge";
import { SCHEMA_VERSION, VISIT_HEADERS } from "../src/assistant-sync/sheet";
import { csvBytes, formatSheetSize, MB, planTrim, trimNote } from "../src/assistant-sync/sheet-detail";
import {
  answerLegacyCleanup,
  checkLegacyFiles,
  DAY_MS,
  enableAssistantSync,
  runFlush,
  tabCutoffs,
  type FlushDeps,
} from "../src/assistant-sync/sync-engine";
import { FakeSheets } from "./helpers/fake-sheets";

const NOW = Date.parse("2026-10-02T16:00:00.000Z");
const MIN = 60_000;
const ZONE = "America/New_York";
const READY: StoredMemoryIds = { folderId: "folder", fileId: "file" };
const COUNT = VISIT_HEADERS.indexOf("visit_count");
const DWELL = VISIT_HEADERS.indexOf("dwell_minutes");
const TIME = VISIT_HEADERS.indexOf("time");
const LAST = VISIT_HEADERS.indexOf("last_time");
const DEVICE = VISIT_HEADERS.indexOf("device");

function visit(id: string, visitedAt: number, extra: Partial<SyncVisitRecord> = {}): SyncVisitRecord {
  return {
    id,
    visitedAt,
    title: "Vector search notes",
    url: "https://example.com/notes",
    domain: "example.com",
    dwellMinutes: 2,
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

async function enabled(sheets: FakeSheets, extra: Partial<ReturnType<typeof defaultSyncEngineState>> = {}): Promise<void> {
  await writeSyncEngineState({ ...defaultSyncEngineState(), syncEnabled: true, ...extra });
  expect((await runFlush(deps(sheets, NOW, { mode: "enable" }))).status).toBe("ready");
}

beforeEach(async () => {
  await clearAssistantSyncDatabase();
});

describe("merge rules", () => {
  it("sums dwell, keeps the deepest scroll, and moves joined rows to the row id", () => {
    const merged = mergeDailyRepeats(
      {
        visits: [
          visit("b", NOW + 30 * MIN, { dwellMinutes: 3, maxScrollPct: 90, topics: ["search"] }),
          visit("a", NOW, { dwellMinutes: null, maxScrollPct: 20 }),
          visit("c", NOW + DAY_MS),
        ],
        content: [{ id: "b", visitedAt: NOW + 30 * MIN, title: "t", url: "u", topics: [], text: "late read" }],
        searches: [],
        people: [
          { id: "a", visitedAt: NOW, name: "Ada", headline: "", company: "", profileUrl: "p", howFound: "", dwellMinutes: 1, maxScrollPct: 10 },
          { id: "b", visitedAt: NOW + 30 * MIN, name: "Ada", headline: "", company: "", profileUrl: "p", howFound: "", dwellMinutes: 2, maxScrollPct: 50 },
        ],
        companies: [],
      },
      ZONE
    );
    expect(merged.visits.map((v) => [v.id, v.visitCount])).toEqual([
      ["a", 2],
      ["c", 1],
    ]);
    expect(merged.visits[0]).toMatchObject({ dwellMinutes: 3, maxScrollPct: 90, topics: ["vector databases", "search"], memberIds: ["a", "b"] });
    expect(merged.content.map((r) => [r.id, r.text])).toEqual([["a", "late read"]]);
    expect(merged.people).toHaveLength(1);
    expect(merged.people[0]).toMatchObject({ id: "a", dwellMinutes: 3, maxScrollPct: 50 });
  });

  it("keeps the id the sheet already has, and leaves rows written separately as they are", () => {
    const visits = [visit("a", NOW), visit("b", NOW + MIN), visit("c", NOW + 2 * MIN)];
    const empty = { content: [], searches: [], people: [], companies: [] };
    expect(mergeDailyRepeats({ visits, ...empty }, ZONE, new Set(["b"])).visits.map((v) => [v.id, v.visitCount])).toEqual([["b", 3]]);
    expect(mergeDailyRepeats({ visits, ...empty }, ZONE, new Set(["a", "b"])).visits.map((v) => [v.id, v.visitCount])).toEqual([
      ["a", 2],
      ["b", 1],
    ]);
  });
});

describe("repeat visits in the sheet", () => {
  it("rewrites the existing row in place with no reads when the page is visited again", async () => {
    const sheets = new FakeSheets();
    await enabled(sheets);
    await assistantSyncDb.visits.put(visit("v1", NOW + MIN));
    await assistantSyncDb.visits.put(visit("x", NOW + 2 * MIN, { url: "https://example.com/other" }));
    await runFlush(deps(sheets, NOW + 6 * MIN));
    expect(sheets.ids("Visits")).toEqual(["v1", "x"]);

    await assistantSyncDb.visits.put(visit("v2", NOW + 20 * MIN, { dwellMinutes: 5 }));
    await assistantSyncDb.visits.put(visit("v3", NOW + 30 * MIN, { dwellMinutes: 1 }));
    const result = await runFlush(deps(sheets, NOW + 40 * MIN));
    expect(result).toMatchObject({ status: "ready", reads: 0, writes: 1 });
    expect(sheets.ids("Visits")).toEqual(["v1", "x"]);
    const row = sheets.tab("Visits")[1]!;
    expect(row[COUNT]).toBe("3");
    expect(row[DWELL]).toBe("8");
    // NOW is 12:00 in New York: the first visit was 12:01, the last 12:30.
    expect(row[TIME]).toBe("12:01");
    expect(row[LAST]).toBe("12:30");
    expect(sheets.tab("Visits")[2]?.[COUNT]).toBe("1");
    expect(await countUnsyncedVisits()).toBe(0);
    expect(sheets.tab("Daily").find((r) => r[0] === "2026-10-02")?.[2]).toBe("4");

    const quiet = await runFlush(deps(sheets, NOW + 50 * MIN));
    expect(quiet).toMatchObject({ appended: 0, writes: 0 });
  });

  it("does not duplicate a merged row when Google applied the batch but the reply was lost", async () => {
    const sheets = new FakeSheets();
    await enabled(sheets);
    await assistantSyncDb.visits.put(visit("v1", NOW + MIN));
    await runFlush(deps(sheets, NOW + 6 * MIN));
    await assistantSyncDb.visits.put(visit("v2", NOW + 10 * MIN));
    sheets.outcomes.push({ status: 503, lost: true });
    expect((await runFlush(deps(sheets, NOW + 12 * MIN))).status).toBe("error");
    const state = await readSyncEngineState();
    const retry = await runFlush(deps(sheets, state.nextAttemptAt + MIN));
    expect(retry.reads).toBe(2);
    expect(sheets.ids("Visits")).toEqual(["v1"]);
    expect(sheets.tab("Visits")[1]?.[COUNT]).toBe("2");
    expect(await countUnsyncedVisits()).toBe(0);
  });

  it("upgrades a sheet written before visit_count with one read and no duplicates", async () => {
    const sheets = new FakeSheets();
    await enabled(sheets);
    await assistantSyncDb.visits.put(visit("v1", NOW + MIN));
    await assistantSyncDb.visits.put(visit("x", NOW + 2 * MIN, { url: "https://example.com/other" }));
    await runFlush(deps(sheets, NOW + 6 * MIN));
    // What a Phase 1 install leaves behind: 11 Visits columns, no edit warning, bare sync keys, no layout schema.
    for (const row of sheets.tab("Visits")) row.length = COUNT;
    for (const tab of Object.values(sheets.protections())) tab.length = 0;
    const keys = (await assistantSyncDb.synced.toCollection().primaryKeys()).map(String);
    await assistantSyncDb.synced.clear();
    await assistantSyncDb.synced.bulkPut(keys.map((key) => ({ key })));
    const state = await readSyncEngineState();
    delete state.layout!.schema;
    await writeSyncEngineState(state);

    await assistantSyncDb.visits.put(visit("v2", NOW + 20 * MIN));
    const result = await runFlush(deps(sheets, NOW + 30 * MIN));
    expect(result).toMatchObject({ status: "ready", reads: 2, writes: 1 });
    expect(sheets.tab("Visits")[0]).toEqual([...VISIT_HEADERS]);
    expect(sheets.ids("Visits")).toEqual(["v1", "x"]);
    expect(sheets.tab("Visits")[1]?.[COUNT]).toBe("2");
    expect(sheets.tab("Visits")[1]?.[LAST]).toBe("12:20");
    // The untouched old row: one visit, so last_time is a copy of time.
    expect(sheets.tab("Visits")[2]?.[COUNT]).toBe("1");
    expect(sheets.tab("Visits")[2]?.[LAST]).toBe(sheets.tab("Visits")[2]?.[TIME]);
    expect(sheets.tab("Visits")[2]?.[DEVICE]).toBe("this device");
    expect((await readSyncEngineState()).layout?.schema).toBe(SCHEMA_VERSION);
    // The edit warning went out in that same single write, once per tab.
    expect(Object.values(sheets.protections()).every((p) => p.length === 1 && p[0] === "Managed by Bobbin")).toBe(true);
    const kinds = sheets.batches.at(-1)!.map((r) => Object.keys(r)[0]);
    expect(kinds.filter((k) => k === "addProtectedRange")).toHaveLength(6);
    expect(kinds).toContain("copyPaste");

    const next = await runFlush(deps(sheets, NOW + 40 * MIN));
    expect(next).toMatchObject({ reads: 0, writes: 0 });

    // A later startup check reads the sheet again and adds no second warning.
    const state2 = await readSyncEngineState();
    await writeSyncEngineState({ ...state2, verifyNext: true });
    await runFlush(deps(sheets, NOW + 50 * MIN));
    expect(Object.values(sheets.protections()).every((p) => p.length === 1)).toBe(true);
  });

  it("adds the device column to a schema 4 sheet: this device on every old row, one write, no read", async () => {
    const sheets = new FakeSheets();
    await enabled(sheets);
    await assistantSyncDb.visits.put(visit("v1", NOW + MIN));
    await assistantSyncDb.visits.put(visit("x", NOW + 2 * MIN, { url: "https://example.com/other" }));
    await runFlush(deps(sheets, NOW + 6 * MIN));
    // What a Phase 2 install leaves behind: Visits ends at last_time, layout schema 4.
    for (const row of sheets.tab("Visits")) row.length = DEVICE;
    const state = await readSyncEngineState();
    state.layout!.schema = 4;
    state.layout!.visitColumns = DEVICE;
    await writeSyncEngineState(state);

    await assistantSyncDb.visits.put(visit("o1", NOW + 20 * MIN, { device: "other" }));
    const result = await runFlush(deps(sheets, NOW + 30 * MIN));
    expect(result).toMatchObject({ status: "ready", reads: 0, writes: 1 });
    expect(sheets.tab("Visits")[0]).toEqual([...VISIT_HEADERS]);
    expect(sheets.tab("Visits").slice(1).map((row) => [row[0], row[DEVICE]])).toEqual([
      ["v1", "this device"],
      ["x", "this device"],
      ["o1", "other device"],
    ]);
    expect((await readSyncEngineState()).layout?.schema).toBe(SCHEMA_VERSION);
    // Protections were already there; none are added again.
    const kinds = sheets.batches.at(-1)!.map((r) => Object.keys(r)[0]);
    expect(kinds).not.toContain("addProtectedRange");
  });

  it("merges one page's visits into one row and keeps different pages apart (the one.google.com case)", () => {
    const raw = [
      "https://one.google.com/storage",
      "https://one.google.com/storage?utm_source=drive&g1_landing_page=1",
      "https://one.google.com/storage#management",
      "https://one.google.com/about/plans",
      "https://one.google.com/settings",
      "https://one.google.com/settings?hl=en",
      "https://one.google.com/storage/management",
    ];
    const visits = raw.map((u, i) => {
      const url = canonicalizeUrl(u)!;
      return visit(`g${i}`, NOW + i * MIN, { url, domain: "one.google.com" });
    });
    const merged = mergeDailyRepeats({ visits, content: [], searches: [], people: [], companies: [] }, ZONE);
    expect(merged.visits.map((v) => [v.url, v.visitCount])).toEqual([
      ["https://one.google.com/storage", 3],
      ["https://one.google.com/about/plans", 1],
      ["https://one.google.com/settings", 2],
      ["https://one.google.com/storage/management", 1],
    ]);
  });

  it("keeps this device and other device visits to the same page as separate rows", () => {
    const merged = mergeDailyRepeats(
      {
        visits: [
          visit("a", NOW),
          visit("b", NOW + MIN),
          visit("o1", NOW + 2 * MIN, { device: "other", dwellMinutes: null }),
          visit("o2", NOW + 3 * MIN, { device: "other", dwellMinutes: null }),
        ],
        content: [],
        searches: [],
        people: [],
        companies: [],
      },
      ZONE
    );
    expect(merged.visits.map((v) => [v.id, v.device ?? "this", v.visitCount])).toEqual([
      ["a", "this", 2],
      ["o1", "other", 2],
    ]);
  });
});

describe("sheet detail", () => {
  it("compact keeps 14 days of Pages docs, 30 days of rows, and Daily for retention", async () => {
    const sheets = new FakeSheets();
    await enabled(sheets, { sheetDetail: "compact", retentionDays: 90 });
    const long = "word ".repeat(300).trim();
    for (const days of [1, 10, 20, 40]) {
      const at = NOW - days * DAY_MS;
      const id = `d${days}`;
      await assistantSyncDb.visits.put(visit(id, at, { url: `https://example.com/${id}` }));
      await assistantSyncDb.content.put({ id, visitedAt: at, title: id, url: `https://example.com/${id}`, topics: [], text: long });
    }
    await runFlush(deps(sheets, NOW + 6 * MIN));
    expect(sheets.ids("Visits")).toEqual(["d20", "d10", "d1"]);
    expect(await assistantSyncDb.visits.get("d40")).toBeUndefined();
    expect((await assistantSyncDb.content.toArray()).map((row) => row.id).sort()).toEqual(["d1", "d10"]);
    const pages = VISIT_HEADERS.indexOf("pages_doc");
    expect(sheets.tab("Visits").slice(1).map((row) => row[pages])).toEqual([
      "",
      "Bobbin Pages 2026-09-22 Tuesday#d10",
      "Bobbin Pages 2026-10-01 Thursday#d1",
    ]);
    const folder = (await readSyncEngineState()).pagesFolderId;
    expect(sheets.docsIn(folder).map((doc) => doc.name).sort()).toEqual([
      "Bobbin Pages 2026-09-22 Tuesday",
      "Bobbin Pages 2026-10-01 Thursday",
    ]);

    const cut = tabCutoffs(NOW, ZONE, 90, "compact");
    expect(cut.Daily < cut.Visits).toBe(true);
    expect(cut.Pages > cut.Visits).toBe(true);
    const state = await readSyncEngineState();
    expect(state.sheetBytes).toBeGreaterThan(0);
    expect(sheets.tab("About")[4]?.[0]).toMatch(/^Sheet size: \d+ KB\. Rows: 3 visits, 0 searches/);
    expect(sheets.tab("About").some((row) => row[0]?.includes("Pages docs are kept for the last 14 days"))).toBe(true);
  });

  it("standard keeps Pages docs for the full retention", () => {
    const cut = tabCutoffs(NOW, ZONE, 90, "standard");
    expect(cut.Visits).toBe(cut.Daily);
    expect(cut.Pages).toBe(cut.Visits);
  });
});

describe("enable and older files", () => {
  const enableInput = (sheets: FakeSheets, choice?: "restore" | "create") => ({
    api: sheets,
    ids: READY,
    now: NOW,
    timeZone: ZONE,
    history: [],
    saveIds: async () => undefined,
    random: () => 0,
    choice,
  });

  it("stops to ask when the sheet is in the trash, and restores it on the answer", async () => {
    const sheets = new FakeSheets();
    sheets.files.get("file")!.trashed = true;
    const asked = await enableAssistantSync(enableInput(sheets));
    expect(asked).toEqual({ confirm: "trashed" });
    expect((await readSyncEngineState()).syncEnabled).toBe(false);
    expect(sheets.creates).toBe(0);

    const done = await enableAssistantSync(enableInput(sheets, "restore"));
    expect("flush" in done && done.flush.status).toBe("ready");
    expect(sheets.files.get("file")?.trashed).toBe(false);
    expect(sheets.creates).toBe(0);
  });

  it("checks once for old backups and archives, and trashes them only after the user says so", async () => {
    const sheets = new FakeSheets();
    sheets.files.set("b", { name: "Cortex Memory Backup.json", trashed: false, parent: "folder" });
    await enabled(sheets);
    await checkLegacyFiles(sheets, READY);
    await checkLegacyFiles(sheets, READY);
    expect(sheets.lists).toBe(1);
    expect(await readSyncEngineState()).toMatchObject({ legacyCleanup: "ask", legacyFiles: [{ id: "b", name: "Cortex Memory Backup.json" }] });
    expect(sheets.files.get("b")?.trashed).toBe(false);

    await answerLegacyCleanup(sheets, "trash");
    expect(sheets.files.get("b")?.trashed).toBe(true);
    expect((await readSyncEngineState()).legacyCleanup).toBe("trashed");
  });

  it("remembers Keep them and never asks again", async () => {
    const sheets = new FakeSheets();
    sheets.files.set("a", { name: "Cortex Memory Archive 2026-08", trashed: false, parent: "folder" });
    await enabled(sheets);
    await checkLegacyFiles(sheets, READY);
    await answerLegacyCleanup(null, "keep");
    await checkLegacyFiles(sheets, READY);
    expect(await readSyncEngineState()).toMatchObject({ legacyCleanup: "kept", legacyFiles: [] });
    expect(sheets.files.get("a")?.trashed).toBe(false);
    expect(sheets.lists).toBe(1);
  });
});

describe("size budget", () => {
  it("trims Visits first, never today, and other tabs only past the hard cap", () => {
    const day = (n: number) => `2026-10-0${n}`;
    const sizes = (per: number) => new Map([1, 2, 3].map((n) => [day(n), per]));
    const target = planTrim({
      bytes: 1000,
      targetBytes: 600,
      hardCapBytes: 5000,
      today: day(3),
      bytesByDate: { Visits: sizes(200), Searches: sizes(100) },
    });
    // Visits days 1 and 2 free 400.
    expect(target.cutoffs).toEqual({ Visits: day(3) });
    expect(target.bytes).toBe(600);

    const capped = planTrim({
      bytes: 9 * MB,
      targetBytes: 3 * MB,
      today: day(3),
      bytesByDate: { Searches: new Map([[day(1), 2 * MB]]) },
    });
    expect(capped.cutoffs).toEqual({ Searches: day(2) });
    expect(trimNote(target.cutoffs, 600 * 1024)).toBe(
      "Kept the sheet under 600 KB by removing Visits before 2026-10-03."
    );
  });

  it("measures the sheet as CSV bytes", () => {
    expect(csvBytes([["a", "b,c"], ['say "hi"']])).toBe("a,\"b,c\"\n".length + '"say ""hi"""\n'.length);
    expect(formatSheetSize(3 * MB)).toBe("3 MB");
    expect(formatSheetSize(1.25 * MB)).toBe("1.3 MB");
    expect(formatSheetSize(2048)).toBe("2 KB");
  });
});
