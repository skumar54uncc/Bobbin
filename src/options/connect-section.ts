/** Settings: Connect your AI, and the Warnings list in Privacy and data. */
import { renderConnectView } from "../guide/connect-view";
import { startGuide } from "../guide/start";
import { keepFresh, readSyncStatus } from "../guide/sync-status";
import type { SyncWarningRecord } from "../assistant-sync/db";

export function mountConnectSection(): void {
  const root = document.getElementById("cx-connect-root");
  if (!root) return;
  // Sync status and Enable live once on this page, in the Assistant Sync section.
  const view = renderConnectView(root, {
    status: readSyncStatus,
    enable: null,
    openSettings: () => {
      const section = document.getElementById("cx-sec-assistant");
      section?.scrollIntoView({ block: "start" });
      document.getElementById("cx-assistant-enable")?.focus();
    },
    start: startGuide,
  });
  keepFresh(view.refresh);
}

const FIELD: Record<SyncWarningRecord["field"], string> = { title: "Title", text: "Page text", post: "Post" };

export function mountWarnings(): void {
  const show = document.getElementById("cx-warnings-show") as HTMLButtonElement | null;
  const list = document.getElementById("cx-warnings-list");
  const empty = document.getElementById("cx-warnings-empty");
  if (!show || !list || !empty) return;
  show.addEventListener("click", () => {
    const open = show.getAttribute("aria-expanded") === "true";
    if (open) {
      show.setAttribute("aria-expanded", "false");
      show.textContent = "View warnings";
      list.hidden = true;
      empty.hidden = true;
      return;
    }
    show.disabled = true;
    void chrome.runtime
      .sendMessage({ type: "CORTEX_SYNC_WARNINGS" })
      .then((res: { ok?: boolean; warnings?: SyncWarningRecord[] } | undefined) => {
        const rows = res?.ok ? (res.warnings ?? []) : [];
        list.replaceChildren(
          ...rows.map((w) => {
            const li = document.createElement("li");
            const head = document.createElement("p");
            head.className = "cx-warnings-head";
            head.textContent = `${FIELD[w.field] ?? "Text"} on ${w.url}`;
            const quote = document.createElement("p");
            quote.className = "cx-warnings-snippet";
            quote.textContent = w.snippet;
            const meta = document.createElement("p");
            meta.className = "cx-field-hint";
            meta.textContent = `Looks like: ${w.flags.join(", ")}. Seen ${new Date(w.at).toLocaleString()}.`;
            li.append(head, quote, meta);
            return li;
          })
        );
        list.hidden = rows.length === 0;
        empty.hidden = rows.length > 0;
        empty.textContent = res?.ok ? "No warnings yet. Every page so far reads like ordinary content." : "Cortex could not load warnings. Try again.";
        show.setAttribute("aria-expanded", "true");
        show.textContent = "Hide warnings";
      })
      .finally(() => {
        show.disabled = false;
      });
  });
}
