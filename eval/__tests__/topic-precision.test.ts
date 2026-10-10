import { describe, expect, it } from "vitest";
import fixtureFile from "../queries/topic-fixture-embeddings.json";
import { TOPIC_FIXTURES, VAGUE_RECALL } from "../queries/topic-fixtures";
import { precisionRecall, questionLabels } from "../src/tune-topics";
import { TOPIC_CATALOG } from "../../src/assistant-sync/topic-catalog";
import { decodedTopicVectors } from "../../src/assistant-sync/topic-vectors";
import { MAX_TOPICS, TOPIC_SIMILARITY_THRESHOLD, tagTopics } from "../../src/assistant-sync/topics";

const labelVectors = decodedTopicVectors();
const byId = new Map(fixtureFile.cases.map((c) => [c.id, c]));

const STOP = new Set(
  "a an and the of to in on for at by with about from what was that thing did i my me anything where how is it something read piece post story article guide tips".split(" ")
);
const words = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => !STOP.has(w)) ?? []);

describe("topic tagging", () => {
  it("has a specific label set of 40 to 80 labels, with vectors for every one", () => {
    expect(TOPIC_CATALOG.length).toBeGreaterThanOrEqual(40);
    expect(TOPIC_CATALOG.length).toBeLessThanOrEqual(80);
    expect(labelVectors.map((v) => v.label)).toEqual(TOPIC_CATALOG.map((t) => t.label));
    for (const broad of ["Technology", "news and current events", "health", "entertainment"]) {
      expect(TOPIC_CATALOG.map((t) => t.label)).not.toContain(broad);
    }
    for (const specific of ["semiconductors", "export controls", "AI security", "vector databases", "job search", "apartment hunting"]) {
      expect(TOPIC_CATALOG.map((t) => t.label)).toContain(specific);
    }
  });

  it("holds precision and recall at the tuned threshold, at most 3 labels per page", () => {
    expect(TOPIC_SIMILARITY_THRESHOLD).toBe(0.38);
    expect(fixtureFile.cases).toHaveLength(TOPIC_FIXTURES.length);
    const scored = fixtureFile.cases.map((row) => {
      const predicted = tagTopics(row.vector, TOPIC_SIMILARITY_THRESHOLD, labelVectors);
      expect(predicted.length).toBeLessThanOrEqual(MAX_TOPICS);
      return { expected: row.expected, accept: row.accept, predicted };
    });
    const { precision, recall } = precisionRecall(scored);
    expect(precision).toBeGreaterThanOrEqual(0.95);
    expect(recall).toBeGreaterThanOrEqual(0.96);
  });

  it("tags nothing on boilerplate pages", () => {
    for (const id of ["chrome-noise", "cookie-noise"]) {
      expect(tagTopics(byId.get(id)!.vector, TOPIC_SIMILARITY_THRESHOLD, labelVectors)).toEqual([]);
    }
  });

  it("tags the export controls article with specific labels, not a generic one", () => {
    expect(tagTopics(byId.get("chips")!.vector, TOPIC_SIMILARITY_THRESHOLD, labelVectors)).toEqual([
      "export controls",
      "semiconductors",
    ]);
  });
});

describe("vague recall through topics", () => {
  it("every question shares no word with its page title", () => {
    for (const q of VAGUE_RECALL) {
      const title = TOPIC_FIXTURES.find((f) => f.id === q.page)!.title;
      const shared = [...words(q.question)].filter((w) => words(title).has(w));
      expect(shared, `${q.id} vs "${title}"`).toEqual([]);
    }
  });

  it("finds the page for every question: one of the question's top labels is on the page", () => {
    expect(fixtureFile.questions).toHaveLength(VAGUE_RECALL.length);
    const misses = fixtureFile.questions.filter((q) => {
      const page = tagTopics(byId.get(q.page)!.vector, TOPIC_SIMILARITY_THRESHOLD, labelVectors);
      return !questionLabels(q.vector, labelVectors).some((label) => page.includes(label));
    });
    expect(misses.map((q) => q.id)).toEqual([]);
  });
});
