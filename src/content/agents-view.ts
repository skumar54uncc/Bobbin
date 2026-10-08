/**
 * Connect AI Agents: pick an assistant, copy its prompt, open Assist Sync.
 */
import {
  AGENT_PROMPT_TEMPLATES,
  AGENTS_INTRO_BODY,
  AGENTS_INTRO_TITLE,
  AGENTS_SHEET_RULES,
  AGENTS_STEPS,
  SHARED_AGENT_PROMPT,
  type AgentPromptId,
} from "../shared/agent-prompts";
import { mascotHtml } from "./mascot";

export interface AgentsViewDeps {
  openAssistSyncSettings: () => void;
  announce?: (msg: string) => void;
}

const AGENT_NOTE: Record<AgentPromptId, string> = {
  claude: "Drive connector",
  chatgpt: "Connected Drive",
  gemini: "Drive extension",
  cursor: "Sheet in the repo chat",
  generic: "Any assistant",
};

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function renderAgentsView(container: HTMLElement, deps: AgentsViewDeps): void {
  container.replaceChildren();

  const root = el("div", "cortex-agents");
  const scroll = el("div", "cortex-agents-scroll");

  const hero = el("div", "cortex-agents-hero");
  const mascotHost = el("div", "cortex-agents-mascot");
  mascotHost.innerHTML = mascotHtml("wave", 96);
  const intro = el("div");
  intro.append(el("h2", "cortex-agents-title", AGENTS_INTRO_TITLE), el("p", "cortex-agents-lead", AGENTS_INTRO_BODY));
  const enableBtn = el("button", "cortex-agents-primary") as HTMLButtonElement;
  enableBtn.type = "button";
  enableBtn.textContent = "Open Assistant Sync";
  enableBtn.setAttribute("data-cortex-open-assist-sync", "1");
  enableBtn.addEventListener("click", () => deps.openAssistSyncSettings());
  hero.append(mascotHost, intro, enableBtn);
  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    void chrome.runtime.sendMessage({ type: "CORTEX_SYNC_LABEL" }, (resp?: { phase?: string }) => {
      if (chrome.runtime.lastError) return;
      const phase = resp?.phase;
      if (phase !== "wave" && phase !== "syncing" && phase !== "connected" && phase !== "lost") return;
      mascotHost.innerHTML = mascotHtml(phase, 96);
      if (phase === "lost") enableBtn.textContent = "Fix Assistant Sync";
    });
  }

  const layout = el("div", "cortex-agents-layout");
  const rail = el("div", "cortex-agents-rail");
  rail.setAttribute("role", "tablist");
  rail.setAttribute("aria-label", "Assistant");
  const stage = el("section", "cortex-agents-stage");
  const stageHead = el("div", "cortex-agents-stage-head");
  const howto = el("p", "cortex-agents-howto");
  const copyBtn = el("button", "cortex-agents-copy") as HTMLButtonElement;
  copyBtn.type = "button";
  copyBtn.textContent = "Copy prompt";
  stageHead.append(howto, copyBtn);
  const pre = el("pre", "cortex-agents-prompt");
  pre.setAttribute("tabindex", "0");
  const status = el("p", "cortex-agents-copy-status");
  status.setAttribute("role", "status");
  status.hidden = true;
  stage.append(stageHead, pre, status);

  let active: AgentPromptId = "claude";
  const cards = new Map<AgentPromptId, HTMLButtonElement>();
  const apply = (id: AgentPromptId): void => {
    active = id;
    const t = AGENT_PROMPT_TEMPLATES.find((x) => x.id === id)!;
    howto.textContent = t.howto;
    pre.textContent = t.prompt;
    for (const [key, btn] of cards) {
      const on = key === id;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    }
  };

  for (const t of AGENT_PROMPT_TEMPLATES) {
    const btn = el("button", "cortex-agents-card") as HTMLButtonElement;
    btn.type = "button";
    btn.setAttribute("role", "tab");
    btn.setAttribute("data-agent", t.id);
    btn.append(el("span", "cortex-agents-card-name", t.label), el("span", "cortex-agents-card-note", AGENT_NOTE[t.id]));
    btn.addEventListener("click", () => apply(t.id));
    cards.set(t.id, btn);
    rail.appendChild(btn);
  }

  copyBtn.addEventListener("click", () => {
    const text = pre.textContent || SHARED_AGENT_PROMPT;
    void copyText(text).then((ok) => {
      status.hidden = false;
      status.textContent = ok ? "Copied." : "Could not copy. Select the prompt and copy it yourself.";
      deps.announce?.(ok ? "Prompt copied." : "Copy failed.");
      window.setTimeout(() => {
        status.hidden = true;
      }, 2000);
    });
  });

  layout.append(rail, stage);

  const more = el("details", "cortex-agents-more");
  const summary = el("summary", undefined, "Setup and sheet rules");
  const moreBody = el("div", "cortex-agents-more-body");
  const stepsCol = el("div");
  stepsCol.appendChild(el("h3", "cortex-agents-h", "Setup"));
  const ol = el("ol", "cortex-agents-steps");
  for (const step of AGENTS_STEPS) ol.appendChild(el("li", undefined, step));
  stepsCol.appendChild(ol);
  const rulesCol = el("div");
  rulesCol.appendChild(el("h3", "cortex-agents-h", "What the prompt already says"));
  const ul = el("ul", "cortex-agents-rules");
  for (const rule of AGENTS_SHEET_RULES) ul.appendChild(el("li", undefined, rule));
  rulesCol.appendChild(ul);
  moreBody.append(stepsCol, rulesCol);
  more.append(summary, moreBody);

  scroll.append(hero, layout, more);
  root.appendChild(scroll);
  container.appendChild(root);
  apply(active);
}
