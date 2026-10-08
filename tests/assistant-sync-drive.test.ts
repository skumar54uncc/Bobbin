import { describe, expect, it } from "vitest";
import {
  createMemoryFile,
  DRIVE_FILE_SCOPE,
  FetchDriveApi,
  googleStatus,
  inspectMemory,
  reenableMemory,
  trashMemory,
} from "../src/assistant-sync/drive-api";
import {
  appendCellsRequest,
  appendRuns,
  dailyRowIndex,
  deleteRowsRequest,
  rowCount,
  runsFromDates,
  staleRanges,
  updateCellsRequest,
} from "../src/assistant-sync/flush-plan";
import { buildSeed, SEED_DAYS, SEED_VISITS_PER_WEEKDAY } from "../src/assistant-sync/seed";
import {
  CELL_WARN_AT,
  cellWarning,
  headerFormatRequests,
  LIVE_FOLDER_NAME,
  SHEET_TABS,
  VISIT_HEADERS,
} from "../src/assistant-sync/sheet";
import { FakeSheets } from "./helpers/fake-sheets";

describe("sheet layout", () => {
  it("builds the seven tabs in order with text dates and schema version 3", () => {
    expect(SEED_DAYS).toBe(90);
    expect(SEED_VISITS_PER_WEEKDAY).toBe(150);
    const { workbook, needles } = buildSeed({ days: 12, visitsPerWeekday: 2, now: Date.parse("2026-10-02T16:00:00.000Z") });
    expect(workbook.title).toBe("Cortex Memory Seed");
    expect(workbook.tabs.map((tab) => tab.title)).toEqual([...SHEET_TABS]);
    expect(workbook.tabs[0]?.rows[0]).toEqual(["Cortex Memory"]);
    expect(workbook.tabs[0]?.rows.at(-1)).toEqual(["schema_version: 3"]);
    const about = (workbook.tabs[0]?.rows ?? []).map((row) => row[0] ?? "");
    expect(about[1]).toMatch(/^Coverage: .* Last synced: /);
    expect(about).toContain("Questions");
    expect(about.some((line) => line.startsWith("This is the user's only browsing memory file"))).toBe(true);
    expect(about.some((line) => /archive|JSON backup/i.test(line))).toBe(false);
    expect(about.some((line) => line.includes("Who did I look up on LinkedIn?"))).toBe(true);
    expect(workbook.tabs[1]?.rows[0]).toEqual([...VISIT_HEADERS]);
    const dates = workbook.tabs[1]?.rows.slice(1).map((row) => row[1]) ?? [];
    expect(dates.every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date ?? ""))).toBe(true);
    const ids = workbook.tabs.flatMap((tab) => tab.rows.slice(1).map((row) => row[0]));
    for (const needle of needles) expect(ids).toContain(needle);
    expect(cellWarning(CELL_WARN_AT)).toContain("10 million");
    expect(cellWarning(10)).toBeNull();
    expect(headerFormatRequests()).toHaveLength(14);
  });
});

describe("flush plan", () => {
  it("tracks row positions by date so retention needs no reads", () => {
    const runs = runsFromDates(["2026-06-01", "2026-06-01", "2026-09-15", "2026-06-02", "2026-10-01"]);
    expect(rowCount(runs)).toBe(5);
    const { ranges, kept } = staleRanges(runs, "2026-07-04");
    // Sheet rows 1-2 and 4 hold old dates. Ranges go bottom first so indexes stay valid.
    expect(ranges).toEqual([
      { startIndex: 4, endIndex: 5 },
      { startIndex: 1, endIndex: 3 },
    ]);
    expect(kept).toEqual([
      { date: "2026-09-15", count: 1 },
      { date: "2026-10-01", count: 1 },
    ]);
    expect(appendRuns(kept, ["2026-10-01", "2026-10-02"])).toEqual([
      { date: "2026-09-15", count: 1 },
      { date: "2026-10-01", count: 2 },
      { date: "2026-10-02", count: 1 },
    ]);
    expect(dailyRowIndex(kept, "2026-10-01")).toBe(2);
    expect(dailyRowIndex(kept, "2026-01-01")).toBeNull();
  });

  it("writes cells as plain strings so Sheets keeps dates as text", () => {
    const append = appendCellsRequest(3, [["v1", "2026-10-01"]]) as {
      appendCells: { sheetId: number; rows: { values: { userEnteredValue: { stringValue: string } }[] }[]; fields: string };
    };
    expect(append.appendCells.sheetId).toBe(3);
    expect(append.appendCells.fields).toBe("userEnteredValue");
    expect(append.appendCells.rows[0]?.values[1]?.userEnteredValue).toEqual({ stringValue: "2026-10-01" });
    expect(updateCellsRequest(0, 0, [["About"]])).toMatchObject({
      updateCells: { start: { sheetId: 0, rowIndex: 0, columnIndex: 0 } },
    });
    expect(deleteRowsRequest(1, { startIndex: 2, endIndex: 4 })).toEqual({
      deleteDimension: { range: { sheetId: 1, dimension: "ROWS", startIndex: 2, endIndex: 4 } },
    });
  });
});

describe("drive memory", () => {
  it("trashes the folder and re-enables into a fresh folder", async () => {
    const api = new FakeSheets(false);
    const created = await createMemoryFile(api, "Cortex Memory");
    expect(created.folderId && api.files.get(created.folderId)?.name).toBe(LIVE_FOLDER_NAME);
    expect(await inspectMemory(api, created)).toBe("ready");
    await trashMemory(api, created);
    expect(await inspectMemory(api, created)).toBe("trashed");
    const fresh = await reenableMemory(api, created);
    expect(fresh.fileId).not.toBe(created.fileId);
    expect(fresh.folderId).not.toBe(created.folderId);
    expect(api.files.get(created.fileId ?? "")?.trashed).toBe(true);
    expect(await reenableMemory(api, fresh)).toEqual(fresh);
  });

  it("sends one batchUpdate per call and reads with two requests", async () => {
    const calls: { method: string; url: string; body: string }[] = [];
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ method: init?.method ?? "GET", url, body: String(init?.body ?? "") });
      if (url.includes("/missing")) return new Response("{}", { status: 404 });
      if (url.includes("values:batchGet")) {
        return Response.json({ valueRanges: [{ values: [["id", "date"], ["v1", "2026-10-01"]] }, {}] });
      }
      if (url.includes("fields=sheets.properties")) {
        return Response.json({ sheets: [{ properties: { sheetId: 0, title: "About" } }, { properties: { sheetId: 1, title: "Visits" } }] });
      }
      if (url.endsWith("/spreadsheets") && init?.method === "POST") return Response.json({ spreadsheetId: "sheet-1" });
      return Response.json({ id: "folder-1" });
    };
    const api = new FetchDriveApi("token", fetchImpl);
    expect(await api.getFile("missing")).toBeNull();
    expect(await api.createSpreadsheet("Cortex Memory", "folder-1")).toBe("sheet-1");

    calls.length = 0;
    await api.batchUpdate("sheet-1", [appendCellsRequest(1, [["v2", "2026-10-02"]])]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toMatch(/spreadsheets\/sheet-1:batchUpdate$/);
    expect(JSON.parse(calls[0]!.body).requests).toHaveLength(1);
    await api.batchUpdate("sheet-1", []);
    expect(calls).toHaveLength(1);

    expect(await api.getSheetIds("sheet-1")).toEqual({ About: 0, Visits: 1 });
    expect(await api.readColumns("sheet-1", ["Visits!A:B", "Daily!A:A"])).toEqual([
      [
        ["id", "date"],
        ["v1", "2026-10-01"],
      ],
      [],
    ]);
    expect(calls).toHaveLength(3);
    expect(DRIVE_FILE_SCOPE).toBe("https://www.googleapis.com/auth/drive.file");
  });

  it("rejects a Google reply with an unexpected shape", async () => {
    const api = new FetchDriveApi("token", async () => Response.json({ sheets: [{ properties: { title: 4 } }] }));
    await expect(api.getSheetIds("x")).rejects.toThrow("google_bad_response");
  });

  it("reads the HTTP status from Google errors", async () => {
    const api = new FetchDriveApi("token", async () => new Response("{}", { status: 429 }));
    const error = await api.batchUpdate("x", [{}]).catch((e: unknown) => e);
    expect(googleStatus(error)).toBe(429);
    expect(googleStatus(new Error("other"))).toBeNull();
  });
});
