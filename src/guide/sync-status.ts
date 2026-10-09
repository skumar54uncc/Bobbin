import type { SyncStatus } from "./connect-view";

type StatusReply =
  | { ok?: boolean; state?: { syncEnabled?: boolean; lastError?: string | null }; statusLine?: string }
  | undefined;

export async function readSyncStatus(): Promise<SyncStatus> {
  const res = (await chrome.runtime.sendMessage({ type: "CORTEX_ASSISTANT_SYNC", action: "status" })) as StatusReply;
  if (!res?.ok || !res.state) return { on: false, line: "", problem: false };
  const on = res.state.syncEnabled === true;
  return { on, line: res.statusLine ?? "", problem: on && !!res.state.lastError };
}

/** Refreshes every few seconds while the page is visible. */
export function keepFresh(refresh: () => Promise<void>, everyMs = 5000): void {
  window.setInterval(() => {
    if (document.visibilityState === "visible") void refresh();
  }, everyMs);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refresh();
  });
}

export function openSettingsSection(section: string): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL(`options.html#${section}`), active: true });
}
