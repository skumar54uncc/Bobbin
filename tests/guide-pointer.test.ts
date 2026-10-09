// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://claude.ai/customize/connectors"}
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findTarget, waitForTarget } from "../src/guide/pointer-find";
import { POINTER_TARGETS, hasPointer, pointerTarget } from "../src/guide/pointer-targets";
import { hidePointer, showPointer } from "../src/guide/guide-pointer";
import type { AssistantId } from "../src/config/assistants";

/** jsdom has no layout, so "visible" here means not hidden. */
const visible = (el: Element) => !el.closest("[hidden], [aria-hidden='true']");

function load(name: string): Document {
  const html = readFileSync(join(__dirname, "fixtures", "guide", `${name}.html`), "utf8");
  expect(html).toMatch(/^<!-- SYNTHETIC:/);
  return new DOMParser().parseFromString(html, "text/html");
}

afterEach(() => {
  hidePointer();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("pointer targets against SYNTHETIC fixtures", () => {
  const cases = Object.entries(POINTER_TARGETS).flatMap(([id, steps]) => Object.keys(steps ?? {}).map((step) => [id, step] as const));

  it("covers every assistant that has targets", () => {
    expect([...new Set(cases.map(([id]) => id))]).toEqual(["claude", "chatgpt", "gemini", "grok"]);
    expect(hasPointer("muse")).toBe(false);
    expect(hasPointer("perplexity")).toBe(false);
    expect(hasPointer("other")).toBe(false);
  });

  it.each(cases)("%s %s finds the marked element", (id, step) => {
    const doc = load(id);
    const expected = doc.querySelector(`[data-expect="${step}"]`);
    expect(expected, `fixture ${id} marks ${step}`).toBeTruthy();
    const found = findTarget(doc, pointerTarget(id as AssistantId, step)!, visible);
    expect(found).toBeTruthy();
    expect(expected!.contains(found!) || found === expected).toBe(true);
  });
});

describe("findTarget", () => {
  const page = (html: string) => new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");

  it("gives no arrow when two places match", () => {
    const doc = page(`<button>Google Drive</button><a href="/x">Google Drive</a>`);
    expect(findTarget(doc, { names: ["Google Drive"], selectors: [] }, visible)).toBeNull();
  });

  it("prefers the one clickable match over a label beside it", () => {
    const doc = page(`<span>Connector search</span><button role="switch"><span>Connector search</span></button>`);
    expect(findTarget(doc, { names: ["Connector search"], selectors: [] }, visible)?.getAttribute("role")).toBe("switch");
  });

  it("tries each name by aria-label then text, in order, and selectors last", () => {
    const doc = page(`<div id="sel"></div><span>Exact</span><button aria-label="Named">x</button><p>Named</p><button aria-label="Broad">y</button>`);
    expect(findTarget(doc, { names: ["Named"], selectors: [] }, visible)?.tagName).toBe("BUTTON");
    // The earlier, more exact name wins even when only a later one is an aria-label.
    expect(findTarget(doc, { names: ["Exact", "Broad"], selectors: ["#sel"] }, visible)?.tagName).toBe("SPAN");
    expect(findTarget(doc, { names: ["Missing"], selectors: ["#sel", "]bad["] }, visible)?.id).toBe("sel");
  });

  it("matches whole text only, ignoring case and spacing, and skips hidden text and scripts", () => {
    const doc = page(`<p>Open Google Drive now</p><div hidden><button>Google Drive</button></div><script>Google Drive</script><b>  google   DRIVE </b>`);
    expect(findTarget(doc, { names: ["Google Drive"], selectors: [] }, visible)?.tagName).toBe("B");
  });

  it("stops looking after 3 seconds", async () => {
    vi.useFakeTimers();
    let looks = 0;
    const done = waitForTarget(() => {
      looks += 1;
      return null;
    });
    await vi.advanceTimersByTimeAsync(3200);
    await expect(done).resolves.toBeNull();
    expect(looks).toBeGreaterThan(10);
    expect(looks).toBeLessThan(20);
  });
});

describe("on-page card", () => {
  it("outlines the target on the assistant's own site", async () => {
    document.body.innerHTML = load("claude").body.innerHTML;
    // jsdom has no layout: give every element a box.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10, x: 0, y: 0, toJSON() {} });
    expect(await showPointer("claude", "instructions")).toBe("outlined");
    expect(document.querySelectorAll("[data-cortex-guide]")).toHaveLength(1);
    hidePointer();
    expect(document.querySelector("[data-cortex-guide]")).toBeNull();
    vi.restoreAllMocks();
  });

  it("falls back to words when the target never shows up", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = "<main>Nothing here</main>";
    const shown = showPointer("claude", "connect");
    await vi.advanceTimersByTimeAsync(3200);
    expect(await shown).toBe("text");
    expect(document.querySelector("[data-cortex-guide]")).toBeTruthy();
  });

  it("shows words only for steps without a target", async () => {
    expect(await showPointer("claude", "test")).toBe("text");
  });

  it("never runs on another assistant's site or for assistants without one", async () => {
    expect(await showPointer("chatgpt", "extra")).toBe("skipped");
    expect(await showPointer("muse", "connect")).toBe("skipped");
    expect(document.querySelector("[data-cortex-guide]")).toBeNull();
  });

  it("lets clicks through: only the card takes the pointer, the outline never does", () => {
    const src = readFileSync(join(__dirname, "..", "src", "guide", "guide-pointer.ts"), "utf8");
    expect(src).toMatch(/\.ring \{[^}]*pointer-events: none/);
    expect(src).toMatch(/\.card \{[^}]*pointer-events: auto/);
    expect(src).not.toMatch(/\.click\(|dispatchEvent|execCommand|\.value\s*=|innerHTML/);
    expect(src).toMatch(/mode: "closed"/);
  });
});
