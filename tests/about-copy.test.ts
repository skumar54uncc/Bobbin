import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ABOUT_FREE_P1,
  ABOUT_FREE_P2,
  ABOUT_FREE_TITLE,
  DATA_DELETION_URL,
  FEEDBACK_FORM_URL,
  FOOTER_FREE,
  PRIVACY_POLICY_URL,
  TAGLINE_SYNC_OFF,
  TAGLINE_SYNC_ON,
  TERMS_URL,
  WHY_FREE_LABEL,
  browserLine,
  feedbackFormUrl,
  headerTagline,
} from "../src/shared/about-copy";

const root = join(__dirname, "..");

describe("Phase 6 free and independent copy", () => {
  it("switches the header tagline on real sync state", () => {
    expect(headerTagline(false)).toBe(TAGLINE_SYNC_OFF);
    expect(headerTagline(true)).toBe(TAGLINE_SYNC_ON);
    expect(TAGLINE_SYNC_OFF).toBe("Private library of pages you read on this device");
    expect(TAGLINE_SYNC_ON).toBe("On this device and in your Google Drive");
  });

  it("keeps the popup footer and Why it's free link", () => {
    const html = readFileSync(join(root, "src/popup/popup.html"), "utf8");
    expect(html).toContain(FOOTER_FREE);
    expect(html).toContain(WHY_FREE_LABEL);
    expect(html).toContain('href="options.html#cx-sec-about"');
    expect(html).toContain(`id="cx-tagline"`);
    expect(html).not.toContain("every 2 minutes");
  });

  it("puts the About Bobbin copy, 5 minute cadence, and Pages docs in Settings", () => {
    const html = readFileSync(join(root, "src/options/options.html"), "utf8");
    expect(html).toContain("About Bobbin");
    expect(html).toContain(ABOUT_FREE_TITLE);
    expect(html.replace(/\s+/g, " ")).toContain(ABOUT_FREE_P1);
    expect(html.replace(/\s+/g, " ")).toContain(ABOUT_FREE_P2);
    expect(html).toContain("about every 5 minutes");
    expect(html).toContain("Page text goes into Google Docs");
    expect(html).not.toContain("every 2 minutes");
    expect(html).toContain(PRIVACY_POLICY_URL);
    expect(html).toContain(DATA_DELETION_URL);
    expect(html).toContain(TERMS_URL);
    expect(html).toContain(FEEDBACK_FORM_URL);
    expect(html).toContain(">Privacy Policy<");
    expect(html).toContain(">Terms of Use<");
    expect(html).toContain(">Send feedback<");
    expect(html).not.toContain("github.io/Bobbin");
  });

  it("uses the same taglines in the overlay", () => {
    const src = readFileSync(join(root, "src/content/overlay.ts"), "utf8");
    expect(src).toContain("headerTagline");
    expect(src).toContain("TAGLINE_SYNC_OFF");
    expect(src).not.toMatch(/alt="Cortex mascot"/);
    expect(src).not.toContain("How to open Cortex");
    expect(src).not.toContain("Cortex was reloaded");
  });

  it("prefills feedback with version and browser only", () => {
    const url = feedbackFormUrl("1.2.0", "Mozilla/5.0 Chrome/140.0.7339.128 Safari/537.36");
    expect(url.startsWith(FEEDBACK_FORM_URL)).toBe(true);
    expect(url).toContain("entry.1754457701=1.2.0");
    expect(url).toContain("entry.1486423245=Chrome+140.0.7339.128");
    expect(browserLine("Mozilla/5.0 Edg/140.0.0.0")).toBe("Edge 140.0.0.0");
  });
});
