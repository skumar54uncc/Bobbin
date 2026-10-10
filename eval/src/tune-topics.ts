/**
 * Embed the topic catalog, the fixture pages, and the vague recall questions with the real model,
 * then print a threshold sweep. Writes the float label vectors (eval only), the int8 label vectors
 * the extension ships, and the fixture vectors the unit tests use. Does not edit the threshold.
 *
 * node --import tsx eval/src/tune-topics.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TOPIC_CATALOG } from "../../src/assistant-sync/topic-catalog.js";
import { decodedTopicVectors, quantizeVector } from "../../src/assistant-sync/topic-vectors.js";
import { MAX_TOPICS, tagTopics, type TopicVector } from "../../src/assistant-sync/topics.js";
import { cosineSimilarity } from "../../src/lib/similarity.js";
import { CORTEX_EMBED_MODEL_ID } from "../../src/shared/embed-model.js";
import { TOPIC_FIXTURES, VAGUE_RECALL } from "../queries/topic-fixtures.js";
import { embedText } from "./embed-node.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

function round(vector: number[]): number[] {
  return vector.map((n) => Math.round(n * 1e5) / 1e5);
}

export interface ScoredCase {
  expected: string[];
  accept: string[];
  predicted: string[];
}

/** Precision counts expected and accepted labels as right; recall counts expected labels only. */
export function precisionRecall(cases: ScoredCase[]): { precision: number; recall: number } {
  let right = 0;
  let predicted = 0;
  let found = 0;
  let relevant = 0;
  for (const row of cases) {
    const ok = new Set([...row.expected, ...row.accept]);
    predicted += row.predicted.length;
    relevant += row.expected.length;
    for (const label of row.predicted) if (ok.has(label)) right += 1;
    for (const label of row.expected) if (row.predicted.includes(label)) found += 1;
  }
  return { precision: predicted === 0 ? 1 : right / predicted, recall: relevant === 0 ? 1 : found / relevant };
}

/** The question's top labels, as an assistant matching words to the topics column would. */
export function questionLabels(vector: number[], labels: readonly TopicVector[]): string[] {
  return labels
    .map((label) => ({ label: label.label, score: cosineSimilarity(vector, label.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_TOPICS)
    .map((row) => row.label);
}

async function main(): Promise<void> {
  const floats: TopicVector[] = [];
  for (const topic of TOPIC_CATALOG) floats.push({ label: topic.label, vector: round(await embedText(topic.embed)) });
  writeFileSync(
    join(ROOT, "src", "assistant-sync", "topic-label-embeddings.json"),
    JSON.stringify({ modelId: CORTEX_EMBED_MODEL_ID, labels: floats }),
    "utf8"
  );
  const quantized = floats.map((row) => ({ label: row.label, ...quantizeVector(row.vector) }));
  writeFileSync(
    join(ROOT, "src", "assistant-sync", "topic-vectors-int8.json"),
    JSON.stringify({ modelId: CORTEX_EMBED_MODEL_ID, labels: quantized }),
    "utf8"
  );
  // Score with what ships: the decoded int8 vectors.
  const labels = decodedTopicVectors(quantized);

  const cases: { id: string; expected: string[]; accept: string[]; vector: number[] }[] = [];
  for (const fixture of TOPIC_FIXTURES) {
    const vector = round(await embedText(fixture.text));
    cases.push({ id: fixture.id, expected: fixture.expected, accept: fixture.accept ?? [], vector });
    const top = labels
      .map((label) => ({ label: label.label, score: cosineSimilarity(vector, label.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);
    console.info(fixture.id.padEnd(14), top.map((row) => `${row.label} ${row.score.toFixed(3)}`).join(" | "));
  }
  const questions: { id: string; page: string; vector: number[] }[] = [];
  for (const q of VAGUE_RECALL) questions.push({ id: q.id, page: q.page, vector: round(await embedText(q.question)) });
  writeFileSync(
    join(ROOT, "eval", "queries", "topic-fixture-embeddings.json"),
    JSON.stringify({ modelId: CORTEX_EMBED_MODEL_ID, cases, questions }),
    "utf8"
  );

  const byId = new Map(cases.map((c) => [c.id, c]));
  console.info("\nthreshold\tprecision\trecall\tF1\tvague\tlabels/page\twrong");
  for (let t = 0.3; t <= 0.6001; t += 0.02) {
    const scored = cases.map((row) => ({ ...row, predicted: tagTopics(row.vector, t, labels) }));
    const { precision, recall } = precisionRecall(scored);
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    const vague = questions.filter((q) => {
      const page = tagTopics(byId.get(q.page)!.vector, t, labels);
      return questionLabels(q.vector, labels).some((label) => page.includes(label));
    }).length;
    const perPage = scored.reduce((n, row) => n + row.predicted.length, 0) / scored.length;
    const wrong = scored
      .flatMap((row) => row.predicted.filter((l) => !row.expected.includes(l) && !row.accept.includes(l)).map((l) => `${row.id}:${l}`))
      .join(" ");
    console.info(
      `${t.toFixed(2)}\t\t${precision.toFixed(3)}\t\t${recall.toFixed(3)}\t${f1.toFixed(3)}\t${vague}/${questions.length}\t${perPage.toFixed(2)}\t\t${wrong}`
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
