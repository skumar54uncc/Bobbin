import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalizeUrl } from "../src/assistant-sync/canonical-url";
import { redactForSync } from "../src/assistant-sync/redact-sync";
import { createDwellTracker } from "../src/content/dwell";

const PAGE = "https://example.com/article?utm_source=x#top";
const TEXT = "Bobbin indexes pages you read. ".repeat(80);

describe("capture budget", () => {
  it("a dwell tick and a local capture add stay under 5 ms", () => {
    const tracker = createDwellTracker(PAGE, {
      now: () => 1_000,
      visible: () => true,
      focused: () => true,
      playing: () => false,
      scrollPct: () => 10,
      send: () => undefined,
    });
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) tracker.tick();
    canonicalizeUrl(PAGE);
    redactForSync(TEXT);
    const ms = performance.now() - t0;
    expect(ms / 51).toBeLessThan(5);
  });

  it("flush Google work stays out of the service worker", () => {
    const sw = readFileSync(join(__dirname, "..", "src", "background", "service-worker.ts"), "utf8");
    const off = readFileSync(join(__dirname, "..", "src", "offscreen", "offscreen.ts"), "utf8");
    expect(sw).not.toContain("assistant-sync/sync-engine");
    expect(sw).not.toContain("sheets.googleapis.com");
    expect(off).toContain("assistant-sync/runtime");
  });
});
