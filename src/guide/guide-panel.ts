/**
 * The setup guide in the assistant tab's side panel: one step at a time, strictly in order.
 * It copies to the clipboard and navigates its own tab; it never types into or clicks
 * anything on the assistant's site.
 */
import {
  assistantById,
  completeStep,
  currentStep,
  onAssistantSite,
  openableUrl,
  samePage,
  standingInstructionFor,
  stepUrl,
  testQuestionFor,
  troubleshootingFor,
  type AssistantConfig,
  type GuideStep,
} from "../config/assistants";
import { mascotHtml } from "../content/mascot";
import { copyText } from "./clipboard";
import { enableFromClick } from "./enable-sync";
import { stepPointer } from "./pointer-targets";
import {
  DONE_MESSAGE,
  GUIDE_KEY,
  guideKeyFor,
  HIDE_MESSAGE,
  loadGuide,
  POINT_MESSAGE,
  POINTER_SCRIPT,
  saveGuide,
  type GuideMap,
  type GuideState,
} from "./state";
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

/** The primary button's words. On the step's own page, a copy step only copies. */
export function primaryLabel(a: AssistantConfig, step: GuideStep, tabUrl: string | undefined): string {
  const url = stepUrl(a, step);
  if (step.copy && url && samePage(url, tabUrl)) return step.copy === "test" ? "Copy the test question" : "Copy instruction";
  return step.button;
}

const root = document.getElementById("cx-guide-root");
let state: GuideState | null = null;
let syncOn = true;
let tabUrl: string | undefined;
/** Words under the current step, kept across renders until the step changes. */
let status = "";
/** Text to select by hand when the clipboard is unavailable. */
let manualCopy: string | null = null;

/** The tab this panel belongs to. The panel is set per tab, so it is the active tab when the panel loads. */
let myTab: number | null = null;

async function save(next: GuideState): Promise<void> {
  state = next;
  await saveGuide(next);
}

function hide(): void {
  if (state) void chrome.tabs.sendMessage(state.tabId, { type: HIDE_MESSAGE }).catch(() => undefined);
}

/** Points at the current step's control when the tab is on the assistant's site. Draws nothing otherwise. */
async function point(): Promise<void> {
  const a = state ? assistantById(state.assistant) : undefined;
  if (!state || !a) return;
  const step = currentStep(a, state.done);
  const tab = await chrome.tabs.get(state.tabId).catch(() => null);
  if (!step || !stepPointer(a.id, step.id) || !tab || !onAssistantSite(a, tab.url)) {
    hide();
    return;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: state.tabId }, files: [POINTER_SCRIPT] });
    await chrome.tabs.sendMessage(state.tabId, { type: POINT_MESSAGE, assistant: a.id, step: step.id });
  } catch {
    // The steps in the panel are enough.
  }
}

/** Sends the tab to the step's page, unless it is already there. */
async function go(url: string): Promise<void> {
  if (!state) return;
  if (samePage(url, tabUrl)) {
    await point();
    return;
  }
  await chrome.tabs.update(state.tabId, { url, active: true }).catch(() => undefined);
}

/**
 * Marks a step done and moves on: the tab goes to the next step's page and the pointer follows.
 * Only the current step can complete. After an instruction box completes on its own, the tab
 * stays put so an unsaved paste is never lost.
 */
async function complete(stepId: string, how: "manual" | "auto"): Promise<void> {
  const a = state ? assistantById(state.assistant) : undefined;
  if (!state || !a) return;
  const finished = a.steps.find((s) => s.id === stepId);
  const done = completeStep(a, state.done, stepId);
  if (!finished || !done) return;
  await save({ ...state, done });
  manualCopy = null;
  const keepPage = how === "auto" && stepPointer(a.id, stepId)?.done === "contains-cortex";
  status = keepPage ? "Done. Click Save on the page if you have not yet." : how === "auto" ? `Done: ${finished.title}.` : "";
  render();
  const next = currentStep(a, done);
  if (!next || keepPage) return;
  const url = stepUrl(a, next);
  if (url) await go(url);
  else await point();
}

async function runPrimary(a: AssistantConfig, step: GuideStep): Promise<void> {
  if (step.copy) {
    const text = step.copy === "test" ? testQuestionFor(a) : standingInstructionFor(a);
    const ok = await copyText(text);
    manualCopy = ok ? null : text;
    status = ok
      ? step.copy === "test"
        ? "Copied the test question. Paste it into the chat and send it."
        : a.instructionsMethod === "message"
          ? "Copied. Paste it into a chat and send it."
          : "Copied. Paste it where the outline points, then save."
      : "Copy did not work. Select the text below and copy it.";
  }
  const url = stepUrl(a, step);
  if (url) await go(url);
  if (!step.copy && !url) {
    await complete(step.id, "manual");
    return;
  }
  render();
}

function progress(a: AssistantConfig, current: GuideStep | null): HTMLElement {
  const wrap = el("div", "cx-guide-progress");
  const dots = el("span", "cx-guide-dots");
  dots.setAttribute("aria-hidden", "true");
  const at = current ? a.steps.indexOf(current) : a.steps.length;
  a.steps.forEach((_, i) => {
    const dot = el("span", "cx-guide-dot");
    if (i < at) dot.classList.add("is-done");
    if (i === at) dot.classList.add("is-current");
    dots.append(dot);
  });
  wrap.append(dots, el("span", undefined, current ? `Step ${at + 1} of ${a.steps.length}` : "All steps done"));
  return wrap;
}

function syncBlock(): HTMLElement {
  const sync = el("section", "cx-guide-sync");
  sync.append(el("p", "cx-guide-text", "First, turn on Assistant Sync. Cortex copies your memory to the Cortex Memory folder in your Google Drive."));
  const enable = button("cx-btn cx-btn-primary cx-connect-enable", "Enable");
  const feedback = el("p", "cx-guide-feedback");
  feedback.setAttribute("role", "status");
  enable.addEventListener("click", () => {
    enable.disabled = true;
    feedback.textContent = "";
    void enableFromClick()
      .then((res) => {
        feedback.textContent = res.message;
        if (res.needsSettings) {
          const open = button("cx-btn cx-btn-secondary", "Open Settings");
          open.addEventListener("click", () => openSettingsSection("cx-sec-assistant"));
          feedback.append(" ", open);
        }
      })
      .finally(() => {
        enable.disabled = false;
        void refreshSync();
      });
  });
  sync.append(enable, feedback);
  return sync;
}

function stepCard(a: AssistantConfig, s: GuideStep, current: GuideState): HTMLElement {
  const card = el("section", "cx-guide-step");
  card.dataset.step = s.id;
  card.setAttribute("aria-current", "step");
  card.append(el("h2", "cx-guide-step-title", s.title), el("p", "cx-guide-text", s.text));
  const link = s.open ? a[s.open] : null;
  if (link && !openableUrl(link)) card.append(el("p", "cx-guide-hint", `Find it at: ${link.path}`));

  const actions = el("div", "cx-guide-actions");
  const primary = button("cx-btn cx-btn-primary cx-guide-primary", primaryLabel(a, s, tabUrl));
  primary.addEventListener("click", () => void runPrimary(a, s));
  actions.append(primary);
  card.append(actions);

  if (s.id === "test") {
    const ask = el("div", "cx-guide-ask");
    ask.append(el("p", "cx-guide-text", "Did it answer from your Cortex Memory?"));
    const answers = el("div", "cx-guide-actions");
    const yes = button("cx-btn cx-btn-secondary", "Yes");
    const no = button("cx-btn cx-btn-secondary", "No");
    yes.addEventListener("click", () => {
      void save({ ...current, result: "yes" }).then(() => complete(s.id, "manual"));
    });
    no.addEventListener("click", () => {
      status = "";
      void save({ ...current, result: "no" }).then(render);
    });
    answers.append(yes, no);
    ask.append(answers);
    card.append(ask);
  } else {
    const did = button("cx-guide-link", "I did this");
    did.addEventListener("click", () => void complete(s.id, "manual"));
    card.append(did);
  }

  const note = el("p", "cx-guide-feedback", status);
  note.setAttribute("role", "status");
  card.append(note);
  if (manualCopy) {
    const pre = el("pre", "cx-connect-instruction", manualCopy);
    pre.tabIndex = 0;
    card.append(pre);
  }
  return card;
}

function render(): void {
  if (!root) return;
  root.replaceChildren();
  const a = state ? assistantById(state.assistant) : undefined;
  if (!state || !a) {
    const empty = el("div", "cx-guide-empty");
    empty.append(el("h1", "cx-guide-title", "No setup open"), el("p", undefined, "Start setup again from Connect your AI in the Cortex panel or Settings."));
    root.append(empty);
    return;
  }
  const current = state;
  const step = currentStep(a, current.done);

  const head = el("header", "cx-guide-head");
  const mascot = el("div", "cx-guide-mascot");
  mascot.innerHTML = mascotHtml(step ? "wave" : "connected", 64);
  const headText = el("div");
  headText.append(el("h1", "cx-guide-title", `Set up ${a.name}`), progress(a, step));
  head.append(mascot, headText);
  root.append(head, el("p", "cx-guide-plan", a.plan));

  if (!syncOn) root.append(syncBlock());

  const finished = a.steps.filter((s) => current.done.includes(s.id));
  if (finished.length) {
    const list = el("ul", "cx-guide-done");
    for (const s of finished) {
      const li = el("li");
      const mark = el("span", "cx-guide-check-mark", "\u2713");
      mark.setAttribute("aria-hidden", "true");
      li.append(mark, `${s.title}, done`);
      list.append(li);
    }
    root.append(list);
  }

  if (step) root.append(stepCard(a, step, current));
  else root.append(el("p", "cx-guide-success", `${a.name} is connected to your Cortex memory.`));

  const trouble = el("details", "cx-connect-trouble");
  trouble.open = current.result === "no";
  const list = el("ul", "cx-connect-trouble-list");
  list.replaceChildren(...troubleshootingFor(a).map((t) => el("li", undefined, t)));
  trouble.append(el("summary", undefined, "Troubleshooting"), list);
  root.append(trouble);
  if (current.result === "no") requestAnimationFrame(() => trouble.scrollIntoView?.({ block: "start" }));
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

async function boot(): Promise<void> {
  // Opened as a normal tab (a link, or tests), the page is its own tab.
  const own = await chrome.tabs.getCurrent().catch(() => undefined);
  const [tab] = own ? [own] : await chrome.tabs.query({ active: true, currentWindow: true });
  myTab = tab?.id ?? null;
  state = myTab == null ? null : await loadGuide(myTab);
  syncOn = await readSyncStatus()
    .then((s) => s.on)
    .catch(() => true);
  if (state) tabUrl = (await chrome.tabs.get(state.tabId).catch(() => null))?.url;
  render();
  void point();
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (!state || tabId !== state.tabId) return;
    if (info.url) {
      tabUrl = info.url;
      render();
    }
    if (info.status === "complete") void point();
  });
  chrome.runtime.onMessage.addListener((msg: { type?: string; assistant?: string; step?: string }, sender) => {
    if (msg?.type !== DONE_MESSAGE || sender.id !== chrome.runtime.id) return;
    if (!state || sender.tab?.id !== state.tabId || msg.assistant !== state.assistant || !msg.step) return;
    void complete(msg.step, "auto");
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "session" || !changes[GUIDE_KEY]) return;
    if (myTab == null) return;
    const next = (changes[GUIDE_KEY].newValue as GuideMap | undefined)?.[guideKeyFor(myTab)] ?? null;
    if (next && state && next.assistant === state.assistant) return;
    state = next;
    status = "";
    manualCopy = null;
    render();
    void point();
  });
  keepFresh(refreshSync);
}

if (root) void boot();
