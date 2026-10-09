/**
 * Connect AI Agents inside the Cortex panel. The panel frames this extension page so
 * Start setup and Enable run in an extension click (sidePanel.open and interactive sign-in need one).
 * Only the panel can frame it: the URL is dynamic, so a web page cannot load it on its own.
 */
import { renderAttachView, type InsertReply } from "../attach/attach-view";
import type { PacketItem } from "../attach/packet";
import { copyText } from "./clipboard";
import { renderConnectView } from "./connect-view";
import { enableFromClick } from "./enable-sync";
import { startGuide } from "./start";
import { keepFresh, openSettingsSection, readSyncStatus } from "./sync-status";

const theme = new URLSearchParams(location.search).get("theme");
document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";

const root = document.getElementById("cx-connect-root");
if (root) {
  const view = renderConnectView(root, {
    status: readSyncStatus,
    enable: enableFromClick,
    openSettings: () => openSettingsSection("cx-sec-assistant"),
    start: startGuide,
  });
  keepFresh(view.refresh);
}

const attach = document.getElementById("cx-attach-root");
if (attach) {
  renderAttachView(attach, {
    request: async (req) => {
      const res = (await chrome.runtime.sendMessage({ type: "CORTEX_PACKET_ITEMS", ...req })) as { ok?: boolean; items?: PacketItem[] } | undefined;
      return res?.ok ? (res.items ?? []) : null;
    },
    insert: async (text) => ((await chrome.runtime.sendMessage({ type: "CORTEX_PACKET_INSERT", text })) as InsertReply | undefined) ?? { ok: false, reason: "blocked" },
    copy: copyText,
  });
  if (new URLSearchParams(location.search).get("focus") === "attach") {
    attach.scrollIntoView({ block: "start" });
    attach.querySelector<HTMLInputElement>(".cx-attach-input")?.focus({ preventScroll: true });
  }
}
