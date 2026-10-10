import type { DoneCheck, PointerTarget } from "./pointer-targets";

const ACTIONABLE =
  "button, a[href], input:not([type=hidden]), textarea, select, [contenteditable=''], [contenteditable=true], [role=button], [role=switch], [role=checkbox], [role=textbox], [role=link], [role=menuitem], [role=menuitemcheckbox], [role=tab], [role=option]";
const BUTTON = "button, a[href], [role=button], [role=link], [role=menuitem]";
const ITEM = "button, a[href], [role=button], [role=link], [role=menuitem], [role=tab], [role=option]";
const TOGGLE = "[role=switch], [role=checkbox], [role=menuitemcheckbox], input[type=checkbox]";
const TEXTBOX = "textarea, [contenteditable=''], [contenteditable=true], [role=textbox], input[type=text], input:not([type])";

const SELECTOR: Record<PointerTarget["kind"], string> = { button: BUTTON, item: ITEM, textbox: TEXTBOX, toggle: TOGGLE };

/** How far up from the name Cortex looks for its control: a row or a small card, not the page. */
const MAX_LEVELS = 4;

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

export type IsVisible = (el: Element) => boolean;

export function isShown(el: Element): boolean {
  if (el.closest("[hidden], [aria-hidden='true']")) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function named(el: Element, names: readonly string[], anchor: string | null): boolean {
  const own = [norm(el.textContent), norm(el.getAttribute("aria-label"))];
  return names.some((n) => {
    const want = norm(n);
    return own.includes(want) || (anchor != null && own.includes(norm(`${n} ${anchor}`)));
  });
}

function fits(el: Element, t: PointerTarget): boolean {
  if (!el.matches(SELECTOR[t.kind])) return false;
  if ((el as HTMLButtonElement).disabled) return false;
  return t.kind !== "button" || !t.controls || named(el, t.controls, t.anchor);
}

/** Elements whose aria-label or own text is exactly the name. */
function anchorsFor(root: Document | Element, name: string, visible: IsVisible, skip: Node | null): Element[] {
  const want = norm(name);
  const found = new Set<Element>();
  for (const el of root.querySelectorAll("[aria-label]")) if (norm(el.getAttribute("aria-label")) === want && visible(el)) found.add(el);
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || (skip && skip.contains(parent))) continue;
    if (norm(node.nodeValue) !== want) continue;
    if (parent.closest("script, style, noscript, template")) continue;
    if (visible(parent)) found.add(parent);
  }
  return [...found];
}

/** The one control of the right kind that belongs to this name, or null. */
function controlFor(anchor: Element, t: PointerTarget, visible: IsVisible): Element | null {
  const own = anchor.closest(ACTIONABLE);
  if (own && fits(own, t)) return own;
  if (t.kind === "item") return null;
  if (t.kind === "textbox") {
    const label = anchor.closest("label");
    const box = label?.htmlFor ? anchor.ownerDocument.getElementById(label.htmlFor) : null;
    if (box && fits(box, t) && visible(box)) return box;
  }
  // Climb to the smallest box around the name that holds any control: its row or card.
  // Look no further, so another service's button is never picked.
  let node = anchor.parentElement;
  for (let level = 0; node && level < MAX_LEVELS; level += 1, node = node.parentElement) {
    const controls = [...node.querySelectorAll(ACTIONABLE)].filter(visible);
    if (!controls.length) continue;
    const near = controls.filter((e) => fits(e, t));
    return near.length === 1 ? near[0]! : null;
  }
  return null;
}

/**
 * Finds the control the user acts on. Returns null unless exactly one control matches:
 * no outline is better than a wrong one, and a title is never a target.
 */
export function findTarget(root: Document | Element, t: PointerTarget, visible: IsVisible = isShown, skip: Node | null = null): Element | null {
  if (t.within === "dialog") {
    const dialogs = [...root.querySelectorAll("[role=dialog], dialog[open]")].filter((d) => visible(d) && (!skip || !skip.contains(d)));
    if (dialogs.length !== 1) return null;
    root = dialogs[0]!;
  }
  const hits = new Set<Element>();
  if (t.anchor == null) {
    for (const el of root.querySelectorAll(SELECTOR[t.kind])) {
      if ((!skip || !skip.contains(el)) && fits(el, t) && visible(el)) hits.add(el);
    }
  } else {
    for (const anchor of anchorsFor(root, t.anchor, visible, skip)) {
      const control = controlFor(anchor, t, visible);
      if (control) hits.add(control);
    }
  }
  return hits.size === 1 ? [...hits][0]! : null;
}

/** The first target in order that is found with confidence. */
export function findFirst(
  root: Document | Element,
  targets: readonly PointerTarget[],
  visible: IsVisible = isShown,
  skip: Node | null = null
): { index: number; el: Element } | null {
  for (const [index, t] of targets.entries()) {
    const el = findTarget(root, t, visible, skip);
    if (el) return { index, el };
  }
  return null;
}

/** Reads only the target element. */
export function isDone(check: DoneCheck, el: Element): boolean {
  if (check === "toggle-on") return el.getAttribute("aria-checked") === "true" || (el as HTMLInputElement).checked === true;
  if (check === "contains-cortex") {
    const value = (el as HTMLTextAreaElement).value ?? el.textContent ?? "";
    return value.includes("Bobbin Memory") || value.includes("Cortex Memory");
  }
  const text = `${norm(el.textContent)} ${norm(el.getAttribute("aria-label"))}`;
  return /\b(connected|disconnect)\b/.test(text) || el.getAttribute("aria-pressed") === "true";
}

/** After connecting, the Connect button usually becomes a Connected or Disconnect control. */
export function connectedControl(root: Document | Element, t: PointerTarget, visible: IsVisible = isShown, skip: Node | null = null): Element | null {
  if (t.kind !== "button" || t.anchor == null) return null;
  return findTarget(root, { ...t, controls: ["Connected", "Disconnect"] }, visible, skip);
}
