import { assistantById, firstUrl, type AssistantId } from "../config/assistants";
import { newGuideState, saveGuide } from "./state";

export type StartResult = { ok: true; tabId: number } | { ok: false; error: string };

export const PANEL_FAILED =
  "The assistant opened in a new tab. Press the Bobbin button in the toolbar to see the steps beside it.";

/**
 * Opens the assistant's first page in a new tab and the guide in that tab's side panel.
 * Call it straight from the Start setup click: sidePanel.open needs that click.
 */
export async function startGuide(id: AssistantId): Promise<StartResult> {
  const assistant = assistantById(id);
  if (!assistant) return { ok: false, error: "Pick an assistant first." };
  const url = firstUrl(assistant);
  const tab = await chrome.tabs.create(url ? { url, active: true } : { active: true });
  if (tab.id == null) return { ok: false, error: "Bobbin could not open a tab." };
  const saved = saveGuide(newGuideState(id, tab.id));
  try {
    // The service worker sets the panel: it also points new tabs' panels at search, so it must know.
    const set = (await chrome.runtime.sendMessage({ type: "CORTEX_GUIDE_PANEL", tabId: tab.id })) as { ok?: boolean } | undefined;
    if (!set?.ok) throw new Error("guide_panel");
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch {
    await saved;
    return { ok: false, error: PANEL_FAILED };
  }
  await saved;
  return { ok: true, tabId: tab.id };
}
