// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { standingInstructionFor, assistantById, type AssistantId } from "../src/config/assistants";
import { GUIDE_KEY, guideKeyFor, newGuideState, type GuideMap, type GuideState } from "../src/guide/state";

type Listener = (...args: unknown[]) => void;

interface Fake {
  session: Record<string, unknown>;
  updated: Listener[];
  calls: { name: string; args: unknown[] }[];
  clipboard: string[];
  granted: boolean;
  tabUrl: string;
  syncOn: boolean;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await tick();
}

function install(assistant: AssistantId, over: Partial<Fake> = {}): Fake {
  const fake: Fake = {
    session: { [GUIDE_KEY]: { [guideKeyFor(7)]: newGuideState(assistant, 7) } },
    updated: [],
    calls: [],
    clipboard: [],
    granted: true,
    tabUrl: "https://claude.ai/customize/connectors",
    syncOn: true,
    ...over,
  };
  const log = (name: string) => (...args: unknown[]) => {
    fake.calls.push({ name, args });
  };
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      id: "cortex",
      lastError: undefined,
      getURL: (p: string) => `chrome-extension://cortex/${p}`,
      sendMessage: async (msg: { action?: string; token?: string }) => {
        fake.calls.push({ name: "runtime.sendMessage", args: [msg] });
        if (msg.action === "status") return { ok: true, state: { syncEnabled: fake.syncOn, lastError: null }, statusLine: "" };
        if (msg.action === "enable") {
          fake.syncOn = true;
          return { ok: true, status: "ready" };
        }
        return { ok: true };
      },
    },
    identity: {
      getAuthToken: (details: { interactive: boolean }, cb: (t?: string) => void) => {
        fake.calls.push({ name: "identity.getAuthToken", args: [details] });
        cb("click-token");
      },
    },
    tabs: {
      query: async () => [{ id: 7 }],
      getCurrent: async () => undefined,
      get: async (id: number) => ({ id, url: fake.tabUrl }),
      update: async (...args: unknown[]) => log("tabs.update")(...args),
      sendMessage: async (...args: unknown[]) => log("tabs.sendMessage")(...args),
      create: async (...args: unknown[]) => log("tabs.create")(...args),
      onUpdated: { addListener: (fn: Listener) => fake.updated.push(fn) },
    },
    permissions: {
      request: async (...args: unknown[]) => {
        log("permissions.request")(...args);
        return fake.granted;
      },
    },
    scripting: { executeScript: async (...args: unknown[]) => log("scripting.executeScript")(...args) },
    storage: {
      session: {
        get: async (key: string) => (key in fake.session ? { [key]: fake.session[key] } : {}),
        set: async (values: Record<string, unknown>) => {
          Object.assign(fake.session, values);
        },
      },
      onChanged: { addListener: () => undefined },
    },
  };
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (t: string) => void fake.clipboard.push(t) },
  });
  return fake;
}

async function boot(): Promise<void> {
  document.body.innerHTML = '<main class="cx-guide" id="cx-guide-root"></main>';
  vi.resetModules();
  await import("../src/guide/guide-panel");
  await settle();
}

const state = (fake: Fake): GuideState => (fake.session[GUIDE_KEY] as GuideMap)[guideKeyFor(7)]!;
const step = (id: string) => document.querySelector<HTMLElement>(`.cx-guide-step[data-step="${id}"]`)!;
const buttonIn = (el: ParentNode, text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent === text);

beforeEach(() => {
  vi.useRealTimers();
  // jsdom has no layout.
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
});

describe("setup side panel", () => {
  it("shows a numbered checklist with a picture placeholder per step", async () => {
    install("claude");
    await boot();
    const steps = [...document.querySelectorAll(".cx-guide-step")].map((li) => (li as HTMLElement).dataset.step);
    expect(steps).toEqual(["connect", "instructions", "test"]);
    expect(document.querySelectorAll(".cx-guide-shot")).toHaveLength(3);
    expect(document.querySelector(".cx-guide-shot figcaption")?.textContent).toMatch(/^What you'll see: /);
    expect(document.querySelector(".cx-guide-title")?.textContent).toBe("Set up Claude");
  });

  it("highlights the step the tab is on, and follows the tab without requiring it", async () => {
    const fake = install("chatgpt", { tabUrl: "https://chatgpt.com/settings/personalization" });
    await boot();
    expect(step("extra").classList.contains("is-here")).toBe(true);
    expect(step("extra").getAttribute("aria-current")).toBe("step");
    fake.updated.forEach((fn) => fn(7, { url: "https://chatgpt.com/settings/personalization?instructions=chatgpt" }, {}));
    await settle();
    expect(step("instructions").classList.contains("is-here")).toBe(true);
    expect(step("extra").classList.contains("is-here")).toBe(false);
    // Other tabs never move the highlight.
    fake.updated.forEach((fn) => fn(8, { url: "https://chatgpt.com/settings/personalization" }, {}));
    await settle();
    expect(step("instructions").classList.contains("is-here")).toBe(true);
    // Ticking works with no highlight at all.
    fake.updated.forEach((fn) => fn(7, { url: "https://chatgpt.com/" }, {}));
    await settle();
    expect(document.querySelector(".is-here")).toBeNull();
    const box = step("connect").querySelector<HTMLInputElement>("input[type=checkbox]")!;
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    await settle();
    expect(state(fake).done).toEqual(["connect"]);
    expect(document.querySelector(".cx-guide-progress")?.textContent).toBe("1 of 4 steps done");
  });

  it("copies the instruction and opens only confirmed links in its own tab", async () => {
    const fake = install("claude");
    await boot();
    buttonIn(step("instructions"), "Copy instruction")!.click();
    await settle();
    expect(fake.clipboard).toEqual([standingInstructionFor(assistantById("claude")!)]);
    // Claude's instructions link is unverified: the path in words, no Open button.
    expect(buttonIn(step("instructions"), "Open")).toBeUndefined();
    expect(step("instructions").textContent).toContain("Find it at: Settings > Account > Instructions for Claude");
    buttonIn(step("connect"), "Open")!.click();
    await settle();
    expect(fake.calls.filter((c) => c.name === "tabs.update").map((c) => c.args)).toEqual([
      [7, { url: "https://claude.ai/customize/connectors", active: true }],
    ]);
    expect(fake.calls.some((c) => c.name === "scripting.executeScript")).toBe(false);
  });

  it("asks Yes or No at the end, and No opens that assistant's troubleshooting", async () => {
    const fake = install("gemini", { tabUrl: "https://gemini.google.com/app" });
    await boot();
    expect(step("test").textContent).toContain("Open a NEW chat and ask: @Google Drive What did I search on Google today?");
    buttonIn(step("test"), "No")!.click();
    await settle();
    const trouble = document.querySelector<HTMLDetailsElement>(".cx-connect-trouble")!;
    expect(trouble.open).toBe(true);
    expect(trouble.querySelector("li")?.textContent).toMatch(/^Gemini says it has no Drive/);
    expect(state(fake).result).toBe("no");
    buttonIn(step("test"), "Yes")!.click();
    await settle();
    expect(document.querySelector(".cx-guide-success")?.textContent).toBe("Gemini is connected to your Cortex memory.");
  });

  it("asks for one assistant's site only when Show me on the page is turned on", async () => {
    const fake = install("claude");
    await boot();
    expect(fake.calls.some((c) => c.name === "permissions.request")).toBe(false);
    const toggle = document.querySelector<HTMLInputElement>(".cx-guide-pointer input[type=checkbox]")!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await settle();
    expect(fake.calls.filter((c) => c.name === "permissions.request").map((c) => c.args)).toEqual([[{ origins: ["https://claude.ai/*"] }]]);
    expect(fake.calls.filter((c) => c.name === "scripting.executeScript").map((c) => c.args)).toEqual([
      [{ target: { tabId: 7 }, files: ["guide-pointer.js"] }],
    ]);
    expect(fake.calls.find((c) => c.name === "tabs.sendMessage")?.args).toEqual([7, { type: "CORTEX_GUIDE_POINT", assistant: "claude", step: "connect" }]);
  });

  it("injects nothing when the permission is refused or the tab left the assistant's site", async () => {
    const refused = install("claude", { granted: false });
    await boot();
    const toggle = document.querySelector<HTMLInputElement>(".cx-guide-pointer input[type=checkbox]")!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await settle();
    expect(toggle.checked).toBe(false);
    expect(refused.calls.some((c) => c.name === "scripting.executeScript")).toBe(false);

    const away = install("claude", { tabUrl: "https://mail.example.com/" });
    await boot();
    const again = document.querySelector<HTMLInputElement>(".cx-guide-pointer input[type=checkbox]")!;
    again.checked = true;
    again.dispatchEvent(new Event("change"));
    await settle();
    expect(away.calls.some((c) => c.name === "scripting.executeScript")).toBe(false);
    expect(document.querySelector(".cx-guide-pointer-note")?.textContent).toBe("Open Claude in this tab and Cortex will point the way.");
  });

  it("offers no pointer for assistants without a site or targets", async () => {
    install("muse", { tabUrl: "chrome://newtab/" });
    await boot();
    expect(document.querySelector(".cx-guide-pointer")).toBeNull();
    install("perplexity", { tabUrl: "https://www.perplexity.ai/" });
    await boot();
    expect(document.querySelector(".cx-guide-pointer")).toBeNull();
  });

  it("puts Turn on Assistant Sync first, with Enable signing in from the click", async () => {
    const fake = install("claude", { syncOn: false });
    await boot();
    const sync = document.querySelector(".cx-guide-sync")!;
    expect(sync.textContent).toMatch(/^First, turn on Assistant Sync\./);
    expect(fake.calls.some((c) => c.name === "identity.getAuthToken")).toBe(false);
    buttonIn(sync, "Enable")!.click();
    await settle();
    const names = fake.calls.map((c) => (c.name === "runtime.sendMessage" ? `send:${(c.args[0] as { action: string }).action}` : c.name));
    expect(names.slice(names.indexOf("identity.getAuthToken"))).toEqual(["identity.getAuthToken", "send:enable", "send:status"]);
    expect(fake.calls.find((c) => c.name === "identity.getAuthToken")?.args).toEqual([{ interactive: true }]);
    expect(document.querySelector(".cx-guide-sync")).toBeNull();
  });

  it("explains how to start again when no guide belongs to this tab", async () => {
    install("claude", { session: {} });
    await boot();
    expect(document.querySelector(".cx-guide-title")?.textContent).toBe("No setup open");
  });
});
