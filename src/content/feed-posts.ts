/**
 * LinkedIn feed posts the user scrolls past. Runs only on linkedin.com/feed with
 * "Save text of LinkedIn posts I scroll past" on. A post that stays on screen for 2 seconds
 * is read once: author name and post text. Never photos, contact info, or messages.
 */

export const POST_SEEN_MS = 2_000;
/** A post counts as on screen when half of it shows, or it fills half the window. */
const ON_SCREEN = 0.5;
const POST_SELECTOR = ".feed-shared-update-v2, [data-urn^='urn:li:activity:'], [data-id^='urn:li:activity:']";
/** In priority order: the visible name span first, since the parent also holds a screen reader copy. */
const AUTHOR_SELECTORS = [
  ".update-components-actor__title span[aria-hidden='true']",
  ".update-components-actor__name span[aria-hidden='true']",
  ".update-components-actor__title",
  ".update-components-actor__name",
];
const TEXT_SELECTOR = ".update-components-text, .feed-shared-update-v2__description, .feed-shared-inline-show-more-text";

export interface SeenPost {
  author: string;
  text: string;
  urn?: string;
}

export function isLinkedInFeed(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    return /(^|\.)linkedin\.com$/i.test(hostname) && /^\/feed\/?$/.test(pathname);
  } catch {
    return false;
  }
}

const squash = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();

/** The outermost post element, so a reshare inside a post is not read twice. */
function postRoot(el: Element): Element {
  let root = el;
  for (let up = el.parentElement?.closest(POST_SELECTOR); up; up = up.parentElement?.closest(POST_SELECTOR)) root = up;
  return root;
}

/** Author and text of one post element, or null when it has no text (an ad image, a job card). */
export function readPost(el: Element): SeenPost | null {
  const text = squash((el.querySelector(TEXT_SELECTOR) as HTMLElement | null)?.innerText ?? el.querySelector(TEXT_SELECTOR)?.textContent);
  if (!text) return null;
  const name = AUTHOR_SELECTORS.map((selector) => el.querySelector(selector)).find(Boolean);
  const author = squash(name?.textContent);
  const urn = el.getAttribute("data-urn") ?? el.getAttribute("data-id") ?? el.querySelector("[data-urn^='urn:li:activity:']")?.getAttribute("data-urn");
  return { author, text, ...(urn && /^urn:li:activity:\d+$/.test(urn) ? { urn } : {}) };
}

export interface FeedWatcherEnv {
  root: ParentNode;
  visible(): boolean;
  send(post: SeenPost): void;
}

/** Watches post elements; each one is sent at most once per page load. */
export function createFeedWatcher(env: FeedWatcherEnv): { scan(): void; stop(): void } {
  const timers = new Map<Element, number>();
  const watched = new WeakSet<Element>();
  const sent = new Set<string>();
  const fire = (el: Element) => {
    timers.delete(el);
    if (!env.visible()) return;
    const post = readPost(el);
    if (!post) return;
    const key = post.urn ?? `${post.author}\n${post.text.slice(0, 300)}`;
    if (sent.has(key)) return;
    sent.add(key);
    io.unobserve(el);
    env.send(post);
  };
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const tall = entry.rootBounds ? entry.intersectionRect.height >= entry.rootBounds.height * ON_SCREEN : false;
        const onScreen = entry.isIntersecting && (entry.intersectionRatio >= ON_SCREEN || tall);
        const timer = timers.get(entry.target);
        if (onScreen && timer == null) timers.set(entry.target, window.setTimeout(() => fire(entry.target), POST_SEEN_MS));
        if (!onScreen && timer != null) {
          window.clearTimeout(timer);
          timers.delete(entry.target);
        }
      }
    },
    { threshold: [0, 0.25, ON_SCREEN, 0.75, 1] }
  );
  return {
    scan() {
      for (const el of Array.from(env.root.querySelectorAll(POST_SELECTOR))) {
        const root = postRoot(el);
        if (watched.has(root)) continue;
        watched.add(root);
        io.observe(root);
      }
    },
    stop() {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
      io.disconnect();
    },
  };
}
