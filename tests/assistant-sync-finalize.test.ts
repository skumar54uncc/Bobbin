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

  it("saves page text after 20 seconds on screen and focused", async () => {
    await openVisit("long");
    expect(await finalizeVisit("long", { activeMs: 20_000, maxScrollPct: 5 }, NOW + 60_000)).toBe("final");
    const row = await assistantSyncDb.visits.get("long");
    expect(row).toMatchObject({ dwellMinutes: 0.3, maxScrollPct: 5, finalizedAt: NOW + 60_000 });
    const content = await assistantSyncDb.content.get("long");
    expect(content?.text).toContain("pgvector");
    expect(content?.text.length).toBeLessThanOrEqual(4000);
    expect(await assistantSyncDb.drafts.get("long")).toBeUndefined();
  });

  it("saves page text after a 30% scroll, however brief", async () => {
    await openVisit("skim");
    await finalizeVisit("skim", { activeMs: 6_000, maxScrollPct: 30 }, NOW + 10_000);
    expect((await assistantSyncDb.content.get("skim"))?.text).toContain("pgvector");
  });

  it("saves no text just under both thresholds", async () => {
    await openVisit("brief");
    await finalizeVisit("brief", { activeMs: 19_999, maxScrollPct: 29 }, NOW + 30_000);
    expect((await assistantSyncDb.visits.get("brief"))?.dwellMinutes).toBe(0.3);
    expect(await assistantSyncDb.content.get("brief")).toBeUndefined();
  });

  it("saves no text when the tab never reported", async () => {
    await openVisit("quiet");
    await finalizeVisit("quiet", { activeMs: null, maxScrollPct: null }, NOW + 30_000);
    expect(await assistantSyncDb.content.get("quiet")).toBeUndefined();
  });

  it("keeps no page text for a feed or a search results page", async () => {
    await openVisit("feed", "https://www.linkedin.com/feed/");
    await finalizeVisit("feed", { activeMs: 120_000, maxScrollPct: 90 }, NOW + 130_000);
    expect(await assistantSyncDb.content.get("feed")).toBeUndefined();
    await openVisit("serp", "https://www.google.com/search?q=pgvector");
    await finalizeVisit("serp", { activeMs: 120_000, maxScrollPct: 90 }, NOW + 130_000);
    expect(await assistantSyncDb.content.get("serp")).toBeUndefined();
  });

  it("saves an opened profile's labeled fields however short the visit", async () => {
    const result = await captureFinalizedVisit({
      id: "prof",
      url: "https://www.linkedin.com/in/mira-okafor/",
      title: "Mira Okafor | LinkedIn",
      visitedAt: NOW,
      dwellMinutes: null,
      maxScrollPct: null,
      pageText: "photo caption, message button, mira@example.com",
      pageEmbedding: null,
      hasPasswordInput: false,
      userDenylist: [],
      referrer: null,
      linkedInDocument: null,
      linkedInFields: {
        kind: "person",
        name: "Mira Okafor",
        headline: "Staff engineer at Tidora",
        company: "Tidora",
        profileUrl: "https://www.linkedin.com/in/mira-okafor/",
        location: "Oakland, California",
        about: "I build search. Reach me at mira@example.com.",
        experience: [{ title: "Staff engineer", company: "Tidora", dates: "Jan 2023 - Present" }],
        education: ["UC Berkeley, BS Computer Science"],
      },
      syncEnabled: true,
      open: true,
    });
    expect(result.stored).toBe(true);
    await finalizeVisit("prof", { activeMs: 8_000, maxScrollPct: 10 }, NOW + 10_000);
    const content = await assistantSyncDb.content.get("prof");
    expect(content?.text).toBe("");
    expect(content?.profile).toEqual({
      headline: "Staff engineer at Tidora",
      location: "Oakland, California",
      about: "I build search. Reach me at [redacted].",
      experience: [{ title: "Staff engineer", company: "Tidora", dates: "Jan 2023 - Present" }],
      education: ["UC Berkeley, BS Computer Science"],
    });
    expect((await assistantSyncDb.people.get("prof"))?.dwellMinutes).toBe(0.1);
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
