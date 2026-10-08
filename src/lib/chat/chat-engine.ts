import { parseQuestion } from "./question-parser";
import { runAdvancedSearch, type ChunkWithDoc } from "../search-engine";
import {
  buildChatPrompt,
  CHAT_SYSTEM_PROMPT,
  expandChatEvidence,
  selectChunksForBudget,
  selectHistoryForPrompt,
} from "./context-builder";
import { addMessageToConversation, createConversation, getConversationMessages } from "./conversation-store";
import {
  decideRoute,
  streamAnswer,
  ChatUnavailableError,
  type RouteDecision,
} from "./llm-router";
import { CortexError } from "../errors";
import type { ChatSettings } from "./types";
import { answerPeopleQuery, parsePeopleQuery } from "../people";
import { smalltalkReply } from "./smalltalk";
import { buildRecallAnswer, loadRecallPages, parseRecallQuery } from "./recall";
import { db } from "../../db/schema";
export interface ChatStreamEvent {
  type:
    | "conversation"
    | "route"
    | "sources"
    | "token"
    | "done"
    | "error"
    | "aborted"
    /** Still working: keeps the panel's inactivity timer and the service worker alive. */
    | "progress";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

export interface RunChatOptions {
  /** CORTEX_CHAT_ABORT: stop streaming, do not store the partial answer. */
  signal?: AbortSignal;
  /** Answer only from pages in this collection (Phase 5.4). */
  collectionId?: number;
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

/** Silence longer than this yields a progress event. Chrome stops an idle service worker after 30s. */
export const CHAT_PULSE_MS = 8000;

/** Awaits `work`, yielding a progress event for every quiet stretch. The result lands in `box`. */
async function* waitWithPulse<T>(work: Promise<T>, box: { value?: T }): AsyncGenerator<ChatStreamEvent> {
  let settled = false;
  const done = work.then((v) => {
    settled = true;
    box.value = v;
  });
  while (!settled) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = new Promise<"tick">((resolve) => {
      timer = setTimeout(() => resolve("tick"), CHAT_PULSE_MS);
    });
    try {
      if ((await Promise.race([done.then(() => "done" as const), tick])) === "tick") {
        yield { type: "progress", data: {} };
      }
    } finally {
      clearTimeout(timer);
    }
  }
  await done;
}

/** The model's tokens, with null for every quiet stretch while it thinks. */
async function* pulsedTokens(source: AsyncIterable<string>): AsyncGenerator<string | null> {
  const it = source[Symbol.asyncIterator]();
  try {
    while (true) {
      const box: { value?: IteratorResult<string> } = {};
      for await (const _ of waitWithPulse(it.next(), box)) yield null;
      if (!box.value || box.value.done) return;
      yield box.value.value;
    }
  } finally {
    void it.return?.(undefined)?.catch?.(() => undefined);
  }
}

/** Best passage per page, plus other passages on those pages that share the question. */
async function expandRetrievedPages(
  hits: ChunkWithDoc[],
  question: string
): Promise<ChunkWithDoc[]> {
  if (hits.length === 0) return hits;
  const docIds = [...new Set(hits.map((hit) => hit.documentId))];
  const rows = await db.chunks.where("documentId").anyOf(docIds).toArray();
  const docById = new Map(hits.map((hit) => [hit.documentId, hit.document]));
  const pageChunks = rows.flatMap((row) => {
    const document = docById.get(row.documentId);
    return document ? [{ ...row, document }] : [];
  });
  return expandChatEvidence(hits, pageChunks, question);
}

export async function* runChat(
  conversationId: number | null,
  question: string,
  settings: ChatSettings,
  embedQuery: (text: string) => Promise<number[] | null>,
  opts: RunChatOptions = {}
): AsyncIterable<ChatStreamEvent> {
  const signal = opts.signal;
  try {
    const parsed = parseQuestion(question);

    let convId = conversationId;
    if (convId == null) {
      convId = await createConversation(question);
      yield { type: "conversation", data: { id: convId } };
    }

    const greeting = smalltalkReply(question);
    if (greeting) {
      await addMessageToConversation(convId, { role: "user", content: question, timestamp: Date.now() });
      yield { type: "sources", data: { chunks: [] } };
      yield { type: "token", data: greeting };
      await addMessageToConversation(convId, {
        role: "assistant",
        content: greeting,
        timestamp: Date.now(),
        citedChunks: [],
      });
      yield { type: "done", data: { provider: "local" } };
      return;
    }

    // People questions ("who did I view from X") come from the people store,
    // not from page search or a model. Falls through to RAG when nobody matches.
    if (settings.peopleEnabled !== false) {
      const pq = parsePeopleQuery(question);
      const answer = pq ? await answerPeopleQuery(pq) : null;
      if (answer) {
        await addMessageToConversation(convId, { role: "user", content: question, timestamp: Date.now() });
        yield { type: "sources", data: { chunks: [] } };
        yield { type: "token", data: answer.text };
        await addMessageToConversation(convId, {
          role: "assistant",
          content: answer.text,
          timestamp: Date.now(),
          citedChunks: [],
        });
        yield { type: "done", data: { provider: "people" } };
        return;
      }
    }

    // "What did I see on YouTube today": answered from the visit record, not
    // from passages. Retrieval cannot answer it, and the model used to say it
    // had nothing while twenty sources sat underneath the answer.
    const recall = parseRecallQuery(question);
    if (recall) {
      const pages = await loadRecallPages(recall, db.documents);
      const answer = buildRecallAnswer(recall, pages);
      const chunks = answer.sources.map((p, i) => ({
        id: -1 - i,
        documentId: -1 - i,
        ord: 0,
        text: "",
        document: {
          id: -1 - i,
          url: p.url,
          domain: p.domain,
          title: p.title,
          summary: p.summary,
          lastVisitedAt: p.visitedAt,
          visitCount: 1,
          importanceScore: 0,
        },
      }));
      await addMessageToConversation(convId, { role: "user", content: question, timestamp: Date.now() });
      yield { type: "sources", data: { chunks } };
      yield { type: "token", data: answer.text };
      await addMessageToConversation(convId, {
        role: "assistant",
        content: answer.text,
        timestamp: Date.now(),
        citedChunks: [],
      });
      yield { type: "done", data: { provider: "recall" } };
      return;
    }

    const priorMessages =
      convId != null ? await getConversationMessages(convId) : [];
    const history = selectHistoryForPrompt(
      priorMessages.map((m) => ({ role: m.role, content: m.content }))
    );

    const forceTimeRange = parsed.timeRange
      ? {
          start: parsed.timeRange.from.getTime(),
          end: parsed.timeRange.to.getTime(),
        }
      : undefined;

    const qtext =
      parsed.searchQuery.trim() ||
      parsed.rawQuery.trim() ||
      parsed.rawQuery;

    yield { type: "route", data: { provider: "nano", reason: "searching" } };

    const searched: { value?: Awaited<ReturnType<typeof runAdvancedSearch>> } = {};
    yield* waitWithPulse(
      runAdvancedSearch(qtext, embedQuery, {
        maxHits: 20,
        forceTimeRange,
        includeChunks: true,
        ...(opts.collectionId != null ? { collectionId: opts.collectionId } : {}),
      }),
      searched
    );
    const searchResults = searched.value!;

    const expanded: { value?: ChunkWithDoc[] } = {};
    yield* waitWithPulse(expandRetrievedPages(searchResults.chunks ?? [], question), expanded);
    const rawChunks = expanded.value ?? [];

    if (rawChunks.length === 0) {
      yield {
        type: "error",
        data: {
          message: parsed.timeRange
            ? `I didn't find that in your library for ${parsed.timeRange.label}.`
            : "I didn't find that in your library.",
          userAction: searchResults.abstained
            ? "Try different words, or read the page again so Cortex can index it."
            : undefined,
          recoverable: true,
        },
      };
      return;
    }

    const NANO_MAX = 18_000;
    // Enough for the twenty best passages. A larger prompt only delays the first word.
    const CLOUD_MAX = 60_000;
    const maxChars =
      settings.cloudEnabled && settings.geminiApiKey ? CLOUD_MAX : NANO_MAX;

    const selectedChunks = selectChunksForBudget(
      rawChunks,
      maxChars,
      question.length
    );

    yield {
      type: "sources",
      data: {
        chunks: selectedChunks,
        timeRange: parsed.timeRange,
      },
    };

    const prompt = buildChatPrompt({
      question: parsed.rawQuery,
      chunks: selectedChunks,
      timeContext: parsed.timeRange?.label,
      history,
    });

    const route: RouteDecision = await decideRoute(prompt, parsed, settings);
    yield { type: "route", data: route };

    await addMessageToConversation(convId, {
      role: "user",
      content: question,
      timestamp: Date.now(),
    });

    let fullAnswer = "";
    for await (const token of pulsedTokens(streamAnswer(
      prompt,
      CHAT_SYSTEM_PROMPT,
      route,
      settings,
      { signal }
    ))) {
      if (signal?.aborted) break;
      if (token === null) {
        yield { type: "progress", data: {} };
        continue;
      }
      fullAnswer += token;
      yield { type: "token", data: token };
      if (signal?.aborted) break;
    }

    if (signal?.aborted) {
      yield { type: "aborted", data: { provider: route.provider } };
      return;
    }

    if (!fullAnswer.trim()) {
      yield {
        type: "error",
        data: {
          message: "Cortex did not get an answer. Try again.",
          recoverable: true,
        },
      };
      return;
    }

    const citedChunks = selectedChunks
      .filter((c) => c.id != null)
      .map((c) => ({
        chunkId: c.id as number,
        documentId: c.documentId,
        url: c.document.url,
        title: c.document.title,
        // Kind and locator keep per-kind citation links in reopened chats.
        ...(c.kind ? { kind: c.kind } : {}),
        ...(c.locator ? { locator: c.locator } : {}),
      }));

    await addMessageToConversation(convId, {
      role: "assistant",
      content: fullAnswer,
      timestamp: Date.now(),
      citedChunks,
      provider: route.provider,
    });

    yield { type: "done", data: { provider: route.provider } };
  } catch (e) {
    if (signal?.aborted || isAbortError(e)) {
      yield { type: "aborted", data: {} };
      return;
    }
    if (e instanceof ChatUnavailableError) {
      yield {
        type: "error",
        data: {
          message: e.message,
          userAction: e.userAction,
          recoverable: true,
        },
      };
      return;
    }
    if (e instanceof CortexError) {
      yield {
        type: "error",
        data: {
          ...e.toPayload(),
        },
      };
      return;
    }
    yield {
      type: "error",
      data: {
        message: `Chat failed: ${String(e)}`,
        recoverable: false,
      },
    };
  }
}
