/** Popup footer, About Bobbin, and header taglines. Exact user-facing Phase 6 copy. */

/** Store listing tagline, homepage hero, onboarding first screen, and the start of the manifest description. */
export const PRODUCT_TAGLINE = "The missing memory for your AI.";
/** Homepage only: sits under the hero tagline. */
export const HOMEPAGE_SECONDARY = "Read it once. Ask your AI anytime.";
/** About Bobbin and the homepage brand line. */
export const BRAND_LINE = "Bobbin keeps the thread of everything you read.";
/** Chrome Web Store short description and manifest description. 132 characters max. */
export const STORE_SUMMARY =
  "The missing memory for your AI. Bobbin remembers pages you read for Claude, ChatGPT, Gemini, and Grok. Free.";

/** Manifest description: same sentence as the store short description. */
export const MANIFEST_DESCRIPTION = STORE_SUMMARY;

export const NOT_AFFILIATED =
  "Bobbin is not affiliated with, endorsed by, or sponsored by Google, Anthropic, OpenAI, xAI, Meta, Microsoft, Perplexity, Muse, or LinkedIn. Their names are used only to describe compatibility.";

export const TAGLINE_SYNC_OFF = "Private library of pages you read on this device";
export const TAGLINE_SYNC_ON = "On this device and in your Google Drive";

export function headerTagline(syncOn: boolean): string {
  return syncOn ? TAGLINE_SYNC_ON : TAGLINE_SYNC_OFF;
}

export const FOOTER_FREE = "Free forever. No ads. No servers. Your data stays yours.";
export const WHY_FREE_LABEL = "Why it's free";
export const ABOUT_FREE_TITLE = "Free, and built to stay that way";

export const ABOUT_FREE_P1 =
  "Bobbin is built and maintained by one independent developer. It has no servers, no ads, no tracking, and no paid plans, and it never will. That is a design choice: your memory lives on your device and, if you turn on Assistant Sync, in your own Google Drive. Because nothing runs on servers, Bobbin costs nothing to operate, so it can stay free for everyone without charging you or selling your data.";

export const ABOUT_FREE_P2 =
  "What this means for you: some things that would need servers, like live answers while your browser is closed, are not part of Bobbin. The Google Sheet updates about every 5 minutes while you browse and at least every 15 minutes. Page text goes into Google Docs in your Bobbin Memory folder, one per day. That is how your assistant stays current without any paid infrastructure.";

/** GitHub Pages from main, /docs. Phase 7 adds /privacy and /terms as folders. */
export const HOMEPAGE_URL = "https://skumar54uncc.github.io/Bobbin/";
export const PRIVACY_POLICY_URL = "https://skumar54uncc.github.io/Bobbin/privacy";
export const DATA_DELETION_URL = "https://skumar54uncc.github.io/Bobbin/data-deletion.html";
export const TERMS_URL = "https://skumar54uncc.github.io/Bobbin/terms";
export const CONTACT_EMAIL = "shailesh.entrant@gmail.com";
export const GITHUB_ISSUES_URL = "https://github.com/skumar54uncc/Bobbin/issues";
export const FEEDBACK_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSeC5bLybg056jJQzpohfgSX8r1OWlgtT7LSlSeHgvbT3CqQCQ/viewform";
export const FEEDBACK_HINT = "Please don't paste personal browsing history into feedback.";
export const FEEDBACK_GITHUB_LABEL = "Report a bug on GitHub";

export function browserLine(userAgent: string): string {
  const chrome = /(?:Chrome|Chromium|Edg)\/([\d.]+)/.exec(userAgent);
  if (chrome) {
    const name = userAgent.includes("Edg/") ? "Edge" : "Chrome";
    return `${name} ${chrome[1]}`;
  }
  return "Chrome";
}

/** Prefills version and browser only. Never browsing data. */
export function feedbackFormUrl(version: string, userAgent: string): string {
  const params = new URLSearchParams({
    usp: "pp_url",
    "entry.1754457701": version,
    "entry.1486423245": browserLine(userAgent),
  });
  return `${FEEDBACK_FORM_URL}?${params.toString()}`;
}
