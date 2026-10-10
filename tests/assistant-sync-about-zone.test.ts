import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { assistantSyncDb, clearAssistantSyncDatabase, defaultSyncEngineState, writeSyncEngineState } from "../src/assistant-sync/db";
import { runFlush, type FlushDeps } from "../src/assistant-sync/sync-engine";
import { FakeSheets } from "./helpers/fake-sheets";

const NOW = Date.parse("2026-10-08T19:30:00.000Z");
const ZONE = "America/New_York";

function deps(sheets: FakeSheets, now: number, mode: FlushDeps["mode"] = "scheduled"): FlushDeps {
  return { api: sheets, ids: { folderId: "folder", fileId: "file" }, now, timeZone: ZONE, mode, random: () => 0 };
}

beforeEach(async () => {
  await clearAssistantSyncDatabase();
  await writeSyncEngineState({ ...defaultSyncEngineState(), syncEnabled: true });
});

describe("About names the user's IANA time zone", () => {
  it("writes Last checked, Last new activity, and the dates rule in the user's zone", async () => {
    const sheets = new FakeSheets();
    expect((await runFlush(deps(sheets, NOW - 60_000, "enable"))).status).toBe("ready");
    await assistantSyncDb.visits.put({
      id: "a",
      visitedAt: NOW,
      title: "Grid storage",
      url: "https://example.com/a",
      domain: "example.com",
      dwellMinutes: 2,
      maxScrollPct: 50,
      pageType: "Article",
      topics: [],
      finalizedAt: NOW,
    });
    await runFlush(deps(sheets, NOW + 5 * 60_000));
    const about = sheets.tab("About").map((row) => row[0] ?? "");
    // 19:35 UTC is 15:35 in New York on this date.
    expect(about.find((line) => line.startsWith("Last checked:"))).toMatch(/^Last checked: 2026-10-08 15:35 America\/New_York\./);
    expect(about.find((line) => line.startsWith("Last new activity:"))).toMatch(/^Last new activity: 2026-10-08 15:30 America\/New_York\./);
    expect(about.some((line) => line.startsWith(`Dates and times are ${ZONE}.`))).toBe(true);
    expect(about.join("\n")).not.toMatch(/\bUTC\b/);
    expect(sheets.tab("Visits")[1]?.[3]).toBe("15:30");
  });

  it("takes the zone from the browser, not a fixed value", () => {
    const runtime = readFileSync("src/assistant-sync/runtime.ts", "utf8");
    expect(runtime).toMatch(/Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/);
  });
});
