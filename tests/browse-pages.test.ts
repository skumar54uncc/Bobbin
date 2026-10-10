import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db/schema";
import { browsePages, siteKey } from "../src/lib/browse-pages";

const DAY = 86_400_000;
const today = new Date(2026, 9, 6).getTime();

async function page(url: string, title: string, lastVisitedAt: number, visits: number[], text = ""): Promise<void> {
  const id = (await db.documents.add({
    url,
    domain: new URL(url).hostname,
    title,
    summary: "",
    lastVisitedAt,
    visitCount: visits.length,
    importanceScore: 0,
  })) as number;
  await db.chunks.add({ documentId: id, ord: 0, text } as never);
  for (const at of visits) {
    await db.visitLog.add({ url, title, hostname: new URL(url).hostname, visitedAt: at, textLength: 10 });
  }
}

describe("browsePages", () => {
  beforeEach(async () => {
    await Promise.all([db.documents.clear(), db.chunks.clear(), db.visitLog.clear()]);
    await page("https://www.linkedin.com/in/mira", "Mira Okafor", today + 3 * 3600_000, [today - 5 * DAY, today + 3 * 3600_000], "Founder at Atlas");
    await page("https://example.com/old", "Old read", today - 3 * DAY, [today - 3 * DAY], "rockets and engines");
    await page("https://example.com/new", "New read", today + 9 * 3600_000, [today + 9 * 3600_000], "Atlas rockets");
  });

  it("lists today's pages newest first, including a revisit of an older page", async () => {
    const { hits } = await browsePages({ from: today, to: today + DAY - 1 });
    expect(hits.map((h) => h.title)).toEqual(["New read", "Mira Okafor"]);
  });

  it("filters by site and by exact phrase", async () => {
    expect((await browsePages({ site: "https://LinkedIn.com/feed" })).hits.map((h) => h.title)).toEqual(["Mira Okafor"]);
    const { hits } = await browsePages({ exact: "Atlas rockets" });
    expect(hits.map((h) => h.title)).toEqual(["New read"]);
    expect(hits[0]!.snippet).toContain("Atlas rockets");
  });

  it("explains an empty range", async () => {
    const res = await browsePages({ from: today - 30 * DAY, to: today - 20 * DAY });
    expect(res.hits).toEqual([]);
    expect(res.evidence).toMatch(/Nothing saved in this range/);
  });

  it("reads a bare host from what was typed", () => {
    expect(siteKey("https://www.LinkedIn.com/feed")).toBe("linkedin.com");
  });
});
