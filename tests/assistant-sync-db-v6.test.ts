// @vitest-environment jsdom
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { samePage } from "../src/assistant-sync/canonical-url";
import { isCortexOwnFile } from "../src/assistant-sync/denylist";

describe("local database version 6", () => {
  it("turns excerpts into page text, re-keys their warnings, and drops Content sync keys", async () => {
    const old = new Dexie("cortex-assistant-sync");
    old.version(5).stores({
      visits: "id, visitedAt, domain, finalizedAt",
      content: "id, visitedAt",
      searches: "id, visitedAt",
      people: "id, visitedAt",
      companies: "id, visitedAt",
      synced: "key",
      pending: "key, tab, enqueuedAt",
      state: "id",
      drafts: "id",
      inflight: "id",
      warnings: "key, visitId, at",
    });
    await old.open();
    await old.table("content").put({ id: "v1", visitedAt: 1, title: "T", url: "https://example.com/", topics: [], excerpt: "Old excerpt." });
    await old.table("warnings").put({ key: "v1:excerpt", visitId: "v1", at: 1, field: "excerpt", sample: "ignore previous" });
    await old.table("synced").bulkPut([
      { key: "Content:v1", row: 2, sig: "a" },
      { key: "Visits:v1", row: 2, sig: "b" },
    ]);
    old.close();

    const { assistantSyncDb } = await import("../src/assistant-sync/db");
    const row = await assistantSyncDb.content.get("v1");
    expect(row?.text).toBe("Old excerpt.");
    expect(row).not.toHaveProperty("excerpt");
    expect(await assistantSyncDb.warnings.toArray()).toEqual([
      { key: "v1:text", visitId: "v1", at: 1, field: "text", sample: "ignore previous" },
    ]);
    expect((await assistantSyncDb.synced.toArray()).map((s) => s.key)).toEqual(["Visits:v1"]);
    expect(await assistantSyncDb.posts.count()).toBe(0);
    expect(await assistantSyncDb.pagesDocs.count()).toBe(0);
  });
});

describe("own files and dwell matching", () => {
  it("never records a Pages doc or the Pages folder", () => {
    expect(isCortexOwnFile("https://docs.google.com/document/d/abc/edit", "Cortex Pages 2026-10-08 Thursday - Google Docs")).toBe(true);
    expect(isCortexOwnFile("https://drive.google.com/drive/folders/pf1", "Pages - Google Drive", { pagesFolderId: "pf1" })).toBe(true);
    expect(isCortexOwnFile("https://docs.google.com/document/d/abc/edit", "Cortex Pages notes - Google Docs")).toBe(false);
  });

  it("matches a dwell report to its visit across hash, tracking key, and trailing slash changes", () => {
    expect(samePage("https://www.linkedin.com/in/mira/", "https://www.linkedin.com/in/mira/?trk=x#about")).toBe(true);
    expect(samePage("https://example.com/a", "https://example.com/b")).toBe(false);
  });
});
