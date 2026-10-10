import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BRAND_LINE,
  CONTACT_EMAIL,
  FEEDBACK_HINT,
  HOMEPAGE_SECONDARY,
  HOMEPAGE_URL,
  PRIVACY_POLICY_URL,
  PRODUCT_TAGLINE,
  STORE_LISTING_URL,
  TERMS_URL,
} from "../src/shared/about-copy";

const root = join(__dirname, "..");

describe("Phase 7 public pages", () => {
  it("homepage uses Bobbin, the felt mascot, the tagline, and free-forever copy", () => {
    const html = readFileSync(join(root, "docs/index.html"), "utf8");
    expect(html).toContain(PRODUCT_TAGLINE);
    expect(html).toContain(HOMEPAGE_SECONDARY);
    expect(html).toContain(BRAND_LINE);
    expect(html).toContain("Free forever. No ads. No servers.");
    expect(html).toContain("felt-wave.webp");
    expect(html).toContain(STORE_LISTING_URL);
    expect(html).toContain("happibddmmagkgneicjkndapcpmhdbfn");
    expect(html).not.toContain("when the listing is live");
    expect(html).toContain(CONTACT_EMAIL);
    expect(html).toContain(PRIVACY_POLICY_URL.replace(HOMEPAGE_URL, ""));
    expect(html).toContain("privacy/");
    expect(html).toContain("terms/");
    expect(html).not.toContain("password");
    expect(html).not.toContain("Sign in");
  });

  it("privacy and terms live at folder URLs and carry both Limited Use sentences", () => {
    const privacy = readFileSync(join(root, "docs/privacy/index.html"), "utf8");
    const terms = readFileSync(join(root, "docs/terms/index.html"), "utf8");
    expect(privacy).toContain("Chrome Web Store User Data Policy");
    expect(privacy).toContain("Google API Services User Data Policy");
    expect(privacy).toContain("Limited Use requirements");
    expect(privacy).toContain(CONTACT_EMAIL);
    expect(privacy).toContain("I agree");
    expect(terms).toContain("not affiliated with, endorsed by, or sponsored by");
    expect(terms).toContain(CONTACT_EMAIL);
    expect(PRIVACY_POLICY_URL).toBe("https://skumar54uncc.github.io/Bobbin/privacy");
    expect(TERMS_URL).toBe("https://skumar54uncc.github.io/Bobbin/terms");
  });

  it("bundles offline copies inside the extension", () => {
    const priv = readFileSync(join(root, "src/legal/privacy.html"), "utf8");
    const terms = readFileSync(join(root, "src/legal/terms.html"), "utf8");
    expect(priv).toContain("Limited Use requirements");
    expect(terms).toContain("Terms of Use");
    const onb = readFileSync(join(root, "src/onboarding/onboarding.html"), "utf8");
    expect(onb).toContain("I agree");
    expect(onb).toContain("Not now");
    const about = readFileSync(join(root, "src/options/options.html"), "utf8");
    expect(about).toContain(FEEDBACK_HINT);
  });
});
