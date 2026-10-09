/**
 * The setup checklist in the assistant tab's side panel. It copies to the clipboard and
 * navigates its own tab; it never types into or clicks anything on the assistant's site.
 */
import {
  assistantById,
  onAssistantSite,
  openableUrl,
  standingInstructionFor,
  stepForUrl,
  troubleshootingFor,
  type AssistantConfig,
} from "../config/assistants";
import { mascotHtml } from "../content/mascot";
import { copyText } from "./clipboard";
import { hasPointer } from "./pointer-targets";
import { GUIDE_KEY, guideKeyFor, HIDE_MESSAGE, loadGuide, POINT_MESSAGE, POINTER_SCRIPT, saveGuide, type GuideMap, type GuideState } from "./state";
import { keepFresh, openSettingsSection, readSyncStatus } from "./sync-status";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(className: string, text: string): HTMLButtonElement {
  const b = el("button", className, text);
  b.type = "button";
  return b;
}

/** Interactive sign-in. Runs only from the Enable click. */
function driveTokenFromClick(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (value) => {
      const err = chrome.runtime.lastError;
      if (err?.message || !value) reject(new Error(err?.message || "Sign in to Google is needed before Cortex can sync."));
      else resolve(value);
    });
  });
}

/** The step "Show me on the page" points at: the one the address matches, else the first one not ticked. */
export function pointerStep(a: AssistantConfig, state: Pick<GuideState, "done" | "highlight">): string | null {
  if (state.highlight) return state.highlight;
  return a.steps.find((s) => !state.done.includes(s.id))?.id ?? null;
}

const root = document.getElementById("cx-guide-root");
let state: GuideState | null = null;
let syncOn = true;

/** The tab this panel belongs to. The panel is set per tab, so it is the active tab when the panel loads. */
let myTab: number | null = null;

async function save(next: GuideState): Promise<void> {
  state = next;
  await saveGuide(next);
}

async function point(a: AssistantConfig, note: HTMLElement): Promise<void> {
  if (!state?.pointer || !a.origin) return;
  const tab = await chrome.tabs.get(state.tabId).catch(() => null);
  if (!tab || !onAssistantSite(a, tab.url)) {
    note.textContent = `Open ${a.name} in this tab and Cortex will point the way.`;
    return;
  }
  const step = pointerStep(a, state);
  if (!step) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: state.tabId }, files: [POINTER_SCRIPT] });
    await chrome.tabs.sendMessage(state.tabId, { type: POINT_MESSAGE, assistant: a.id, step });
    note.textContent = "Look for the Cortex card on the page.";
  } catch {
    note.textContent = "Cortex could not show the pointer on this page. Follow the steps here.";
  }
}

function hide(): void {
  if (state) void chrome.tabs.sendMessage(state.tabId, { type: HIDE_MESSAGE }).catch(() => undefined);
}

function render(): void {
  if (!root) return;
  root.replaceChildren();
  const a = state ? assistantById(state.assistant) : undefined;
  if (!state || !a) {
    const empty = el("div", "cx-guide-empty");
    empty.append(el("h1", "cx-guide-title", "No setup open"), el("p", undefined, "Start setup again from Connect AI Agents in the Cortex panel or Settings."));
    root.append(empty);
    return;
  }
  const current = state;
  const instruction = standingInstructionFor(a);

  const head = el("header", "cx-guide-head");
  const mascot = el("div", "cx-guide-mascot");
  mascot.innerHTML = mascotHtml(current.result === "yes" ? "connected" : "wave", 64);
  const headText = el("div");
  const doneCount = a.steps.filter((s) => current.done.includes(s.id)).length;
  headText.append(el("h1", "cx-guide-title", `Set up ${a.name}`), el("p", "cx-guide-progress", `${doneCount} of ${a.steps.length} steps done`));
  head.append(mascot, headText);
  root.append(head);
  if (a.tip) root.append(el("p", "cx-connect-tip", a.tip));

  const copied = el("p", "cx-connect-copied");
  copied.setAttribute("role", "status");

  if (!syncOn) {
    const sync = el("section", "cx-guide-sync");
    sync.append(el("p", "cx-connect-step-text", "First, turn on Assistant Sync. Cortex copies your memory to the Cortex Memory folder in your Google Drive."));
    const enable = button("cx-btn cx-btn-primary cx-connect-enable", "Enable");
    const feedback = el("p", "cx-guide-feedback");
    feedback.setAttribute("role", "status");
    enable.addEventListener("click", () => {
      enable.disabled = true;
      feedback.textContent = "";
      void driveTokenFromClick()
        .then(async (token) => {
          const res = (await chrome.runtime.sendMessage({ type: "CORTEX_ASSISTANT_SYNC", action: "enable", token })) as
            | { ok?: boolean; error?: string; status?: string }
            | undefined;
          if (res?.status === "confirm") {
            feedback.textContent = "Cortex has a question about an earlier Cortex Memory folder. Answer it in Settings.";
            const open = button("cx-btn cx-btn-secondary", "Open Settings");
            open.addEventListener("click", () => openSettingsSection("cx-sec-assistant"));
            feedback.append(" ", open);
          } else if (!res?.ok) feedback.textContent = res?.error || "Sync did not start.";
          else feedback.textContent = "Sync is on.";
        })
        .catch((error: unknown) => {
          feedback.textContent = error instanceof Error ? error.message : "Sign in to Google is needed before Cortex can sync.";
        })
        .finally(() => {
          enable.disabled = false;
          void refreshSync();
        });
    });
    sync.append(enable, feedback);
    root.append(sync);
  }

  const pointerNote = el("p", "cx-guide-pointer-note");
  pointerNote.setAttribute("role", "status");

  const ol = el("ol", "cx-guide-steps");
  a.steps.forEach((s, i) => {
    const li = el("li", "cx-guide-step");
    li.dataset.step = s.id;
    const done = current.done.includes(s.id);
    li.classList.toggle("is-done", done);
    if (current.highlight === s.id) {
      li.classList.add("is-here");
      li.setAttribute("aria-current", "step");
    }
    const check = el("label", "cx-guide-check");
    const box = el("input");
    box.type = "checkbox";
    box.checked = done;
    box.addEventListener("change", () => {
      const doneIds = box.checked ? [...new Set([...current.done, s.id])] : current.done.filter((d) => d !== s.id);
      void save({ ...current, done: doneIds }).then(() => {
        render();
        if (current.pointer) void point(a, pointerNote);
      });
    });
    check.append(box, el("span", undefined, `Step ${i + 1}${done ? ", done" : ""}`));
    const top = el("div", "cx-guide-actions");
    top.append(check);
    if (current.highlight === s.id) top.append(el("span", "cx-guide-here", "This page"));
    li.append(top, el("p", "cx-guide-text", s.text));

    const shot = el("figure", "cx-guide-shot");
    shot.append(el("div", "cx-guide-shot-img", "Picture coming soon"), el("figcaption", undefined, `What you'll see: ${s.see}`));
    li.append(shot);

    const link = s.open ? a[s.open] : null;
    const url = openableUrl(link);
    if (link && !url) li.append(el("p", "cx-connect-step-path", `Find it at: ${link.path}`));
    const actions = el("div", "cx-guide-actions");
    if (url) {
      const open = button("cx-btn cx-btn-secondary", "Open");
      open.setAttribute("aria-label", `Open ${link!.path}`);
      open.addEventListener("click", () => void chrome.tabs.update(current.tabId, { url, active: true }));
      actions.append(open);
    }
    if (s.copy) {
      const copy = button("cx-btn cx-btn-secondary", "Copy instruction");
      copy.addEventListener("click", () =>
        void copyText(instruction).then((ok) => {
          copied.textContent = ok ? "Copied. Paste it where the step says." : "Select the instruction below and copy it.";
        })
      );
      actions.append(copy);
    }
    if (s.id === "test") {
      const ask = el("p", "cx-guide-ask", "Did it answer from your Cortex Memory?");
      const yes = button("cx-btn cx-btn-primary", "Yes");
      const no = button("cx-btn cx-btn-secondary", "No");
      yes.addEventListener("click", () => void save({ ...current, result: "yes", done: [...new Set([...current.done, s.id])] }).then(render));
      no.addEventListener("click", () => void save({ ...current, result: "no" }).then(render));
      actions.append(yes, no);
      li.append(ask);
    }
    if (actions.childElementCount) li.append(actions);
    ol.append(li);
  });
  root.append(ol, copied);

  if (current.result === "yes") root.append(el("p", "cx-guide-success", `${a.name} is connected to your Cortex memory.`));

  const preview = el("details", "cx-connect-preview");
  const pre = el("pre", "cx-connect-instruction", instruction);
  pre.tabIndex = 0;
  preview.append(el("summary", undefined, "See the instruction"), pre);
  root.append(preview);

  if (a.origin && hasPointer(a.id)) {
    const pointer = el("section", "cx-guide-pointer");
    const label = el("label", "cx-guide-check");
    const toggle = el("input");
    toggle.type = "checkbox";
    toggle.checked = current.pointer;
    label.append(toggle, el("span", undefined, "Show me on the page"));
    const host = a.origin.replace(/^https:\/\//, "").replace(/\/\*$/, "");
    const hint = el("p", "cx-guide-hint", `Cortex asks Chrome for ${host} only. It outlines where to click and never clicks or types for you.`);
    toggle.addEventListener("change", () => {
      if (!toggle.checked) {
        hide();
        void save({ ...current, pointer: false });
        return;
      }
      void chrome.permissions.request({ origins: [a.origin!] }).then(async (granted) => {
        if (!granted) {
          toggle.checked = false;
          pointerNote.textContent = "Cortex needs that permission to point on the page. The steps here work without it.";
          return;
        }
        await save({ ...current, pointer: true });
        await point(a, pointerNote);
      });
    });
    pointer.append(label, hint, pointerNote);
    root.append(pointer);
  }

  const trouble = el("details", "cx-connect-trouble");
  trouble.open = current.result === "no";
  const list = el("ul", "cx-connect-trouble-list");
  list.replaceChildren(...troubleshootingFor(a).map((t) => el("li", undefined, t)));
  trouble.append(el("summary", undefined, "Troubleshooting"), list);
  root.append(trouble);
  if (current.result === "no") requestAnimationFrame(() => trouble.scrollIntoView({ block: "start" }));
}

async function refreshSync(): Promise<void> {
  const on = await readSyncStatus()
    .then((s) => s.on)
    .catch(() => true);
  if (on !== syncOn) {
    syncOn = on;
    render();
  }
}

async function setHighlight(url: string | undefined): Promise<void> {
  const a = state ? assistantById(state.assistant) : undefined;
  if (!state || !a || !url) return;
  const next = stepForUrl(a, url);
  if (next === state.highlight) return;
  await save({ ...state, highlight: next });
  render();
}

async function boot(): Promise<void> {
  // Opened as a normal tab (a link, or tests), the page is its own tab.
  const own = await chrome.tabs.getCurrent().catch(() => undefined);
  const [tab] = own ? [own] : await chrome.tabs.query({ active: true, currentWindow: true });
  myTab = tab?.id ?? null;
  state = myTab == null ? null : await loadGuide(myTab);
  syncOn = await readSyncStatus()
    .then((s) => s.on)
    .catch(() => true);
  render();
  if (state) {
    const tab = await chrome.tabs.get(state.tabId).catch(() => null);
    await setHighlight(tab?.url);
  }
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (!state || tabId !== state.tabId) return;
    if (info.url) void setHighlight(info.url);
    const a = assistantById(state.assistant);
    const note = root?.querySelector<HTMLElement>(".cx-guide-pointer-note");
    if (info.status === "complete" && state.pointer && a && note) void point(a, note);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "session" || !changes[GUIDE_KEY]) return;
    if (myTab == null) return;
    const next = (changes[GUIDE_KEY].newValue as GuideMap | undefined)?.[guideKeyFor(myTab)] ?? null;
    if (next && state && next.assistant === state.assistant) return;
    state = next;
    render();
  });
  keepFresh(refreshSync);
}

if (root) void boot();
