/**
 * Challenge, captcha, and login wall pages. They are never recorded: not in the sheet, not in a
 * Pages doc, not in the local library. When the real page renders on the same address (the
 * check passes, the client render finishes), its new title triggers a fresh capture.
 */

/** A whole title, optionally followed by " | Site", " - Site", " · Site", or ": Site". */
const CHALLENGE_TITLE = new RegExp(
  "^(" +
    [
      "security verification",
      "just a moment\\.{0,3}",
      "attention required!?",
      "one more step",
      "checking your browser.*",
      "verify(ing)? (that )?you are (a )?human",
      "are you a (robot|human)\\??",
      "human verification",
      "please wait\\.{0,3}",
      "ddos-guard",
      "access denied",
      "(re|h)?captcha",
      "bot verification",
      "linkedin app challenge",
      "join linkedin",
      "linkedin login, sign in",
      "sign ?in( or join( now)?| to linkedin)?",
      "sign ?up",
      "log ?in",
      "create (an |your )?account",
    ].join("|") +
    ")(\\s*[|\\-\u2013\u2014\u00b7:]\\s*.*)?$",
  "i"
);

/** Login wall and checkpoint paths on LinkedIn. */
const LINKEDIN_WALL_PATH = /^\/(checkpoint\/|authwall|uas\/|login|signup|start\/join|reg\/)/i;

/** Hosts that only ever serve a challenge. */
const CHALLENGE_HOSTS = ["challenges.cloudflare.com", "hcaptcha.com", "newassets.hcaptcha.com"];

/** Words an interstitial shows instead of the page. Checked only on short text. */
const CHALLENGE_TEXT =
  /(checking if the site connection is secure|verify you are human by completing the action below|needs to review the security of your connection|enable javascript and cookies to continue|performance (and|&) security by cloudflare|please complete the security check|unusual traffic from your computer network|press (&|and) hold to confirm you are a human)/i;
const CHALLENGE_TEXT_MAX = 1500;

function isLinkedIn(host: string): boolean {
  return host === "linkedin.com" || host.endsWith(".linkedin.com");
}

export function isChallengeUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (CHALLENGE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return true;
  if (isLinkedIn(host) && LINKEDIN_WALL_PATH.test(url.pathname)) return true;
  if (url.pathname.startsWith("/cdn-cgi/challenge-platform")) return true;
  for (const key of url.searchParams.keys()) if (key.startsWith("__cf_chl")) return true;
  // Google's "unusual traffic" captcha and the reCAPTCHA frame.
  if (/(^|\.)google\.[a-z.]+$/.test(host) && /^\/(sorry\/|recaptcha\/)/.test(url.pathname)) return true;
  if (/(^|\.)amazon\.[a-z.]+$/.test(host) && url.pathname.startsWith("/errors/validateCaptcha")) return true;
  return false;
}

export function isChallengeTitle(title: string | null | undefined): boolean {
  const clean = (title ?? "").replace(/\s+/g, " ").trim();
  return clean !== "" && CHALLENGE_TITLE.test(clean);
}

export function isChallengeText(text: string | null | undefined): boolean {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  return clean.length <= CHALLENGE_TEXT_MAX && CHALLENGE_TEXT.test(clean);
}

export function isChallengePage(page: { url: string; title?: string | null; text?: string | null }): boolean {
  return isChallengeUrl(page.url) || isChallengeTitle(page.title) || isChallengeText(page.text);
}
