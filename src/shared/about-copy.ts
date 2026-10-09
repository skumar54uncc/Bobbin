/** Popup footer, About Bobbin, and header taglines. Exact user-facing Phase 6 copy. */

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

/** Published GitHub Pages URL. The repo is still named Cortex; do not invent a /Bobbin host. */
export const PRIVACY_POLICY_URL = "https://skumar54uncc.github.io/Cortex/privacy-policy.html";
export const DATA_DELETION_URL = "https://skumar54uncc.github.io/Cortex/data-deletion.html";
export const TERMS_URL = "https://github.com/skumar54uncc/Cortex/blob/main/TERMS.md";
export const FEEDBACK_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSeC5bLybg056jJQzpohfgSX8r1OWlgtT7LSlSeHgvbT3CqQCQ/viewform";

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
