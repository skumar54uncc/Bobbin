import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ABOUT_FREE_P1,
  ABOUT_FREE_P2,
  ABOUT_FREE_TITLE,
  BRAND_LINE,
  DATA_DELETION_URL,
  FEEDBACK_FORM_URL,
  FOOTER_FREE,
  HOMEPAGE_URL,
  HOMEPAGE_SECONDARY,
  MANIFEST_DESCRIPTION,
  NOT_AFFILIATED,
  PRIVACY_POLICY_URL,
  PRODUCT_TAGLINE,
  STORE_LISTING_URL,
  STORE_SUMMARY,
  TERMS_URL,
  WHY_FREE_LABEL,
  browserLine,
  feedbackFormUrl,
  headerTagline,
} from "../src/shared/about-copy";

const root = join(__dirname, "..");

describe("Phase 6 free and independent copy", () => {
  it("uses the product tagline in the overlay and popup header", () => {
    expect(headerTagline(false)).toBe(PRODUCT_TAGLINE);
    expect(headerTagline(true)).toBe(PRODUCT_TAGLINE);
    expect(PRODUCT_TAGLINE).toBe("The missing memory for your AI.");
  });

  it("keeps the popup footer and Why it's free link", () => {
    const html = readFileSync(join(root, "src/popup/popup.html"), "utf8");
    expect(html).toContain(FOOTER_FREE);
    expect(html).toContain(WHY_FREE_LABEL);
    expect(html).toContain("Send feedback");
    expect(html).toContain("Please don't paste personal browsing history into feedback.");
    expect(html).toContain('href="options.html#cx-sec-about"');
    expect(html).toContain(`id="cx-tagline"`);
    expect(html).toContain(PRODUCT_TAGLINE);
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
    expect(html).toContain("legal/privacy.html");
    expect(html).toContain("legal/terms.html");
    expect(html).toContain(DATA_DELETION_URL);
    expect(html).toContain(FEEDBACK_FORM_URL);
    expect(html).toContain("Please don't paste personal browsing history into feedback.");
    expect(html).toContain("Report a bug on GitHub");
    expect(PRIVACY_POLICY_URL).toBe("https://skumar54uncc.github.io/Bobbin/privacy");
    expect(TERMS_URL).toBe("https://skumar54uncc.github.io/Bobbin/terms");
    expect(html).toContain(">Privacy Policy<");
    expect(html).toContain(">Terms of Use<");
    expect(html).toContain(">Send feedback<");
    expect(html).toContain(BRAND_LINE);
    expect(html.replace(/\s+/g, " ")).toContain(NOT_AFFILIATED);
    expect(html).toContain("github.io/Bobbin");
    expect(html).not.toContain("github.io/Cortex");
  });

  it("uses the marketing tagline on onboarding and in the manifest", () => {
    const onb = readFileSync(join(root, "src/onboarding/onboarding.html"), "utf8");
    expect(onb).toContain(PRODUCT_TAGLINE);
    expect(onb).not.toContain(HOMEPAGE_SECONDARY);
    expect(PRODUCT_TAGLINE).toBe("The missing memory for your AI.");
    expect(MANIFEST_DESCRIPTION).toBe(STORE_SUMMARY);
    expect(MANIFEST_DESCRIPTION.startsWith(PRODUCT_TAGLINE)).toBe(true);
    expect(MANIFEST_DESCRIPTION.length).toBeLessThanOrEqual(132);
    expect(STORE_SUMMARY.length).toBe(108);
    expect(STORE_SUMMARY.length).toBeLessThanOrEqual(132);
    expect(HOMEPAGE_URL).toBe("https://skumar54uncc.github.io/Bobbin/");
    expect(STORE_LISTING_URL).toContain("happibddmmagkgneicjkndapcpmhdbfn");
    const listing = readFileSync(join(root, "docs/store-listing.md"), "utf8");
    expect(listing).toContain(PRODUCT_TAGLINE);
    expect(listing).toContain(STORE_SUMMARY);
    expect(listing).toContain("unlimitedStorage");
  });

  it("uses the same taglines in the overlay", () => {
    const src = readFileSync(join(root, "src/content/overlay.ts"), "utf8");
    expect(src).toContain("PRODUCT_TAGLINE");
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
