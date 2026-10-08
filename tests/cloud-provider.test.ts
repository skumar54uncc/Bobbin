import { describe, expect, it } from "vitest";
import {
  detectCloudProvider,
  normalizeCloudProvider,
  safeCloudBaseUrl,
  sanitizeCloudModel,
} from "../src/lib/chat/cloud-provider";
import { smalltalkReply } from "../src/lib/chat/smalltalk";

describe("cloud provider safety", () => {
  it("keeps only known providers", () => {
    expect(normalizeCloudProvider("openai")).toBe("openai");
    expect(normalizeCloudProvider("javascript")).toBe("gemini");
    expect(normalizeCloudProvider(undefined)).toBe("gemini");
  });

  it("detects unambiguous key prefixes", () => {
    expect(detectCloudProvider("AIzaSyExample")).toBe("gemini");
    expect(detectCloudProvider("sk-ant-abc")).toBe("anthropic");
    expect(detectCloudProvider("sk-or-abc")).toBe("openrouter");
    expect(detectCloudProvider("gsk_abc")).toBe("groq");
    expect(detectCloudProvider("sk-abc")).toBeNull();
  });

  it("rejects model ids that could break a request", () => {
    expect(sanitizeCloudModel("gpt-4o-mini", "fallback")).toBe("gpt-4o-mini");
    expect(sanitizeCloudModel("bad model", "fallback")).toBe("fallback");
    expect(sanitizeCloudModel("a\nb", "fallback")).toBe("fallback");
  });

  it("allows https and loopback endpoints only", () => {
    expect(safeCloudBaseUrl("https://api.example.com/v1/chat/completions")).toBe(
      "https://api.example.com/v1/chat/completions"
    );
    expect(safeCloudBaseUrl("http://127.0.0.1:1234/v1/chat/completions")).toBe(
      "http://127.0.0.1:1234/v1/chat/completions"
    );
    expect(safeCloudBaseUrl("http://169.254.169.254/latest")).toBeNull();
    expect(safeCloudBaseUrl("https://user:pass@api.example.com/v1")).toBeNull();
    expect(safeCloudBaseUrl("https://api.example.com/v1?key=secret")).toBeNull();
    expect(safeCloudBaseUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("smalltalk", () => {
  it("answers a greeting without searching the library", () => {
    expect(smalltalkReply("How are you?")).toMatch(/I'm here/);
    expect(smalltalkReply("Who is Shailesh Kumar?")).toBeNull();
  });
});
