import { describe, expect, it } from "vitest";
import { parseAskResume, threadNeedsRetry } from "../src/content/ask-resume";

describe("ask resume", () => {
  it("reads a saved thread and draft", () => {
    expect(parseAskResume({ conversationId: 12, draft: "Who is Shailesh Kumar" })).toEqual({
      conversationId: 12,
      draft: "Who is Shailesh Kumar",
    });
    expect(parseAskResume(null)).toEqual({ conversationId: null, draft: "" });
    expect(parseAskResume({ conversationId: "x", draft: 1 })).toEqual({ conversationId: null, draft: "" });
  });

  it("flags a thread that stopped on the user message", () => {
    expect(threadNeedsRetry([{ role: "user" }])).toBe(true);
    expect(threadNeedsRetry([{ role: "user" }, { role: "assistant" }])).toBe(false);
    expect(threadNeedsRetry([])).toBe(false);
  });
});
