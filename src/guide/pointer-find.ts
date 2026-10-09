import type { PointerTarget } from "./pointer-targets";

const CLICKABLE =
  "button, a[href], label, summary, input, select, [role=button], [role=switch], [role=checkbox], [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=link], [role=option]";

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export type IsVisible = (el: Element) => boolean;

export function isShown(el: Element): boolean {
  if (el.closest("[hidden], [aria-hidden='true']")) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function leaves(list: Element[]): Element[] {
  const unique = [...new Set(list)];
  return unique.filter((e) => !unique.some((o) => o !== e && e.contains(o)));
}

/**
 * One element, or null when the matches point at more than one place: a wrong arrow is worse than none.
 * A label beside its switch is one place: when exactly one match can be clicked, that one wins.
 */
function single(found: Element[]): Element | null {
  const clickable = leaves(found.map((e) => e.closest(CLICKABLE)).filter((e): e is Element => e != null));
  if (clickable.length) return clickable.length === 1 ? clickable[0]! : null;
  const plain = leaves(found);
  return plain.length === 1 ? plain[0]! : null;
}

function byLabel(root: ParentNode, name: string, visible: IsVisible): Element[] {
  const want = norm(name);
  return [...root.querySelectorAll("[aria-label]")].filter((e) => norm(e.getAttribute("aria-label") ?? "") === want && visible(e));
}

function byText(root: Node, name: string, visible: IsVisible, skip: Node | null): Element[] {
  const want = norm(name);
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const found: Element[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || (skip && skip.contains(parent))) continue;
    if (norm(node.nodeValue ?? "") !== want) continue;
    if (parent.closest("script, style, noscript, template")) continue;
    if (visible(parent)) found.push(parent);
  }
  return found;
}

/** Finds the target by each name in turn (aria-label, then visible text), then by CSS selector. */
export function findTarget(root: Document | Element, target: PointerTarget, visible: IsVisible = isShown, skip: Node | null = null): Element | null {
  for (const name of target.names) {
    const one = single(byLabel(root, name, visible)) ?? single(byText(root, name, visible, skip));
    if (one) return one;
  }
  for (const selector of target.selectors) {
    let found: Element[] = [];
    try {
      found = [...root.querySelectorAll(selector)].filter(visible);
    } catch {
      continue;
    }
    const one = single(found);
    if (one) return one;
  }
  return null;
}

/** Looks again until the target shows up or time runs out. */
export function waitForTarget(
  find: () => Element | null,
  timeoutMs = 3000,
  everyMs = 200,
  now: () => number = Date.now
): Promise<Element | null> {
  const until = now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      const hit = find();
      if (hit) return resolve(hit);
      if (now() >= until) return resolve(null);
      setTimeout(tick, everyMs);
    };
    tick();
  });
}
