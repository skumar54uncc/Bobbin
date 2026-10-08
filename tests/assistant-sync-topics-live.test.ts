import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import fixtureFile from "../eval/queries/topic-fixture-embeddings.json";
import { TOPIC_FIXTURES } from "../eval/queries/topic-fixtures";
import { topicText } from "../src/assistant-sync/capture";
import { assistantSyncDb, clearAssistantSyncDatabase, defaultSyncEngineState, writeSyncEngineState } from "../src/assistant-sync/db";
import { captureVisitFromChrome } from "../src/assistant-sync/runtime";

const NOW = Date.parse("2026-10-08T15:00:00.000Z");
const TESLA = TOPIC_FIXTURES.find((f) => f.id === "tesla")!;
/** all-MiniLM-L6-v2 vector of the fixture text, saved by eval/src/tune-topics.ts. */
const TESLA_VECTOR = fixtureFile.cases.find((c) => c.id === "tesla")!.vector;

beforeEach(async () => {
  await clearAssistantSyncDatabase();
  await writeSyncEngineState({ ...defaultSyncEngineState(), syncEnabled: true });
});

describe("topics on live captured visits", () => {
  it("tags a live captured article with at least one topic from its on-device embedding", async () => {
    const embedded: string[] = [];
    const embed = async (text: string) => {
      embedded.push(text);
      return text.includes(TESLA.text) ? TESLA_VECTOR : null;
    };
    const result = await captureVisitFromChrome(
      {
        id: "doc:1:1",
        url: "https://example.com/news/tesla-deliveries?utm_source=x",
        title: "Tesla deliveries",
        visitedAt: NOW,
        pageText: TESLA.text,
        open: true,
      },
      embed
    );
    expect(result.stored).toBe(true);
    expect(embedded).toEqual([topicText("Tesla deliveries", TESLA.text)]);
    const row = await assistantSyncDb.visits.get("doc:1:1");
    expect(row?.topics.length).toBeGreaterThanOrEqual(1);
    expect(row?.topics).toContain("Tesla");
  });

  it("keeps the topics when the same visit is read again without page text", async () => {
    const embed = async (text: string) => (text.includes(TESLA.text) ? TESLA_VECTOR : null);
    const base = { id: "doc:2:1", url: "https://example.com/tesla", title: "Tesla deliveries", visitedAt: NOW, open: true };
    await captureVisitFromChrome({ ...base, pageText: TESLA.text }, embed);
    await captureVisitFromChrome({ ...base, pageText: null }, embed);
    expect((await assistantSyncDb.visits.get("doc:2:1"))?.topics).toContain("Tesla");
  });

  it("does not embed a page it will not store", async () => {
    let calls = 0;
    const embed = async () => {
      calls += 1;
      return TESLA_VECTOR;
    };
    await captureVisitFromChrome(
      { id: "bank", url: "https://www.chase.com/login", title: "Chase", visitedAt: NOW, pageText: TESLA.text, open: true },
      embed
    );
    expect(calls).toBe(0);
    expect(await assistantSyncDb.visits.count()).toBe(0);
  });
});
