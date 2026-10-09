/** Trust-boundary helpers for extension messaging (Security Review 1). */

/** Service worker, offscreen, options, popup — not content scripts on web pages. */
export function isPrivilegedExtensionSender(
  sender: chrome.runtime.MessageSender
): boolean {
  if (sender.id !== undefined && sender.id !== chrome.runtime.id) {
    return false;
  }
  return sender.tab == null;
}

export function isOptionsPageSender(
  sender: chrome.runtime.MessageSender
): boolean {
  const u = sender.url ?? "";
  return u.startsWith(chrome.runtime.getURL("options.html"));
}

/** Live index payloads must match the tab that sent CORTEX_INDEX. */
export function indexPayloadUrlMatchesTab(
  payloadUrl: string,
  sender: chrome.runtime.MessageSender
): boolean {
  const tabUrl = sender.tab?.url;
  if (!tabUrl) return false;

  try {
    const a = new URL(payloadUrl);
    const b = new URL(tabUrl);
    a.hash = "";
    b.hash = "";
    return a.href === b.href;
  } catch {
    return false;
  }
}

function withoutHash(raw: string): string | null {
  try {
    const url = new URL(raw);
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

/**
 * A dwell report names the tab's current page, or, for a final report only, the page the
 * tab was cleared to measure. The final report is sent because the address changed, so by
 * the time it arrives the tab already shows the next page.
 */
export function dwellReportPageOk(
  report: { url: string; final: boolean },
  tabUrl: string | undefined,
  measuredUrl: string | undefined
): boolean {
  const page = withoutHash(report.url);
  if (!page) return false;
  if (tabUrl && page === withoutHash(tabUrl)) return true;
  return report.final && !!measuredUrl && page === withoutHash(measuredUrl);
}
