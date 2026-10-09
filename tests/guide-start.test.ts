import { afterEach, describe, expect, it } from "vitest";
import { PANEL_FAILED, startGuide } from "../src/guide/start";
import { GUIDE_KEY, withGuide, newGuideState, type GuideMap } from "../src/guide/state";

type Call = [string, unknown];

function fakeChrome(opts: { openFails?: boolean } = {}) {
  const calls: Call[] = [];
  const session: Record<string, unknown> = {};
  (globalThis as { chrome?: unknown }).chrome = {
    tabs: {
      create: async (props: unknown) => {
        calls.push(["tabs.create", props]);
        return { id: 7, windowId: 1 };
      },
    },
    runtime: {
      sendMessage: async (msg: unknown) => {
        calls.push(["runtime.sendMessage", msg]);
        return { ok: true };
      },
    },
    sidePanel: {
      open: async (props: unknown) => {
        calls.push(["sidePanel.open", props]);
        if (opts.openFails) throw new Error("`sidePanel.open()` may only be called in response to a user gesture.");
      },
    },
    storage: {
      session: {
        get: async (key: string) => (key in session ? { [key]: session[key] } : {}),
        set: async (values: Record<string, unknown>) => {
          Object.assign(session, values);
        },
      },
    },
  };
  return { calls, session };
}

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
});

describe("Start setup", () => {
  it("opens the assistant's first page, has the worker set that tab's panel, then opens it", async () => {
    const { calls, session } = fakeChrome();
    expect(await startGuide("claude")).toEqual({ ok: true, tabId: 7 });
    expect(calls).toEqual([
      ["tabs.create", { url: "https://claude.ai/customize/connectors", active: true }],
      ["runtime.sendMessage", { type: "CORTEX_GUIDE_PANEL", tabId: 7 }],
      ["sidePanel.open", { tabId: 7 }],
    ]);
    expect((session[GUIDE_KEY] as GuideMap)["tab:7"]).toEqual(newGuideState("claude", 7));
  });

  it("opens a plain new tab for assistants without a confirmed link", async () => {
    const { calls } = fakeChrome();
    await startGuide("muse");
    expect(calls[0]).toEqual(["tabs.create", { active: true }]);
  });

  it("explains how to see the steps when Chrome refuses the side panel", async () => {
    const { session } = fakeChrome({ openFails: true });
    expect(await startGuide("gemini")).toEqual({ ok: false, error: PANEL_FAILED });
    expect((session[GUIDE_KEY] as GuideMap)["tab:7"]?.assistant).toBe("gemini");
  });

  it("keeps one guide per tab, newest few only", () => {
    let map: GuideMap | undefined;
    for (let tab = 1; tab <= 7; tab += 1) map = withGuide(map, newGuideState("claude", tab));
    expect(Object.keys(map!)).toEqual(["tab:3", "tab:4", "tab:5", "tab:6", "tab:7"]);
    map = withGuide(map, { ...newGuideState("grok", 4), done: ["connect"] });
    expect(Object.keys(map)).toEqual(["tab:3", "tab:5", "tab:6", "tab:7", "tab:4"]);
    expect(map["tab:4"]?.done).toEqual(["connect"]);
    map = withGuide(map, newGuideState("claude", 10));
    expect(Object.keys(map)).toEqual(["tab:5", "tab:6", "tab:7", "tab:4", "tab:10"]);
  });
});
