/**
 * Connect AI Agents inside the Cortex panel. The panel frames this extension page so
 * Start setup and Enable run in an extension click (sidePanel.open and interactive sign-in need one).
 * Only the panel can frame it: the URL is dynamic, so a web page cannot load it on its own.
 */
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
