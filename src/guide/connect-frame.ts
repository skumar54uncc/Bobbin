/**
 * Connect AI Agents inside the Cortex panel. The panel frames this extension page so
 * Start setup runs in an extension click, which sidePanel.open needs.
 * Enable is not offered here: a web page hosts this frame, so Enable stays in Settings.
 */
import { renderConnectView } from "./connect-view";
import { startGuide } from "./start";
import { keepFresh, openSettingsSection, readSyncStatus } from "./sync-status";

const theme = new URLSearchParams(location.search).get("theme");
document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";

const root = document.getElementById("cx-connect-root");
if (root) {
  const view = renderConnectView(root, {
    status: readSyncStatus,
    enable: null,
    openSettings: () => openSettingsSection("cx-sec-connect"),
    start: startGuide,
  });
  keepFresh(view.refresh);
}
