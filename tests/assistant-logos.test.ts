import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ASSISTANTS } from "../src/config/assistants";

const dir = join(__dirname, "..", "assets", "assistant-logos");

describe("assistant logos", () => {
  it("bundles a local 24 px original tile for every assistant", () => {
    const files = readdirSync(dir).sort();
    expect(files).toEqual(ASSISTANTS.map((a) => `${a.id}.svg`).sort());
    for (const a of ASSISTANTS) {
      const svg = readFileSync(join(dir, `${a.id}.svg`), "utf8");
      expect(svg).toContain('width="24"');
      expect(svg).toContain('height="24"');
      expect(svg).not.toMatch(/href=["']https?:/);
      expect(svg).toContain("<text");
    }
  });

  it("records source URLs and why official marks are not used", () => {
    const doc = readFileSync(join(__dirname, "..", "docs", "third-party-logos.md"), "utf8");
    expect(doc).toContain("https://openai.com/brand");
    expect(doc).toContain("https://about.google/brand-resource-center/");
    expect(doc).toContain("https://www.anthropic.com");
    expect(doc).toContain("https://x.ai");
    expect(doc).toContain("https://muse.ai");
    expect(doc).toContain("https://www.perplexity.ai");
    expect(doc).toContain("lettered");
  });
});
