/**
 * The on-page pointer: an outline and a short label on the control the step needs.
 * The guide panel injects this into its own tab only, on the assistant's site.
 * It reads the page only to find the target and to see whether the step is done.
 * It never clicks or types, draws nothing unless it is confident, and lets clicks through.
 */
import { assistantById, originOf, type AssistantId } from "../config/assistants";
import { connectedControl, findFirst, isDone, isShown, type IsVisible } from "./pointer-find";
import { pointerLabel, stepPointer, type StepPointer } from "./pointer-targets";
import { DONE_MESSAGE, HIDE_MESSAGE, POINT_MESSAGE } from "./state";

declare global {
  interface Window {
    __cortexGuidePointer?: boolean;
  }
}

const CSS = `
:host { all: initial; }
.ring { position: fixed; z-index: 2147483646; pointer-events: none; border: 3px solid #cd5f3e; border-radius: 10px;
  box-shadow: 0 0 0 4px rgba(205, 95, 62, 0.25); animation: pulse 1.4s ease-in-out infinite; }
.tag { position: fixed; z-index: 2147483647; pointer-events: none; max-width: 260px; padding: 4px 10px; border-radius: 999px;
  background: #9c3b21; color: #fff; font: 700 13px/1.35 "Nunito", system-ui, sans-serif; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; box-shadow: 0 4px 12px rgba(46, 35, 29, 0.25); }
@keyframes pulse { 50% { box-shadow: 0 0 0 10px rgba(205, 95, 62, 0.05); } }
@media (prefers-reduced-motion: reduce) { .ring { animation: none; } }
`;

/** The first, visible search. After it, nothing shows unless the target turns up later. */
export const FIRST_LOOK_MS = 3000;
const FIRST_EVERY_MS = 200;
/** Later checks, for pages that change without loading (menus, dialogs, saved toggles). */
const LATER_EVERY_MS = 1000;
const LATER_LOOKS = 180;

export type PointResult = "outlined" | "none" | "done" | "skipped";

let host: HTMLElement | null = null;
let frame = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let run = 0;

let drawn: { target: Element; label: string } | null = null;

/** What is outlined now, for tests: the shadow root is closed. */
export function shownPointer(): { target: Element; label: string } | null {
  return host ? drawn : null;
}

function clearDrawing(): void {
  cancelAnimationFrame(frame);
  host?.remove();
  host = null;
  drawn = null;
}

export function hidePointer(): void {
  run += 1;
  clearTimeout(timer);
  clearDrawing();
}

function isMac(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

function draw(target: Element, text: string): void {
  clearDrawing();
  host = document.createElement("div");
  host.setAttribute("data-cortex-guide", "");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = CSS;
  const ring = document.createElement("div");
  ring.className = "ring";
  const tag = document.createElement("div");
  tag.className = "tag";
  tag.setAttribute("role", "status");
  tag.textContent = text;
  shadow.append(style, ring, tag);
  document.documentElement.append(host);
  drawn = { target, label: text };
  target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  const place = () => {
    if (!target.isConnected) {
      clearDrawing();
      return;
    }
    const r = target.getBoundingClientRect();
    ring.style.left = `${r.left - 6}px`;
    ring.style.top = `${r.top - 6}px`;
    ring.style.width = `${r.width + 12}px`;
    ring.style.height = `${r.height + 12}px`;
    const below = r.bottom + 40 < window.innerHeight;
    tag.style.left = `${Math.max(8, r.left - 6)}px`;
    tag.style.top = below ? `${r.bottom + 10}px` : `${Math.max(8, r.top - 38)}px`;
    frame = requestAnimationFrame(place);
  };
  place();
}

type Look = { kind: "done"; el: Element | null } | { kind: "found"; index: number; el: Element } | { kind: "none" };

function look(sp: StepPointer, visible: IsVisible): Look {
  const hit = findFirst(document, sp.targets, visible, host);
  if (sp.done) {
    if (hit?.index === 0 && isDone(sp.done, hit.el)) return { kind: "done", el: hit.el };
    if (sp.done === "connected") {
      const gone = connectedControl(document, sp.targets[0]!, visible, host);
      if (gone) return { kind: "done", el: null };
    }
  }
  return hit ? { kind: "found", ...hit } : { kind: "none" };
}

function reportDone(assistant: AssistantId, step: string): void {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;
  chrome.runtime.sendMessage({ type: DONE_MESSAGE, assistant, step }).catch(() => undefined);
}

/**
 * Looks for the step's control for 3 seconds and outlines it once found with confidence.
 * Draws nothing otherwise; the panel's words are enough. Keeps checking quietly afterwards
 * and reports the step done when the target shows it (connected, toggle on, instruction pasted).
 */
export function showPointer(assistant: AssistantId, stepId: string, visible: IsVisible = isShown): Promise<PointResult> {
  hidePointer();
  const a = assistantById(assistant);
  const sp = stepPointer(assistant, stepId);
  if (!a?.origin || !sp || location.origin !== originOf(a.origin)) return Promise.resolve("skipped");
  const mine = run;
  const mac = isMac();
  let shown: Element | null = null;
  let looks = 0;
  const started = Date.now();

  return new Promise<PointResult>((resolve) => {
    let settled = false;
    const settle = (r: PointResult) => {
      if (!settled) resolve(r);
      settled = true;
    };
    const tick = () => {
      if (mine !== run) return settle("skipped");
      const first = Date.now() - started < FIRST_LOOK_MS;
      if (first || document.visibilityState !== "hidden") {
        const now = look(sp, visible);
        if (now.kind === "done") {
          clearTimeout(timer);
          if (sp.done === "contains-cortex" && now.el) draw(now.el, "Now click Save");
          else clearDrawing();
          reportDone(assistant, stepId);
          return settle("done");
        }
        if (now.kind === "found") {
          if (now.el !== shown || !host) draw(now.el, pointerLabel(sp.targets[now.index]!, mac));
          shown = now.el;
          settle("outlined");
        } else if (shown) {
          clearDrawing();
          shown = null;
        }
      }
      if (first) {
        timer = setTimeout(tick, FIRST_EVERY_MS);
        return;
      }
      settle(shown ? "outlined" : "none");
      looks += 1;
      if (looks < LATER_LOOKS) timer = setTimeout(tick, LATER_EVERY_MS);
    };
    tick();
  });
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage && !window.__cortexGuidePointer) {
  window.__cortexGuidePointer = true;
  chrome.runtime.onMessage.addListener((msg: { type?: string; assistant?: AssistantId; step?: string }, sender) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return;
    if (msg?.type === HIDE_MESSAGE) hidePointer();
    if (msg?.type === POINT_MESSAGE && msg.assistant && msg.step) void showPointer(msg.assistant, msg.step);
  });
}
