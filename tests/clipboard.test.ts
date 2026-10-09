// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COPY_MESSAGE, copyShortcutHint, copyText, showManualCopy } from "../src/guide/clipboard";

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function clipboard(writeText: (t: string) => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
}

describe("copyText", () => {
  it("uses writeText when the page allows it", async () => {
    const written: string[] = [];
    clipboard(async (t) => {
      written.push(t);
    });
    expect(await copyText("hello")).toBe(true);
    expect(written).toEqual(["hello"]);
  });

  it("asks the service worker when writeText is blocked", async () => {
    clipboard(async () => {
      throw new Error("The Clipboard API has been blocked because of a permissions policy");
    });
    const sent: unknown[] = [];
    vi.stubGlobal("chrome", {
      runtime: {
        lastError: undefined,
        sendMessage: (msg: unknown, cb?: (r: { ok: boolean }) => void) => {
          sent.push(msg);
          cb?.({ ok: true });
        },
      },
    });
    expect(await copyText("packet")).toBe(true);
    expect(sent).toEqual([{ type: COPY_MESSAGE, text: "packet" }]);
  });

  it("returns false when both paths fail", async () => {
    clipboard(async () => {
      throw new Error("blocked");
    });
    vi.stubGlobal("chrome", {
      runtime: {
        lastError: { message: "no offscreen" },
        sendMessage: (_msg: unknown, cb?: (r: undefined) => void) => cb?.(undefined),
      },
    });
    expect(await copyText("x")).toBe(false);
  });
});

describe("manual copy fallback", () => {
  it("shows a selected read-only box with the shortcut hint", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const box = showManualCopy(parent, "paste me");
    expect(box.readOnly).toBe(true);
    expect(box.value).toBe("paste me");
    expect(parent.querySelector(".cx-copy-manual-hint")?.textContent).toBe(copyShortcutHint());
    expect(copyShortcutHint()).toMatch(/Press (Cmd|Ctrl)\+C to copy/);
  });
});

describe("copy message gate", () => {
  it("the worker only copies for extension pages, through the offscreen document", () => {
    const sw = readFileSync(join(__dirname, "..", "src", "background", "service-worker.ts"), "utf8");
    const off = readFileSync(join(__dirname, "..", "src", "offscreen", "offscreen.ts"), "utf8");
    const block = sw.slice(sw.indexOf("if (type === COPY_MESSAGE)"), sw.indexOf('type === "CORTEX_OPEN_OPTIONS"'));
    expect(block).toContain("isConnectFrameSender(sender)");
    expect(block).toContain("isGuidePanelSender(sender)");
    expect(block).toContain("isOptionsPageSender(sender)");
    expect(block).toContain("ensureOffscreen()");
    expect(block).toContain("OFFSCREEN_COPY_MESSAGE");
    expect(sw).toContain('"CLIPBOARD" as chrome.offscreen.Reason');
    expect(off).toContain("execCommandCopy(text)");
    expect(off).toContain("isServiceWorkerSender(sender)");
  });
});
