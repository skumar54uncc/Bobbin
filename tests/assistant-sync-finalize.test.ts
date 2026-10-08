import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { captureFinalizedVisit } from "../src/assistant-sync/capture";
import { assistantSyncDb, clearAssistantSyncDatabase } from "../src/assistant-sync/db";
import { finalizeAbandoned, finalizeVisit } from "../src/assistant-sync/finalize";

const NOW = Date.parse("2026-10-02T16:00:00.000Z");
const TEXT = Array.from({ length: 40 }, (_, i) => `Sentence ${i} explains how pgvector stores embeddings in Postgres.`).join(" ");

async function openVisit(id: string, url = `https://example.com/${id}`): Promise<void> {
  const result = await captureFinalizedVisit({
    id,
    url,
    title: `Title ${id}`,
    visitedAt: NOW,
    dwellMinutes: null,
    maxScrollPct: null,
    pageText: TEXT,
    pageEmbedding: null,
    hasPasswordInput: false,
    userDenylist: [],
    referrer: null,
    linkedInDocument: null,
    linkedInFields: null,
    syncEnabled: true,
    open: true,
  });
  expect(result.stored).toBe(true);
}

beforeEach(async () => {
  await clearAssistantSyncDatabase();
});

describe("visit finalization", () => {
  it("keeps an open visit out of the sheet and holds its text locally", async () => {
    await openVisit("v1");
    const row = await assistantSyncDb.visits.get("v1");
    expect(row?.finalizedAt).toBeUndefined();
    expect((await assistantSyncDb.drafts.get("v1"))?.text).toContain("pgvector");
    expect(await assistantSyncDb.content.count()).toBe(0);
  });

  it("drops visits under 5 seconds", async () => {
    await openVisit("short");
    expect(await finalizeVisit("short", { activeMs: 4_999, maxScrollPct: 10 }, NOW + 5_000)).toBe("dropped");
    expect(await assistantSyncDb.visits.get("short")).toBeUndefined();
    expect(await assistantSyncDb.drafts.get("short")).toBeUndefined();
  });

  it("writes measured dwell and the excerpt after a read of 5 minutes or more", async () => {
    await openVisit("long");
    expect(await finalizeVisit("long", { activeMs: 6 * 60_000, maxScrollPct: 72.4 }, NOW + 7 * 60_000)).toBe("final");
    const row = await assistantSyncDb.visits.get("long");
    expect(row).toMatchObject({ dwellMinutes: 6, maxScrollPct: 72, finalizedAt: NOW + 7 * 60_000 });
    const content = await assistantSyncDb.content.get("long");
    expect(content?.excerpt).toContain("pgvector");
    expect(await assistantSyncDb.drafts.get("long")).toBeUndefined();
  });

  it("writes no excerpt for a short read", async () => {
    await openVisit("brief");
    await finalizeVisit("brief", { activeMs: 90_000, maxScrollPct: 20 }, NOW + 2 * 60_000);
    expect((await assistantSyncDb.visits.get("brief"))?.dwellMinutes).toBe(1.5);
    expect(await assistantSyncDb.content.get("brief")).toBeUndefined();
  });

  it("keeps dwell blank when the tab never reported", async () => {
    await openVisit("silent");
    await finalizeVisit("silent", { activeMs: null, maxScrollPct: null }, NOW + 60_000);
    const row = await assistantSyncDb.visits.get("silent");
    expect(row?.finalizedAt).toBe(NOW + 60_000);
    expect(row?.dwellMinutes).toBeNull();
  });

  it("does not reopen a finished visit when the page is indexed again", async () => {
    await openVisit("again");
    await finalizeVisit("again", { activeMs: 20_000, maxScrollPct: 30 }, NOW + 60_000);
    const retry = await captureFinalizedVisit({
      id: "again",
      url: "https://example.com/again",
      title: "Title again",
      visitedAt: NOW + 61_000,
      dwellMinutes: null,
      maxScrollPct: null,
      pageText: TEXT,
      pageEmbedding: null,
      hasPasswordInput: false,
      userDenylist: [],
      referrer: null,
      linkedInDocument: null,
      linkedInFields: null,
      syncEnabled: true,
      open: true,
    });
    expect(retry.stored).toBe(false);
    expect((await assistantSyncDb.visits.get("again"))?.finalizedAt).toBe(NOW + 60_000);
  });

  it("ends rows left open by a browser restart", async () => {
    await openVisit("left");
    await openVisit("current");
    const ended = await finalizeAbandoned(new Set(["current"]), NOW + 1, NOW + 60_000);
    expect(ended).toBe(1);
    expect((await assistantSyncDb.visits.get("left"))?.finalizedAt).toBe(NOW + 60_000);
    expect((await assistantSyncDb.visits.get("current"))?.finalizedAt).toBeUndefined();
  });
});
