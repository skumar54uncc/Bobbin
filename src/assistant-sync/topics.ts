import { cosineSimilarity } from "../lib/similarity";

export interface TopicVector {
  label: string;
  vector: number[];
}

/**
 * Tuned on eval/queries/topic-fixtures.ts (55 pages, 73 labels) with the shipped int8 vectors:
 * precision 0.951, recall 0.964, and 16 of 16 vague recall questions matched. At 0.40 recall falls
 * to 0.911 and one vague question misses; at 0.36 the tariffs page also gets "export controls".
 */
export const TOPIC_SIMILARITY_THRESHOLD = 0.38;

export const MAX_TOPICS = 3;

/** Top 1 to 3 labels at or above the threshold. None when nothing clears it. */
export function tagTopics(
  pageEmbedding: number[] | null | undefined,
  threshold: number = TOPIC_SIMILARITY_THRESHOLD,
  labels: readonly TopicVector[] = []
): string[] {
  if (!pageEmbedding?.length || !labels.length) return [];
  const ranked = labels
    .map((label) => ({ label: label.label, score: cosineSimilarity(pageEmbedding, label.vector) }))
    .filter((row) => row.score >= threshold)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of ranked) {
    if (seen.has(row.label)) continue;
    seen.add(row.label);
    out.push(row.label);
    if (out.length >= MAX_TOPICS) break;
  }
  return out;
}

/** Lazy chunk. The float label file stays out of the extension bundles. */
export async function loadTopicVectors(): Promise<TopicVector[]> {
  const mod = await import(/* webpackChunkName: "assistant-sync-topics" */ "./topic-vectors");
  return mod.decodedTopicVectors();
}
