import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INDEXING_CONSENT_KEY } from "../src/shared/onboarding-constants";

const sw = readFileSync(join(__dirname, "..", "src", "background", "service-worker.ts"), "utf8");

describe("indexing consent state", () => {
  it("blocks capture until consent, before pause, and fails closed", () => {
    expect(INDEXING_CONSENT_KEY).toBe("cortex_indexing_consent_v1");
    const skip = sw.slice(sw.indexOf("async function shouldSkipIndexing"), sw.indexOf("if (sender.tab?.incognito)"));
    expect(skip.indexOf("hasIndexingConsent")).toBeLessThan(skip.indexOf("indexingPaused"));
    expect(skip).toContain('reason: "no_indexing_consent"');
    const read = sw.slice(sw.indexOf("async function hasIndexingConsent"), sw.indexOf("async function grandfatherIndexingConsentIfNeeded"));
    expect(read).toContain("catch {");
    expect(read).toContain("return false");
  });
});
