import { describe, expect, it, vi, afterEach } from "vitest";
import { cloudStream, listCloudModels } from "../src/lib/chat/cloud-stream";

function sse(events: string[]): Response {
  return new Response(events.map((e) => `data: ${e}\n\n`).join(""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("cloudStream complete answers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("continues an OpenAI-compatible answer that stopped on length", async () => {
    const bodies: { messages: { role: string; content: string }[] }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return bodies.length === 1
          ? sse(['{"choices":[{"delta":{"content":"Part one."},"finish_reason":"length"}]}'])
          : sse(['{"choices":[{"delta":{"content":" Part two."},"finish_reason":"stop"}]}', "[DONE]"]);
      })
    );
    const out: string[] = [];
    for await (const t of cloudStream("q", { mode: "cloud-only", cloudEnabled: true, geminiApiKey: "k", cloudProvider: "openai" }, {})) {
      out.push(t);
    }
    expect(out.join("")).toBe("Part one. Part two.");
    expect(bodies[1]!.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("continues an Anthropic answer that stopped on max_tokens", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return calls === 1
          ? sse(['{"delta":{"text":"Half"}}', '{"delta":{"stop_reason":"max_tokens"}}'])
          : sse(['{"delta":{"text":" and the rest."}}', '{"delta":{"stop_reason":"end_turn"}}']);
      })
    );
    const out: string[] = [];
    for await (const t of cloudStream("q", { mode: "cloud-only", cloudEnabled: true, geminiApiKey: "k", cloudProvider: "anthropic" }, {})) {
      out.push(t);
    }
    expect(out.join("")).toBe("Half and the rest.");
    expect(calls).toBe(2);
  });

  it("stops after a complete answer without a second request", async () => {
    const fetchMock = vi.fn(async () => sse(['{"choices":[{"delta":{"content":"Done."},"finish_reason":"stop"}]}']));
    vi.stubGlobal("fetch", fetchMock);
    const out: string[] = [];
    for await (const t of cloudStream("q", { mode: "cloud-only", cloudEnabled: true, geminiApiKey: "k", cloudProvider: "groq" }, {})) {
      out.push(t);
    }
    expect(out.join("")).toBe("Done.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("listCloudModels", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists Gemini chat models from the key, without the models/ prefix", async () => {
    let headers: Record<string, string> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        headers = init?.headers as Record<string, string>;
        return Response.json({
          models: [
            { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] },
            { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
          ],
        });
      })
    );
    expect(await listCloudModels("gemini", "AIzaKEY")).toEqual(["gemini-3.8-flash"]);
    expect(headers["x-goog-api-key"]).toBe("AIzaKEY");
  });

  it("drops embedding and audio models from an OpenAI list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: [{ id: "gpt-4o-mini" }, { id: "text-embedding-3-small" }, { id: "whisper-1" }] }))
    );
    expect(await listCloudModels("openai", "sk-x")).toEqual(["gpt-4o-mini"]);
  });

  it("says the key was rejected on 401", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 401 })));
    await expect(listCloudModels("anthropic", "sk-ant-x")).rejects.toThrow(/rejected/);
  });

  it("asks for a key before calling anyone", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(listCloudModels("gemini", "  ")).rejects.toThrow(/API key/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
