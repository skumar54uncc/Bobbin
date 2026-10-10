import "fake-indexeddb/auto";
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/lib/search-engine", () => ({
  runAdvancedSearch: vi.fn(async () => ({
    hits: [],
    evidence: "",
    chunks: [
      {
        id: 1,
        documentId: 1,
        ord: 0,
        text: "Some indexed passage about rockets.",
        document: {
          id: 1,
          url: "https://example.com/a",
          domain: "example.com",
          title: "A",
          summary: "",
          lastVisitedAt: 0,
          visitCount: 1,
          importanceScore: 0,
        },
      },
    ],
  })),
}));

const { store, router } = vi.hoisted(() => ({
  store: {
    createConversation: vi.fn(async () => 42),
    getConversationMessages: vi.fn(async () => []),
    addMessageToConversation: vi.fn(async () => 1),
  },
  router: {
    decideRoute: vi.fn(async () => ({ provider: "nano", reason: "forced_on_device" })),
    streamAnswer: vi.fn(),
    ChatUnavailableError: class extends Error {},
  },
}));
vi.mock("../src/lib/chat/conversation-store", () => store);
vi.mock("../src/lib/chat/llm-router", () => router);

import { runChat } from "../src/lib/chat/chat-engine";

describe("runChat abort", () => {
  it("stops after abort: no more tokens, no done event, and no assistant message is stored", async () => {
    const ac = new AbortController();
    router.streamAnswer.mockImplementation(async function* (
      _p: string,
      _s: string,
      _r: unknown,
      _settings: unknown,
      opts?: { signal?: AbortSignal }
    ) {
      for (let i = 1; i <= 100; i++) {
        if (opts?.signal?.aborted) return;
        yield `t${i} `;
      }
    });

    const events: string[] = [];
    for await (const ev of runChat(
      null,
      "what about rockets?",
      { mode: "on-device-only", cloudEnabled: false, geminiApiKey: "" },
      async () => null,
      { signal: ac.signal }
    )) {
      events.push(ev.type);
      if (ev.type === "token" && events.filter((e) => e === "token").length === 3) {
        ac.abort();
      }
    }

    expect(events.filter((e) => e === "token")).toHaveLength(3);
    expect(events).not.toContain("done");
    expect(events[events.length - 1]).toBe("aborted");
    // user message stored, assistant message not stored
    const roles = store.addMessageToConversation.mock.calls.map(
      (c) => (c as unknown as [number, { role: string }])[1].role
    );
    expect(roles).toEqual(["user"]);
  });

  it("sends progress while the model is quiet, then the answer", async () => {
    vi.useFakeTimers();
    try {
      router.streamAnswer.mockImplementation(async function* () {
        await new Promise((r) => setTimeout(r, 20_000));
        yield "Rockets.";
      });
      const events: string[] = [];
      const run = (async () => {
        for await (const ev of runChat(
          null,
          "what about rockets?",
          { mode: "on-device-only", cloudEnabled: false, geminiApiKey: "" },
          async () => null
        )) {
          events.push(ev.type);
        }
      })();
      await vi.advanceTimersByTimeAsync(21_000);
      await run;
      expect(events.filter((e) => e === "progress").length).toBeGreaterThanOrEqual(2);
      expect(events.slice(-2)).toEqual(["token", "done"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
