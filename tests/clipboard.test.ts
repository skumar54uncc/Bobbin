// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clipboardWriteAllowed, COPY_MESSAGE, copyShortcutHint, copyText, showManualCopy } from "../src/guide/clipboard";

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  delete (document as Document & { featurePolicy?: unknown }).featurePolicy;
});

function clipboard(writeText: (t: string) => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
}

function stubExec(ok: boolean): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => ok);
  Object.defineProperty(document, "execCommand", { configurable: true, writable: true, value: fn });
  return fn;
}

function stubChromeSend(sent: unknown[], reply: { ok: boolean } | undefined = { ok: true }): void {
  vi.stubGlobal("chrome", {
    runtime: {
      lastError: undefined,
      sendMessage: (msg: unknown, cb?: (r: { ok: boolean } | undefined) => void) => {
        sent.push(msg);
        cb?.(reply);
      },
    },
  });
}

function stubFramed(): void {
  Object.defineProperty(window, "parent", { configurable: true, get: () => ({}) as Window });
  Object.defineProperty(window, "top", { configurable: true, get: () => ({}) as Window });
}

function unstubFramed(): void {
  Object.defineProperty(window, "parent", { configurable: true, get: () => window });
  Object.defineProperty(window, "top", { configurable: true, get: () => window });
}

describe("copyText", () => {
  it("uses writeText when the page allows it", async () => {
    const written: string[] = [];
    clipboard(async (t) => {
      written.push(t);
    });
    const exec = stubExec(true);
    expect(await copyText("hello")).toBe(true);
    expect(written).toEqual(["hello"]);
    expect(exec).not.toHaveBeenCalled();
  });

  it("skips writeText and uses execCommand when the frame is embedded", async () => {
    const written: string[] = [];
    clipboard(async (t) => {
      written.push(t);
    });
    const sent: unknown[] = [];
    stubChromeSend(sent);
    const exec = stubExec(true);
    stubFramed();
    try {
      expect(clipboardWriteAllowed()).toBe(false);
      expect(await copyText("packet")).toBe(true);
    } finally {
      unstubFramed();
    }
    expect(written).toEqual([]);
    expect(exec).toHaveBeenCalledWith("copy");
    expect(sent).toEqual([]);
  });

  it("asks the service worker when framed execCommand fails", async () => {
    const written: string[] = [];
    clipboard(async (t) => {
      written.push(t);
    });
    const sent: unknown[] = [];
    stubChromeSend(sent);
    stubExec(false);
    stubFramed();
    try {
      expect(await copyText("packet")).toBe(true);
    } finally {
      unstubFramed();
    }
    expect(written).toEqual([]);
    expect(sent).toEqual([{ type: COPY_MESSAGE, text: "packet" }]);
  });

  it("skips writeText when featurePolicy disallows clipboard-write", async () => {
    const written: string[] = [];
    clipboard(async (t) => {
      written.push(t);
    });
    const sent: unknown[] = [];
    stubChromeSend(sent);
    const exec = stubExec(true);
    Object.defineProperty(document, "featurePolicy", {
      configurable: true,
      value: { allowsFeature: (name: string) => name !== "clipboard-write" },
    });
    try {
      expect(clipboardWriteAllowed()).toBe(false);
      expect(await copyText("packet")).toBe(true);
    } finally {
      delete (document as Document & { featurePolicy?: unknown }).featurePolicy;
    }
    expect(written).toEqual([]);
    expect(exec).toHaveBeenCalledWith("copy");
    expect(sent).toEqual([]);
  });

  it("asks the service worker when writeText throws on a top-level page", async () => {
    clipboard(async () => {
      throw new Error("The Clipboard API has been blocked because of a permissions policy");
    });
    const sent: unknown[] = [];
    stubChromeSend(sent);
    stubExec(false);
    expect(await copyText("packet")).toBe(true);
    expect(sent).toEqual([{ type: COPY_MESSAGE, text: "packet" }]);
  });

  it("returns false when every path fails", async () => {
    clipboard(async () => {
      throw new Error("blocked");
    });
    stubExec(false);
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
    expect(block).toContain("copyThroughOffscreen(text)");
    expect(sw).toContain('kind: "copy-text"');
    expect(sw).toContain('"CLIPBOARD" as chrome.offscreen.Reason');
    expect(off).toContain("copyInOffscreen(text)");
    expect(off).toContain("isServiceWorkerSender(sender)");
  });
});
