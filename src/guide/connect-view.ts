/**
 * Connect your AI: status, assistant grid, the chosen assistant's guide, troubleshooting.
 * Rendered in Settings and in connect-frame.html inside the Cortex panel.
 */
import { ASSISTANTS, firstUrl, troubleshootingFor, type AssistantConfig, type AssistantId } from "../config/assistants";
import { mascotHtml } from "../content/mascot";
import type { EnableResult } from "./enable-sync";

export const CONNECT_TITLE = "Connect your AI to your Bobbin memory";
export const CONNECT_LEAD = "Pick your assistant. Bobbin opens the right page and walks you through it. About 3 minutes.";

export interface SyncStatus {
  on: boolean;
  line: string;
  problem: boolean;
}

export interface ConnectDeps {
  status: () => Promise<SyncStatus>;
  /**
   * Inline Enable, run from the click, with the sync status card above the cards.
   * Null in Settings: the Assistant Sync section there already has both, so the view only
   * points to it while sync is off.
   */
  enable: (() => Promise<EnableResult>) | null;
  /** Opens Settings at Assistant Sync (from the panel), or scrolls to it (in Settings). */
  openSettings: () => void;
  start: (id: AssistantId) => Promise<{ ok: boolean; error?: string }>;
}

export interface ConnectView {
  refresh: () => Promise<void>;
  select: (id: AssistantId) => void;
}

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

export function renderConnectView(container: HTMLElement, deps: ConnectDeps): ConnectView {
  container.replaceChildren();
  const root = el("div", "cx-connect");

  const head = el("header", "cx-connect-head");
  const mascot = el("div", "cx-connect-mascot");
  mascot.innerHTML = mascotHtml("wave", 72);
  const headText = el("div");
  headText.append(el("h2", "cx-connect-title", CONNECT_TITLE), el("p", "cx-connect-lead", CONNECT_LEAD));
  head.append(mascot, headText);

  const status = el("section", "cx-connect-status");
  status.setAttribute("aria-live", "polite");
  const statusDot = el("span", "cx-connect-dot");
  statusDot.setAttribute("aria-hidden", "true");
  const statusText = el("div", "cx-connect-status-text");
  const statusTitle = el("p", "cx-connect-status-title", "Checking Assistant Sync");
  const statusLine = el("p", "cx-connect-status-line");
  const statusAction = el("div", "cx-connect-status-action");
  const statusButton = button("cx-btn cx-btn-primary cx-connect-enable", deps.enable ? "Enable" : "Go to Assistant Sync");
  const feedback = el("p", "cx-connect-status-line cx-connect-feedback");
  feedback.setAttribute("role", "status");
  statusAction.append(statusButton);
  statusText.append(statusTitle, statusLine, statusAction, feedback);
  status.append(statusDot, statusText);

  const gridLabel = el("h3", "cx-connect-h", "Your assistant");
  gridLabel.id = `cx-connect-grid-h-${Math.random().toString(36).slice(2, 8)}`;
  const grid = el("div", "cx-connect-grid");
  grid.setAttribute("role", "radiogroup");
  grid.setAttribute("aria-labelledby", gridLabel.id);

  const guide = el("section", "cx-connect-guide");
  guide.hidden = true;

  const trouble = el("details", "cx-connect-trouble");
  const troubleList = el("ul", "cx-connect-trouble-list");
  trouble.append(el("summary", undefined, "Troubleshooting"), troubleList);

  let active: AssistantConfig | null = null;
  const cards = new Map<AssistantId, HTMLButtonElement>();

  const paintTrouble = () => {
    troubleList.replaceChildren(...troubleshootingFor(active).map((t) => el("li", undefined, t)));
  };

  statusButton.addEventListener("click", () => {
    const enable = deps.enable;
    if (!enable) {
      deps.openSettings();
      return;
    }
    statusButton.disabled = true;
    feedback.replaceChildren();
    void enable()
      .then((res) => {
        feedback.textContent = res.message;
        if (res.needsSettings) {
          const open = button("cx-btn cx-btn-secondary", "Open Settings");
          open.addEventListener("click", () => deps.openSettings());
          feedback.append(" ", open);
        }
      })
      .finally(() => {
        statusButton.disabled = false;
        void refresh();
      });
  });

  const paintGuide = () => {
    guide.replaceChildren();
    const a = active;
    guide.hidden = !a;
    if (!a) return;
    guide.append(el("h3", "cx-connect-h", `Set up ${a.name}`));
    const ol = el("ol", "cx-connect-steps");
    for (const s of a.steps) {
      const li = el("li", "cx-connect-step", s.title);
      li.dataset.step = s.id;
      ol.append(li);
    }

    const start = button("cx-btn cx-btn-primary cx-connect-start", "Start setup");
    start.dataset.assistant = a.id;
    const startNote = el("p", "cx-connect-start-note");
    startNote.setAttribute("role", "status");
    startNote.textContent = `Bobbin opens ${firstUrl(a) ? `${a.name} in a new tab` : "a new tab"} and shows these steps in the side panel beside it.`;
    start.addEventListener("click", () => {
      start.disabled = true;
      void deps
        .start(a.id)
        .then((res) => {
          if (!res.ok) startNote.textContent = res.error || "Setup did not start.";
        })
        .catch(() => {
          startNote.textContent = "Setup did not start.";
        })
        .finally(() => {
          start.disabled = false;
        });
    });
    guide.append(ol, start, startNote);
  };

  const select = (id: AssistantId) => {
    active = ASSISTANTS.find((a) => a.id === id) ?? null;
    for (const [key, card] of cards) {
      const on = key === id;
      card.classList.toggle("is-active", on);
      card.setAttribute("aria-checked", on ? "true" : "false");
    }
    paintGuide();
    paintTrouble();
  };

  for (const a of ASSISTANTS) {
    const card = button("cx-connect-card", "");
    card.setAttribute("role", "radio");
    card.setAttribute("aria-checked", "false");
    card.dataset.assistant = a.id;
    card.append(el("span", "cx-connect-card-name", a.name));
    if (a.badge) card.append(el("span", "cx-connect-badge", a.badge));
    card.append(el("span", "cx-connect-card-plan", a.plan));
    card.addEventListener("click", () => select(a.id));
    cards.set(a.id, card);
    grid.append(card);
  }

  const refresh = async () => {
    let s: SyncStatus;
    try {
      s = await deps.status();
    } catch {
      s = { on: false, line: "Bobbin could not read the sync status.", problem: true };
    }
    status.dataset.state = s.problem ? "problem" : s.on ? "on" : "off";
    statusTitle.textContent = s.problem ? "Assistant Sync needs attention" : s.on ? "Assistant Sync is on" : "Assistant Sync is off";
    if (deps.enable) statusLine.textContent = s.on || s.problem ? s.line : "Turn it on so your assistant has something to read.";
    else statusLine.textContent = s.problem ? s.line : "Turn it on in Assistant Sync above so your assistant has something to read.";
    statusAction.hidden = s.on;
    if (s.on) feedback.replaceChildren();
    // Settings shows sync status and Enable once, in its Assistant Sync section.
    status.hidden = !deps.enable && s.on && !s.problem;
    if (guide.childElementCount === 0) paintGuide();
  };

  root.append(head, status, gridLabel, grid, guide, trouble);
  container.append(root);
  paintTrouble();
  void refresh();
  return { refresh, select };
}
