// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { standingInstructionFor, assistantById, type AssistantId } from "../src/config/assistants";
import { GUIDE_KEY, guideKeyFor, newGuideState, type GuideMap, type GuideState } from "../src/guide/state";

type Listener = (...args: unknown[]) => void;

interface Fake {
  session: Record<string, unknown>;
  updated: Listener[];
  messages: Listener[];
  calls: { name: string; args: unknown[] }[];
  clipboard: string[];
  tabUrl: string;
  syncOn: boolean;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await tick();
}

function install(assistant: AssistantId, over: Partial<Fake> & { done?: string[] } = {}): Fake {
  const { done = [], ...rest } = over;
  const fake: Fake = {
    session: { [GUIDE_KEY]: { [guideKeyFor(7)]: { ...newGuideState(assistant, 7), done } } },
    updated: [],
    messages: [],
    calls: [],
    clipboard: [],
    tabUrl: "https://claude.ai/customize/connectors",
    syncOn: true,
    ...rest,
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
      onMessage: { addListener: (fn: Listener) => fake.messages.push(fn) },
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
const card = () => document.querySelector<HTMLElement>(".cx-guide-step");
const buttonIn = (el: ParentNode, text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent === text);
const primary = () => card()!.querySelector<HTMLButtonElement>(".cx-guide-primary")!;
const navigations = (fake: Fake) => fake.calls.filter((c) => c.name === "tabs.update").map((c) => (c.args[1] as { url: string }).url);
const points = (fake: Fake) =>
  fake.calls
    .filter((c) => c.name === "tabs.sendMessage")
    .map((c) => c.args[1] as { type: string; step?: string })
    .map((m) => (m.type === "CORTEX_GUIDE_POINT" ? `point:${m.step}` : "hide"));

async function pageSaysDone(fake: Fake, step: string, sender: { id?: string; tab?: { id: number } } = { id: "cortex", tab: { id: 7 } }) {
  fake.messages.forEach((fn) => fn({ type: "CORTEX_GUIDE_DONE", assistant: state(fake).assistant, step }, sender, () => undefined));
  await settle();
}

async function tabLoaded(fake: Fake, url: string) {
  fake.tabUrl = url;
  fake.updated.forEach((fn) => fn(7, { url }, {}));
  fake.updated.forEach((fn) => fn(7, { status: "complete" }, {}));
  await settle();
}

beforeEach(() => {
  vi.useRealTimers();
  // jsdom has no layout.
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
});

describe("setup side panel", () => {
  it("shows one step at a time, with progress dots and no pictures or checkboxes", async () => {
    install("claude");
    await boot();
    expect(document.querySelectorAll(".cx-guide-step")).toHaveLength(1);
    expect(card()!.dataset.step).toBe("connect");
    expect(card()!.querySelector(".cx-guide-step-title")?.textContent).toBe("Connect Google Drive");
    expect(document.querySelector(".cx-guide-progress")?.textContent).toBe("Step 1 of 3");
    expect(document.querySelectorAll(".cx-guide-dot")).toHaveLength(3);
    expect(document.querySelector(".cx-guide-plan")?.textContent).toBe("Free plan works");
    expect(primary().textContent).toBe("Open Claude connectors");
    expect(buttonIn(card()!, "I did this")).toBeTruthy();
    expect(document.querySelector(".cx-guide-shot, figure, input[type=checkbox], .cx-guide-pointer, .cx-connect-preview")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Show me on the page|Picture/);
  });

  it("goes strictly in order: being on a later step's page never skips ahead", async () => {
    const fake = install("chatgpt", { tabUrl: "https://chatgpt.com/settings/personalization" });
    await boot();
    expect(card()!.dataset.step).toBe("connect");
    await tabLoaded(fake, "https://chatgpt.com/settings/personalization?instructions=chatgpt");
    expect(card()!.dataset.step).toBe("connect");
    // A done signal for a later step (the toggle was already on) is ignored.
    await pageSaysDone(fake, "extra");
    await pageSaysDone(fake, "instructions");
    expect(state(fake).done).toEqual([]);
    expect(card()!.dataset.step).toBe("connect");
    expect(navigations(fake)).toEqual([]);
  });

  it("ignores done signals from other tabs and other senders", async () => {
    const fake = install("claude");
    await boot();
    await pageSaysDone(fake, "connect", { id: "cortex", tab: { id: 8 } });
    await pageSaysDone(fake, "connect", { id: "someone-else", tab: { id: 7 } });
    await pageSaysDone(fake, "connect", { id: "cortex" });
    expect(state(fake).done).toEqual([]);
  });

  it("after a step is done, opens the next step's page and points at its target", async () => {
    const fake = install("claude");
    await boot();
    expect(points(fake)).toEqual(["point:connect"]);
    await pageSaysDone(fake, "connect");
    expect(state(fake).done).toEqual(["connect"]);
    expect(navigations(fake)).toEqual(["https://claude.ai/new#settings/account"]);
    expect(document.querySelector(".cx-guide-done")?.textContent).toBe("\u2713Connect Google Drive, done");
    expect(document.querySelector(".cx-guide-progress")?.textContent).toBe("Step 2 of 3");
    expect(card()!.dataset.step).toBe("instructions");
    await tabLoaded(fake, "https://claude.ai/new#settings/account");
    expect(points(fake).at(-1)).toBe("point:instructions");
    // On the step's own page, the button only copies.
    expect(primary().textContent).toBe("Copy instruction");
  });

  it("I did this moves on the same way", async () => {
    const fake = install("chatgpt", { tabUrl: "https://chatgpt.com/" });
    await boot();
    buttonIn(card()!, "I did this")!.click();
    await settle();
    expect(state(fake).done).toEqual(["connect"]);
    expect(navigations(fake)).toEqual(["https://chatgpt.com/settings/personalization"]);
    expect(card()!.dataset.step).toBe("extra");
  });

  it("stays on the page after the instruction box fills itself, so an unsaved paste is kept", async () => {
    const fake = install("claude", { done: ["connect"], tabUrl: "https://claude.ai/new#settings/account" });
    await boot();
    const before = points(fake).length;
    await pageSaysDone(fake, "instructions");
    expect(state(fake).done).toEqual(["connect", "instructions"]);
    expect(navigations(fake)).toEqual([]);
    // The next step has no target: the "Now click Save" outline stays.
    expect(points(fake).length).toBe(before);
    expect(card()!.textContent).toContain("Click Save on the page if you have not yet.");
    // Settings over a chat is not a new chat: the test still opens one.
    expect(primary().textContent).toBe("Open a new chat");
  });

  it("Copy and open settings copies the instruction, then opens the page", async () => {
    const fake = install("claude", { done: ["connect"] });
    await boot();
    expect(primary().textContent).toBe("Copy and open settings");
    primary().click();
    await settle();
    expect(fake.clipboard).toEqual([standingInstructionFor(assistantById("claude")!)]);
    expect(navigations(fake)).toEqual(["https://claude.ai/new#settings/account"]);
    expect(state(fake).done).toEqual(["connect"]);
  });

  it("Open a new chat copies the test question; Gemini's starts with @Google Drive", async () => {
    const fake = install("gemini", { done: ["connect", "instructions"], tabUrl: "https://gemini.google.com/saved-info" });
    await boot();
    expect(primary().textContent).toBe("Open a new chat");
    primary().click();
    await settle();
    expect(fake.clipboard).toEqual(["@Google Drive What did I search on Google today?"]);
    expect(navigations(fake)).toEqual(["https://gemini.google.com/"]);
  });

  it("asks Yes or No at the end; No opens troubleshooting and Yes finishes", async () => {
    const fake = install("gemini", { done: ["connect", "instructions"], tabUrl: "https://gemini.google.com/app" });
    await boot();
    buttonIn(card()!, "No")!.click();
    await settle();
    const trouble = document.querySelector<HTMLDetailsElement>(".cx-connect-trouble")!;
    expect(trouble.open).toBe(true);
    expect(trouble.querySelector("li")?.textContent).toMatch(/^Gemini says it has no Drive/);
    expect(state(fake).result).toBe("no");
    buttonIn(card()!, "Yes")!.click();
    await settle();
    expect(document.querySelector(".cx-guide-success")?.textContent).toBe("Gemini is connected to your Cortex memory.");
    expect(document.querySelector(".cx-guide-progress")?.textContent).toBe("All steps done");
    expect(card()).toBeNull();
  });

  it("points by default on the assistant's site, without asking for any permission", async () => {
    const fake = install("claude");
    await boot();
    expect(fake.calls.filter((c) => c.name === "scripting.executeScript").map((c) => c.args)).toEqual([
      [{ target: { tabId: 7 }, files: ["guide-pointer.js"] }],
    ]);
    expect(fake.calls.find((c) => c.name === "tabs.sendMessage")?.args).toEqual([7, { type: "CORTEX_GUIDE_POINT", assistant: "claude", step: "connect" }]);
  });

  it("injects nothing off the assistant's site, for steps without a target, or for assistants without a site", async () => {
    const away = install("claude", { tabUrl: "https://mail.example.com/" });
    await boot();
    expect(away.calls.some((c) => c.name === "scripting.executeScript")).toBe(false);
    const test = install("claude", { done: ["connect", "instructions"], tabUrl: "https://claude.ai/new" });
    await boot();
    expect(test.calls.some((c) => c.name === "scripting.executeScript")).toBe(false);
    const muse = install("muse", { tabUrl: "chrome://newtab/" });
    await boot();
    expect(muse.calls.some((c) => c.name === "scripting.executeScript")).toBe(false);
  });

  it("names unconfirmed places in words and never opens them", async () => {
    const fake = install("grok", { done: ["connect"], tabUrl: "https://grok.com/" });
    await boot();
    expect(card()!.textContent).toContain("Find it at: Settings > Customize (a hint: it may differ)");
    primary().click();
    await settle();
    expect(fake.clipboard).toHaveLength(1);
    expect(navigations(fake)).toEqual([]);
    expect(state(fake).done).toEqual(["connect"]);
  });

  it("a step with nothing to open or copy has a Done button", async () => {
    const fake = install("muse", { tabUrl: "chrome://newtab/" });
    await boot();
    expect(primary().textContent).toBe("Done");
    primary().click();
    await settle();
    expect(state(fake).done).toEqual(["open"]);
  });

  it("puts Turn on Assistant Sync first, with Enable signing in from the click", async () => {
    const fake = install("claude", { syncOn: false });
    await boot();
    const sync = document.querySelector(".cx-guide-sync")!;
    expect(sync.textContent).toMatch(/^First, turn on Assistant Sync\./);
    expect(fake.calls.some((c) => c.name === "identity.getAuthToken")).toBe(false);
    buttonIn(sync, "Enable")!.click();
    await settle();
    const names = fake.calls
      .filter((c) => c.name === "identity.getAuthToken" || c.name === "runtime.sendMessage")
      .map((c) => (c.name === "runtime.sendMessage" ? `send:${(c.args[0] as { action: string }).action}` : c.name));
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
