/**
 * "Show me on the page": a floating card and a pulsing outline on the assistant's site.
 * The guide panel injects this into its own tab only, after the user turns the pointer on.
 * It reads the page only to find the target, never clicks or types, and lets clicks through.
 */
import { assistantById, originOf, type AssistantId } from "../config/assistants";
import { findTarget, waitForTarget } from "./pointer-find";
import { pointerTarget } from "./pointer-targets";
import { HIDE_MESSAGE, POINT_MESSAGE } from "./state";

declare global {
  interface Window {
    __cortexGuidePointer?: boolean;
  }
}

const CSS = `
:host { all: initial; }
.card { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; box-sizing: border-box; width: min(300px, calc(100vw - 32px));
  padding: 12px 14px; border-radius: 14px; background: #fff9ef; color: #2e231d; border: 1px solid rgba(156, 59, 33, 0.35);
  box-shadow: 0 6px 20px rgba(46, 35, 29, 0.18); font: 14px/1.45 "Nunito", system-ui, sans-serif; pointer-events: auto; }
.top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 4px; }
.label { margin: 0; font-size: 12px; font-weight: 700; color: #9c3b21; }
.text { margin: 0; }
.note { margin: 6px 0 0; font-size: 12px; color: #6b5a4e; }
.close { font: inherit; font-size: 12px; font-weight: 700; border: 1px solid rgba(156, 59, 33, 0.35); background: #f8f1e6; color: #2e231d;
  border-radius: 999px; padding: 2px 10px; cursor: pointer; }
.close:focus-visible { outline: 2px solid #cd5f3e; outline-offset: 2px; }
.ring { position: fixed; z-index: 2147483646; pointer-events: none; border: 3px solid #cd5f3e; border-radius: 10px;
  box-shadow: 0 0 0 4px rgba(205, 95, 62, 0.25); animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 50% { box-shadow: 0 0 0 10px rgba(205, 95, 62, 0.05); } }
@media (prefers-reduced-motion: reduce) { .ring { animation: none; } }
`;

let host: HTMLElement | null = null;
let frame = 0;
let run = 0;

export function hidePointer(): void {
  run += 1;
  cancelAnimationFrame(frame);
  host?.remove();
  host = null;
}

export async function showPointer(assistant: AssistantId, stepId: string): Promise<"outlined" | "text" | "skipped"> {
  hidePointer();
  const a = assistantById(assistant);
  const step = a?.steps.find((s) => s.id === stepId);
  if (!a?.origin || !step || location.origin !== originOf(a.origin)) return "skipped";
  const mine = run;

  host = document.createElement("div");
  host.setAttribute("data-cortex-guide", "");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = CSS;
  const card = document.createElement("div");
  card.className = "card";
  card.setAttribute("role", "status");
  const top = document.createElement("div");
  top.className = "top";
  const label = document.createElement("p");
  label.className = "label";
  label.textContent = "Cortex setup";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "close";
  close.textContent = "Close";
  close.addEventListener("click", hidePointer);
  top.append(label, close);
  const text = document.createElement("p");
  text.className = "text";
  text.textContent = step.text;
  const note = document.createElement("p");
  note.className = "note";
  note.textContent = "Looking for it on this page.";
  card.append(top, text, note);
  shadow.append(style, card);
  document.documentElement.append(host);

  const def = pointerTarget(a.id, step.id);
  const ownHost = host;
  const target = def ? await waitForTarget(() => findTarget(document, def, undefined, ownHost)) : null;
  if (mine !== run) return "skipped";
  if (!target) {
    note.textContent = "Follow the step in words. The side panel has the full steps.";
    return "text";
  }
  note.textContent = "It is outlined on the page.";
  const ring = document.createElement("div");
  ring.className = "ring";
  shadow.append(ring);
  const place = () => {
    if (!target.isConnected) {
      ring.remove();
      note.textContent = "Follow the step in words. The side panel has the full steps.";
      return;
    }
    const r = target.getBoundingClientRect();
    ring.style.left = `${r.left - 6}px`;
    ring.style.top = `${r.top - 6}px`;
    ring.style.width = `${r.width + 12}px`;
    ring.style.height = `${r.height + 12}px`;
    frame = requestAnimationFrame(place);
  };
  place();
  return "outlined";
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage && !window.__cortexGuidePointer) {
  window.__cortexGuidePointer = true;
  chrome.runtime.onMessage.addListener((msg: { type?: string; assistant?: AssistantId; step?: string }, sender) => {
    if (sender.id !== chrome.runtime.id) return;
    if (msg?.type === HIDE_MESSAGE) hidePointer();
    if (msg?.type === POINT_MESSAGE && msg.assistant && msg.step) void showPointer(msg.assistant, msg.step);
  });
}
