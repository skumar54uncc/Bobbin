// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://claude.ai/customize/connectors"}
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectedControl, findFirst, findTarget, isDone } from "../src/guide/pointer-find";
import { POINTER_TARGETS, pointerLabel, stepPointer, type PointerTarget } from "../src/guide/pointer-targets";
import { FIRST_LOOK_MS, hidePointer, showPointer, shownPointer } from "../src/guide/guide-pointer";
import type { AssistantId } from "../src/config/assistants";

/** jsdom has no layout, so "visible" here means not hidden. */
const visible = (el: Element) => !el.closest("[hidden], [aria-hidden='true']");

const ACTIONABLE =
  "button, a[href], textarea, input, [contenteditable=true], [role=button], [role=switch], [role=checkbox], [role=textbox], [role=link], [role=menuitem], [role=tab], [role=option]";

function load(name: string): Document {
  const html = readFileSync(join(__dirname, "fixtures", "guide", `${name}.html`), "utf8");
  expect(html).toMatch(/^<!-- SYNTHETIC:/);
  return new DOMParser().parseFromString(html, "text/html");
}

const page = (html: string) => new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
const connect: PointerTarget = { anchor: "Google Drive", kind: "button", controls: ["Connect", "+", "Add"], label: "Click Connect" };

const cases = Object.entries(POINTER_TARGETS).flatMap(([id, steps]) => Object.keys(steps ?? {}).map((step) => [id, step] as const));

describe("pointer targets against SYNTHETIC fixtures", () => {
  it("covers the assistants with known pages", () => {
    expect([...new Set(cases.map(([id]) => id))]).toEqual(["claude", "chatgpt", "gemini", "grok", "perplexity"]);
    for (const id of ["muse", "other"] as const) expect(POINTER_TARGETS[id]).toBeUndefined();
  });

  it.each(cases)("%s %s outlines exactly the marked control", (id, step) => {
    const doc = load(id);
    const expected = doc.querySelector(`[data-expect="${step}"]`);
    expect(expected, `fixture ${id} marks ${step}`).toBeTruthy();
    const hit = findFirst(doc, stepPointer(id as AssistantId, step)!.targets, visible);
    expect(hit?.index).toBe(0);
    expect(hit?.el).toBe(expected);
  });

  it.each(cases)("%s %s targets only actionable elements, never a title", (id, step) => {
    const doc = load(id);
    for (const t of stepPointer(id as AssistantId, step)!.targets) {
      const el = findTarget(doc, t, visible);
      if (el) expect(el.matches(ACTIONABLE), `${t.anchor ?? t.controls} gave <${el.tagName}>`).toBe(true);
    }
  });

  it("says exactly what to do on the page", () => {
    const label = (id: AssistantId, step: string, mac = true) => pointerLabel(stepPointer(id, step)!.targets[0]!, mac);
    expect(label("claude", "connect")).toBe("Click Connect");
    expect(label("claude", "instructions")).toBe("Paste here (Cmd+V), then Save");
    expect(label("claude", "instructions", false)).toBe("Paste here (Ctrl+V), then Save");
    expect(label("chatgpt", "extra")).toBe("Turn this on");
    expect(label("gemini", "connect")).toBe("Turn this on");
    expect(label("grok", "connect")).toBe("Click Connect");
    expect(label("gemini", "instructions")).toBe("Paste here (Cmd+V), then Submit");
    expect(label("grok", "instructions")).toBe("Paste here (Cmd+V), then save");
    expect(label("perplexity", "instructions")).toBe("Paste here (Cmd+V), then save");
  });

  it("Gemini: before + Add shows, points at Instructions for Gemini; before the toggle shows, at Connected apps", () => {
    const doc = page(`<main><button>Connected apps</button><button id="ins">Instructions for Gemini</button></main>`);
    expect(findFirst(doc, stepPointer("gemini", "instructions")!.targets, visible)?.el.id).toBe("ins");
    expect(findFirst(doc, stepPointer("gemini", "connect")!.targets, visible)?.el.textContent).toBe("Connected apps");
  });

  it("Grok: the box with no known label is outlined only inside the one open dialog", () => {
    const t = stepPointer("grok", "instructions")!.targets[0]!;
    expect(findTarget(page(`<textarea></textarea>`), t, visible)).toBeNull();
    expect(findTarget(page(`<div role="dialog"><textarea></textarea><textarea></textarea></div>`), t, visible)).toBeNull();
    expect(findTarget(page(`<div role="dialog"><textarea></textarea></div><div role="dialog"><textarea></textarea></div>`), t, visible)).toBeNull();
    expect(findTarget(page(`<textarea></textarea><div role="dialog"><textarea id="box"></textarea></div>`), t, visible)?.id).toBe("box");
  });
});

describe("findTarget", () => {
  it("outlines the Connect button, not the Google Drive title", () => {
    const doc = page(`<li><div><h3>Google Drive</h3><p>Files</p></div><button id="go">Connect</button></li>`);
    expect(findTarget(doc, connect, visible)?.id).toBe("go");
  });

  it("gives nothing for a title with no control of its own", () => {
    expect(findTarget(page(`<h2>Google Drive</h2><p>Docs and files</p>`), connect, visible)).toBeNull();
    expect(findTarget(page(`<h2>Plugins</h2>`), { anchor: "Plugins", kind: "item", label: "x" }, visible)).toBeNull();
  });

  it("never borrows another service's button", () => {
    const doc = page(`<ul><li><h3>GitHub</h3><button>Connect</button></li><li><h3>Google Drive</h3><button>Manage</button></li></ul>`);
    expect(findTarget(doc, connect, visible)).toBeNull();
  });

  it("gives nothing when two places match", () => {
    const doc = page(`<li><span>Google Drive</span><button>Connect</button></li><li><span>Google Drive</span><button>Connect</button></li>`);
    expect(findTarget(doc, connect, visible)).toBeNull();
    const row = page(`<li><span>Google Drive</span><button>Connect</button><button>Add</button></li>`);
    expect(findTarget(row, connect, visible)).toBeNull();
  });

  it("finds a text box by its label, and a switch by the words beside it", () => {
    const doc = page(`<label for="b">Instructions for Claude</label><textarea id="b"></textarea>`);
    expect(findTarget(doc, { anchor: "Instructions for Claude", kind: "textbox", label: "x" }, visible)?.id).toBe("b");
    const sw = page(`<div><span>Connector search</span><button role="switch" id="s"></button></div>`);
    expect(findTarget(sw, { anchor: "Connector search", kind: "toggle", label: "x" }, visible)?.id).toBe("s");
  });

  it("matches whole text only, ignoring case and spacing, and skips hidden text, scripts, and disabled controls", () => {
    const doc = page(
      `<p>Open Google Drive now</p><div hidden><span>Google Drive</span><button>Connect</button></div><script>Google Drive</script>` +
        `<li><b>  google   DRIVE </b><button id="ok">connect</button></li><li><span>Google Drive</span><button disabled>Connect</button></li>`
    );
    expect(findTarget(doc, connect, visible)?.id).toBe("ok");
  });

  it("falls back along the way there, the step's own control first", () => {
    const t = stepPointer("chatgpt", "connect")!.targets;
    expect(findFirst(page(`<button role="tab" id="i">Integrations</button>`), t, visible)).toMatchObject({ index: 2 });
    expect(findFirst(page(`<button role="tab">Integrations</button><button role="tab" id="p">Plugins</button>`), t, visible)).toMatchObject({ index: 1 });
    expect(findFirst(page(`<p>Nothing to click</p>`), t, visible)).toBeNull();
  });
});

describe("done checks read only the target", () => {
  it("connected, toggle on, and the instruction pasted", () => {
    const [btn] = page(`<button>Connected</button>`).body.children;
    expect(isDone("connected", btn!)).toBe(true);
    expect(isDone("connected", page(`<button>Connect</button>`).body.firstElementChild!)).toBe(false);
    expect(isDone("toggle-on", page(`<button role="switch" aria-checked="true"></button>`).body.firstElementChild!)).toBe(true);
    expect(isDone("toggle-on", page(`<button role="switch" aria-checked="false"></button>`).body.firstElementChild!)).toBe(false);
    const box = page(`<textarea></textarea>`).body.firstElementChild as HTMLTextAreaElement;
    expect(isDone("contains-cortex", box)).toBe(false);
    box.value = 'My browsing history lives in my Google Drive folder "Cortex Memory".';
    expect(isDone("contains-cortex", box)).toBe(true);
  });

  it("sees the Connect button turn into Disconnect in the same row", () => {
    const doc = page(`<li><span>GitHub</span><button>Disconnect</button></li><li><span>Google Drive</span><button>Disconnect</button></li>`);
    expect(connectedControl(doc, connect, visible)).toBeTruthy();
    expect(connectedControl(page(`<li><span>GitHub</span><button>Disconnect</button></li>`), connect, visible)).toBeNull();
  });
});

describe("on-page pointer", () => {
  const sent: unknown[] = [];
  beforeEach(() => {
    sent.length = 0;
    vi.stubGlobal("chrome", { runtime: { sendMessage: (m: unknown) => (sent.push(m), Promise.resolve()) } });
  });
  afterEach(() => {
    hidePointer();
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("outlines the control with its label on the assistant's own site", async () => {
    document.body.innerHTML = load("claude").body.innerHTML;
    expect(await showPointer("claude", "connect", visible)).toBe("outlined");
    expect(shownPointer()?.target).toBe(document.querySelector('[data-expect="connect"]'));
    expect(shownPointer()?.label).toBe("Click Connect");
    expect(document.querySelectorAll("[data-cortex-guide]")).toHaveLength(1);
    hidePointer();
    expect(document.querySelector("[data-cortex-guide]")).toBeNull();
  });

  it("shows nothing on the page when the target is not found within 3 seconds", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = "<main><h1>Google Drive</h1></main>";
    const shown = showPointer("claude", "connect", visible);
    await vi.advanceTimersByTimeAsync(FIRST_LOOK_MS + 200);
    expect(await shown).toBe("none");
    expect(document.querySelector("[data-cortex-guide]")).toBeNull();
  });

  it("shows nothing when the match is ambiguous", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<li><span>Google Drive</span><button>Connect</button></li><li><span>Google Drive</span><button>Connect</button></li>`;
    const shown = showPointer("claude", "connect", visible);
    await vi.advanceTimersByTimeAsync(FIRST_LOOK_MS + 200);
    expect(await shown).toBe("none");
    expect(document.querySelector("[data-cortex-guide]")).toBeNull();
  });

  it("outlines the control once it shows up later, as a menu opens", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = "<main></main>";
    const shown = showPointer("claude", "connect", visible);
    await vi.advanceTimersByTimeAsync(FIRST_LOOK_MS + 200);
    expect(await shown).toBe("none");
    document.querySelector("main")!.innerHTML = `<li><span>Google Drive</span><button id="c">Connect</button></li>`;
    await vi.advanceTimersByTimeAsync(1100);
    expect(shownPointer()?.target.id).toBe("c");
  });

  it("reports the step done when the target shows it, and keeps the paste reminder", async () => {
    document.body.innerHTML = load("claude").body.innerHTML;
    (document.getElementById("ins") as HTMLTextAreaElement).value = "Cortex Memory is my history";
    expect(await showPointer("claude", "instructions", visible)).toBe("done");
    expect(sent).toEqual([{ type: "CORTEX_GUIDE_DONE", assistant: "claude", step: "instructions" }]);
    expect(shownPointer()?.label).toBe("Now click Save");
  });

  it("reports Claude's Drive connected once its button says Disconnect", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<li><span>Google Drive</span><button id="c">Connect</button></li>`;
    expect(await showPointer("claude", "connect", visible)).toBe("outlined");
    document.getElementById("c")!.textContent = "Disconnect";
    await vi.advanceTimersByTimeAsync(400);
    expect(sent).toEqual([{ type: "CORTEX_GUIDE_DONE", assistant: "claude", step: "connect" }]);
    expect(shownPointer()).toBeNull();
  });

  it("does nothing for steps without a target, on another assistant's site, or for assistants without one", async () => {
    expect(await showPointer("claude", "test", visible)).toBe("skipped");
    expect(await showPointer("chatgpt", "extra", visible)).toBe("skipped");
    expect(await showPointer("muse", "connect", visible)).toBe("skipped");
    expect(document.querySelector("[data-cortex-guide]")).toBeNull();
    expect(sent).toEqual([]);
  });

  it("lets clicks through, has no card, and never clicks or types", () => {
    const src = readFileSync(join(__dirname, "..", "src", "guide", "guide-pointer.ts"), "utf8");
    const find = readFileSync(join(__dirname, "..", "src", "guide", "pointer-find.ts"), "utf8");
    expect(src).toMatch(/\.ring \{[^}]*pointer-events: none/);
    expect(src).toMatch(/\.tag \{[^}]*pointer-events: none/);
    expect(src).not.toMatch(/pointer-events: auto|\.card|Cortex setup/);
    for (const code of [src, find]) {
      expect(code).not.toMatch(/\.click\(|dispatchEvent|execCommand|\.focus\(|innerHTML|\.(value|checked)\s*=(?!=)/);
    }
    expect(src).toMatch(/mode: "closed"/);
  });
});
