import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { agentDebugLog } from "../src/lib/agent-debug-log";

describe("pass4 security gates", () => {
  it("agent-debug-log ships without localhost ingest URL", () => {
    const source = readFileSync(
      join(__dirname, "..", "src", "lib", "agent-debug-log.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/127\.0\.0\.1/);
    expect(source).not.toMatch(/https?:\/\/localhost/i);
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("/ingest/");
    expect(() =>
      agentDebugLog({
        hypothesisId: "t",
        location: "test",
        message: "noop",
        data: { secret: "x" },
      })
    ).not.toThrow();
  });

  it("YouTube caption fetch omits credentials", () => {
    const source = readFileSync(
      join(__dirname, "..", "src", "content", "youtube-capture.ts"),
      "utf8"
    );
    expect(source).toContain('credentials: "omit"');
    expect(source).not.toContain('credentials: "include"');
  });

  it("Assist Sync enable requires options sender", () => {
    const source = readFileSync(
      join(__dirname, "..", "src", "background", "service-worker.ts"),
      "utf8"
    );
    const syncGate = source.slice(
      source.indexOf('type === "CORTEX_ASSISTANT_SYNC"'),
      source.indexOf('type === "CORTEX_OPEN_OPTIONS"')
    );
    expect(syncGate).toContain('action === "enable" && !isOptionsPageSender(sender) && !isGuidePanelSender(sender) && !frameEnable');
    // The Connect frame may send Enable and nothing else past the general gate.
    expect(syncGate).toContain('const frameEnable = parsed?.action === "enable" && isConnectFrameSender(sender);');
    expect(syncGate).toContain('action === "pages" && !isOptionsPageSender(sender)');
    // Status alone is open to Cortex pages such as the Connect frame; content scripts are not extension pages.
    expect(syncGate).toContain('parsed?.action === "status" && isExtensionPageSender(sender)');
  });

  it("recognizes the Connect frame by its extension URL, never a web page or content script", async () => {
    vi.stubGlobal("chrome", { runtime: { id: "cortex", getURL: (p: string) => `chrome-extension://cortex/${p}` } });
    const { isConnectFrameSender } = await import("../src/lib/message-security");
    const tab = { id: 3 } as chrome.tabs.Tab;
    expect(isConnectFrameSender({ id: "cortex", tab, url: "chrome-extension://cortex/connect-frame.html?theme=dark" })).toBe(true);
    // A content script in the same tab reports the page's URL.
    expect(isConnectFrameSender({ id: "cortex", tab, url: "https://example.com/connect-frame.html" })).toBe(false);
    expect(isConnectFrameSender({ id: "other", tab, url: "chrome-extension://cortex/connect-frame.html" })).toBe(false);
    expect(isConnectFrameSender({ id: "cortex", url: "chrome-extension://cortex/options.html" })).toBe(false);
    // use_dynamic_url: getURL names the dynamic id, the frame still reports the extension id.
    vi.stubGlobal("chrome", { runtime: { id: "cortex", getURL: (p: string) => `chrome-extension://aaf0d472-dynamic/${p}` } });
    expect(isConnectFrameSender({ id: "cortex", tab, url: "chrome-extension://cortex/connect-frame.html" })).toBe(true);
    expect(isConnectFrameSender({ id: "cortex", tab, url: "chrome-extension://aaf0d472-dynamic/connect-frame.html" })).toBe(true);
    expect(isConnectFrameSender({ id: "cortex", tab, url: "chrome-extension://elsewhere/connect-frame.html" })).toBe(false);
    vi.unstubAllGlobals();
  });

  it("user settings normalize without spreading raw objects", () => {
    const source = readFileSync(
      join(__dirname, "..", "src", "shared", "extension-settings.ts"),
      "utf8"
    );
    const fn = source.slice(
      source.indexOf("function normalizeSettings"),
      source.indexOf("async function loadUserSettingsFromStorage")
    );
    expect(fn).not.toContain("...raw");
    expect(fn).toContain("indexingPaused: bool(");
  });
  it("S-2: content scripts do not import gemini-api-key; settings normalize blanks the key", () => {
    const settings = readFileSync(
      join(__dirname, "..", "src", "shared", "extension-settings.ts"),
      "utf8"
    );
    const normalize = settings.slice(
      settings.indexOf("function normalizeSettings"),
      settings.indexOf("async function loadUserSettingsFromStorage")
    );
    expect(normalize).toContain('geminiApiKey: ""');
    expect(normalize).not.toMatch(/raw\?\.geminiApiKey/);

    const main = readFileSync(join(__dirname, "..", "src", "content", "main.ts"), "utf8");
    const overlay = readFileSync(join(__dirname, "..", "src", "content", "overlay.ts"), "utf8");
    expect(main).not.toMatch(/gemini-api-key/);
    expect(overlay).not.toMatch(/gemini-api-key/);

    const secret = readFileSync(
      join(__dirname, "..", "src", "shared", "gemini-api-key.ts"),
      "utf8"
    );
    expect(secret).toContain("TRUSTED_CONTEXTS");
    expect(secret).toContain("setAccessLevel");
  });
});
