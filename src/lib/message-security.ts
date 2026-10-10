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

/** The setup side panel. It opens beside the assistant tab, so it has no tab of its own. */
export function isGuidePanelSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  return (sender.url ?? "").startsWith(chrome.runtime.getURL("guide-panel.html"));
}

/**
 * The Connect frame inside the Cortex panel. It sits in a web page, so sender.tab is set, but
 * sender.url is the extension page: a content script or the page itself reports the page URL.
 * connect-frame.html uses use_dynamic_url, so getURL() for it can name the dynamic id while the
 * frame reports the extension id: accept either.
 */
export function isConnectFrameSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  const url = sender.url ?? "";
  return [`chrome-extension://${chrome.runtime.id}/connect-frame.html`, chrome.runtime.getURL("connect-frame.html")].some((u) => url.startsWith(u));
}

/** Any Cortex extension page, including connect-frame.html framed in a web page. Not content scripts. */
export function isExtensionPageSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  return (sender.url ?? "").startsWith(chrome.runtime.getURL(""));
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
