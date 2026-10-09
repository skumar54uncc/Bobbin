/**
 * Connect your AI: status, assistant grid, the chosen assistant's guide, troubleshooting.
 * Rendered in Settings and in connect-frame.html inside the Cortex panel.
 */
import { ASSISTANTS, firstUrl, troubleshootingFor, type AssistantConfig, type AssistantId } from "../config/assistants";
import { mascotHtml } from "../content/mascot";

export const CONNECT_TITLE = "Connect your AI to your Cortex memory";
export const CONNECT_LEAD = "Pick your assistant. Cortex opens the right page and walks you through it. About 3 minutes.";

export interface SyncStatus {
  on: boolean;
  line: string;
  problem: boolean;
}

export interface ConnectDeps {
  status: () => Promise<SyncStatus>;
  /** Inline Enable. Null where Enable cannot run (a web page frame): the button opens Settings instead. */
  enable: (() => void) | null;
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
  statusText.append(statusTitle, statusLine);
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

  let syncOn = false;
  let active: AssistantConfig | null = null;
  const cards = new Map<AssistantId, HTMLButtonElement>();

  const paintTrouble = () => {
    troubleList.replaceChildren(...troubleshootingFor(active).map((t) => el("li", undefined, t)));
  };

  const enableStep = (): HTMLLIElement => {
    const li = el("li", "cx-connect-step cx-connect-step--sync");
    li.dataset.step = "sync";
    li.append(el("p", "cx-connect-step-text", "Turn on Assistant Sync. Cortex copies your memory to the Cortex Memory folder in your Google Drive."));
    const on = button("cx-btn cx-btn-primary cx-connect-enable", deps.enable ? "Enable" : "Turn on in Settings");
    on.addEventListener("click", () => (deps.enable ? deps.enable() : deps.openSettings()));
    li.append(on);
    return li;
  };

  const paintGuide = () => {
    guide.replaceChildren();
    const a = active;
    guide.hidden = !a;
    if (!a) return;
    guide.append(el("h3", "cx-connect-h", `Set up ${a.name}`));
    const ol = el("ol", "cx-connect-steps");
    if (!syncOn) ol.append(enableStep());
    for (const s of a.steps) {
      const li = el("li", "cx-connect-step", s.title);
      li.dataset.step = s.id;
      ol.append(li);
    }

    const start = button("cx-btn cx-btn-primary cx-connect-start", "Start setup");
    start.dataset.assistant = a.id;
    const startNote = el("p", "cx-connect-start-note");
    startNote.setAttribute("role", "status");
    startNote.textContent = `Cortex opens ${firstUrl(a) ? `${a.name} in a new tab` : "a new tab"} and shows these steps in the side panel beside it.`;
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
      s = { on: false, line: "Cortex could not read the sync status.", problem: true };
    }
    const changed = s.on !== syncOn;
    syncOn = s.on;
    status.dataset.state = s.problem ? "problem" : s.on ? "on" : "off";
    statusTitle.textContent = s.problem ? "Assistant Sync needs attention" : s.on ? "Assistant Sync is on" : "Assistant Sync is off";
    statusLine.textContent = s.on || s.problem ? s.line : "Turn it on so your assistant has something to read.";
    if (changed || guide.childElementCount === 0) paintGuide();
  };

  root.append(head, status, gridLabel, grid, guide, trouble);
  container.append(root);
  paintTrouble();
  void refresh();
  return { refresh, select };
}
