import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "../src/db/schema";
import { addReadingTime, applyDwellReport, readingTimeFor, type DwellLedger } from "../src/lib/reading-time";
import { formatReadingTime } from "../src/shared/reading-time-format";

const URL_A = "https://example.com/a";

async function addPage(url: string, visits: number[]): Promise<void> {
  await db.documents.add({ url, domain: "example.com", title: "A", summary: "", lastVisitedAt: Math.max(...visits), visitCount: visits.length, importanceScore: 0.1 });
  for (const visitedAt of visits) {
    await db.visitLog.add({ url, title: "A", hostname: "example.com", visitedAt, textLength: 10 });
  }
}

beforeEach(async () => {
  await db.documents.clear();
  await db.visitLog.clear();
});

describe("formatReadingTime", () => {
  it("leaves very short reads out and words the rest plainly", () => {
    expect(formatReadingTime(undefined)).toBe("");
    expect(formatReadingTime(4_999)).toBe("");
    expect(formatReadingTime(20_000)).toBe("Read under a minute");
    expect(formatReadingTime(4 * 60_000)).toBe("Read 4 min");
    expect(formatReadingTime(80 * 60_000)).toBe("Read 1 h 20 min");
    expect(formatReadingTime(120 * 60_000)).toBe("Read 2 h");
  });
});

describe("addReadingTime", () => {
  it("adds to the page and to its latest visit only", async () => {
    await addPage(URL_A, [100, 200]);
    expect(await addReadingTime(URL_A, 30_000)).toBe(true);
    expect(await addReadingTime(URL_A, 15_000)).toBe(true);
    expect((await db.documents.where("url").equals(URL_A).first())?.readMs).toBe(45_000);
    const visits = await db.visitLog.orderBy("visitedAt").toArray();
    expect(visits.map((v) => v.readMs)).toEqual([undefined, 45_000]);
    expect((await readingTimeFor([URL_A, "https://example.com/none"])).get(URL_A)).toBe(45_000);
  });

  it("returns false for a page that is not in the library", async () => {
    expect(await addReadingTime("https://example.com/missing", 10_000)).toBe(false);
  });

  it("does not trust a large jump from one report", async () => {
    await addPage(URL_A, [100]);
    await addReadingTime(URL_A, 3 * 3_600_000);
    expect((await db.documents.where("url").equals(URL_A).first())?.readMs).toBe(5 * 60_000);
  });
});

describe("applyDwellReport", () => {
  it("counts each second once across running-total reports", async () => {
    const add = vi.fn(async (_url: string, _ms: number) => true);
    const ledger: DwellLedger = {};
    await applyDwellReport(ledger, 1, { url: URL_A, activeMs: 15_000, final: false }, add);
    await applyDwellReport(ledger, 1, { url: URL_A, activeMs: 15_000, final: false }, add);
    await applyDwellReport(ledger, 1, { url: URL_A, activeMs: 40_000, final: true }, add);
    expect(add.mock.calls.map((c) => c[1])).toEqual([15_000, 25_000]);
    expect(ledger).toEqual({});
  });

  it("keeps time for a page that is not indexed yet and adds it once the page is there", async () => {
    let indexed = false;
    const add = vi.fn(async (_url: string, _ms: number) => indexed);
    const ledger: DwellLedger = {};
    await applyDwellReport(ledger, 1, { url: URL_A, activeMs: 15_000, final: false }, add);
    indexed = true;
    await applyDwellReport(ledger, 1, { url: URL_A, activeMs: 30_000, final: false }, add);
    expect(add.mock.calls.map((c) => c[1])).toEqual([15_000, 30_000]);
    expect(ledger[1]).toEqual({ url: URL_A, applied: 30_000 });
  });

  it("starts over when the tab moves to another page", async () => {
    const add = vi.fn(async (_url: string, _ms: number) => true);
    const ledger: DwellLedger = {};
    await applyDwellReport(ledger, 1, { url: URL_A, activeMs: 20_000, final: false }, add);
    await applyDwellReport(ledger, 1, { url: "https://example.com/b", activeMs: 5_000, final: false }, add);
    expect(add.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      [URL_A, 20_000],
      ["https://example.com/b", 5_000],
    ]);
  });
});
