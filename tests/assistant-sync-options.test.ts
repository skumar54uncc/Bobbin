// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { assistantSyncDb, readSyncEngineState } from "../src/assistant-sync/db";
import { applyAssistantSyncPreferences } from "../src/assistant-sync/preferences";
import { ASSISTANT_SYNC_RETENTION_KEY, ASSISTANT_SYNC_SHEET_DETAIL_KEY } from "../src/assistant-sync/preference-keys";
import { mountAssistantSyncPanel } from "../src/options/assistant-sync-panel";

const html = readFileSync(join(__dirname, "..", "src", "options", "options.html"), "utf8");

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

describe("assistant sync options", () => {
  beforeEach(async () => {
    document.body.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? "";
    await assistantSyncDb.state.clear();
  });

  it("puts consent above Enable and keeps each assistant guide under 150 words", () => {
    const consent = document.getElementById("cx-assistant-consent")?.textContent ?? "";
    expect(consent).toMatch(/page titles, URLs, searches, LinkedIn profiles, and topics/);
    expect(consent).toMatch(/one Google Doc per day with the text of pages you read \(20 seconds on screen or scrolled 30 percent\), up to 4,000 characters each/);
    expect(consent).toMatch(/Text of LinkedIn feed posts syncs only when you turn on Save text of LinkedIn posts I scroll past/);
    expect(consent).toMatch(/folder named Cortex Memory/);
    expect(consent).toMatch(/drive\.file/);
    expect(consent).toMatch(/relevant rows and page text/);
    const enable = document.getElementById("cx-assistant-enable");
    const consentNode = document.getElementById("cx-assistant-consent");
    expect(enable).toBeTruthy();
    expect(consentNode).toBeTruthy();
    const position = consentNode && enable ? consentNode.compareDocumentPosition(enable) : 0;
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(consent).toMatch(/about every 5 minutes while you browse, and at least every 15 minutes/);
    expect(consent).not.toMatch(/30 seconds/);
    expect(document.getElementById("cx-assistant-archives")).toBeNull();
    const warn = document.getElementById("cx-assistant-retention-warn")?.textContent ?? "";
    expect(warn).toMatch(/deleted from the sheet permanently/);
    expect(warn).toMatch(/Export my data/);
    expect(document.getElementById("cx-export-json")?.textContent).toBe("Export my data (JSON)");
    expect(html).not.toMatch(/Download backup/);
    expect(document.getElementById("cx-assistant-legacy")?.hidden).toBe(true);
    expect(document.getElementById("cx-assistant-confirm")?.hidden).toBe(true);
    expect(document.getElementById("cx-assistant-retention")?.getAttribute("min")).toBe("7");
    expect(document.getElementById("cx-assistant-retention")?.getAttribute("max")).toBe("365");
    // Assistant guides moved to Connect your AI, rendered from src/config/assistants.ts.
    expect(document.querySelectorAll("[data-assistant-guide]")).toHaveLength(0);
    expect(document.getElementById("cx-connect-root")).toBeTruthy();
    expect(document.querySelector('a.cx-nav-link[href="#cx-sec-connect"]')?.textContent).toBe("Connect your AI");
    expect(document.getElementById("cx-warnings-show")?.closest("#cx-sec-privacy")).toBeTruthy();
    expect(document.getElementById("cx-opt-delete-all")?.textContent).toMatch(/Delete all indexed data/);
    expect(html).toMatch(/Type <strong>DELETE<\/strong>/);
  });

  it("requests Drive permission from the Enable click and passes that token", async () => {
    const sent: { type?: string; action?: string; token?: string }[] = [];
    const order: string[] = [];
    (globalThis as { chrome?: unknown }).chrome = {
      storage: { local: { get: async () => ({}), set: async () => {} } },
      identity: {
        getAuthToken: (_details: { interactive: boolean }, callback: (token?: string) => void) => {
          order.push(_details.interactive ? "interactive" : "silent");
          callback("click-token");
        },
      },
      runtime: {
        lastError: undefined,
        sendMessage: async (msg: { type?: string; action?: string; token?: string }) => {
          order.push(msg.action ?? "");
          sent.push(msg);
          if (msg.action === "status") return { ok: true, state: await readSyncEngineState() };
          return { ok: true, status: "ready" };
        },
      },
    };
    mountAssistantSyncPanel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.getElementById("cx-assistant-enable")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual(["status", "interactive", "enable", "status"]);
    expect(sent.find((msg) => msg.action === "enable")?.token).toBe("click-token");
    // Sync now stays gated until status reports syncEnabled.
    const nowBtn = document.getElementById("cx-assistant-now") as HTMLButtonElement;
    expect(nowBtn.disabled).toBe(true);
  });

  it("shows Disable when sync is on and turns sync off without a Google token", async () => {
    const { writeSyncEngineState, defaultSyncEngineState } = await import("../src/assistant-sync/db");
    await writeSyncEngineState({ ...defaultSyncEngineState(), syncEnabled: true });
    const sent: { type?: string; action?: string; token?: string }[] = [];
    (globalThis as { chrome?: unknown }).chrome = {
      storage: { local: { get: async () => ({}), set: async () => {} } },
      runtime: {
        lastError: undefined,
        sendMessage: async (msg: { type?: string; action?: string; token?: string }) => {
          sent.push(msg);
          if (msg.action === "status") return { ok: true, state: await readSyncEngineState() };
          if (msg.action === "disable") {
            await writeSyncEngineState({ ...(await readSyncEngineState()), syncEnabled: false });
            return { ok: true, status: "disabled" };
          }
          return { ok: true };
        },
      },
    };
    mountAssistantSyncPanel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const disable = document.getElementById("cx-assistant-disable") as HTMLButtonElement;
    const enable = document.getElementById("cx-assistant-enable") as HTMLButtonElement;
    const now = document.getElementById("cx-assistant-now") as HTMLButtonElement;
    expect(disable.hidden).toBe(false);
    expect(enable.hidden).toBe(true);
    expect(now.disabled).toBe(false);
    disable.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent.some((msg) => msg.action === "disable")).toBe(true);
    expect(sent.find((msg) => msg.action === "disable")?.token).toBeUndefined();
    expect((await readSyncEngineState()).syncEnabled).toBe(false);
  });

  it("shows the status line and counts down when Sync now lands inside the minute", async () => {
    const { writeSyncEngineState, defaultSyncEngineState } = await import("../src/assistant-sync/db");
    await writeSyncEngineState({ ...defaultSyncEngineState(), syncEnabled: true });
    const sent: string[] = [];
    (globalThis as { chrome?: unknown }).chrome = {
      storage: { local: { get: async () => ({}), set: async () => {} } },
      runtime: {
        lastError: undefined,
        sendMessage: async (msg: { action?: string }) => {
          sent.push(msg.action ?? "");
          if (msg.action === "status") {
            return { ok: true, state: await readSyncEngineState(), statusLine: "Synced 2 min ago. Updates about every 5 minutes while you browse, and at least every 15 minutes." };
          }
          return { ok: true, status: "waiting", waitMs: 23_000 };
        },
      },
    };
    mountAssistantSyncPanel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const line = document.getElementById("cx-assistant-line");
    expect(line?.textContent).toMatch(/^Synced 2 min ago\./);
    const now = document.getElementById("cx-assistant-now") as HTMLButtonElement;
    expect(now.disabled).toBe(false);
    now.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toContain("now");
    expect(line?.textContent).toBe("Syncing in 23s");
    expect(now.disabled).toBe(true);
  });

  it("offers Reconnect Google Drive when Google refused the token", async () => {
    const { writeSyncEngineState, defaultSyncEngineState } = await import("../src/assistant-sync/db");
    await writeSyncEngineState({ ...defaultSyncEngineState(), syncEnabled: true, authNeeded: true });
    (globalThis as { chrome?: unknown }).chrome = {
      storage: { local: { get: async () => ({}), set: async () => {} } },
      runtime: {
        lastError: undefined,
        sendMessage: async () => ({ ok: true, state: await readSyncEngineState(), statusLine: "Sync paused: reconnect Google Drive." }),
      },
    };
    mountAssistantSyncPanel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const enable = document.getElementById("cx-assistant-enable") as HTMLButtonElement;
    expect(enable.hidden).toBe(false);
    expect(enable.textContent).toBe("Reconnect Google Drive");
    expect((document.getElementById("cx-assistant-now") as HTMLButtonElement).disabled).toBe(true);
    expect((document.getElementById("cx-assistant-lost") as HTMLImageElement).src).toContain("felt-lost");
    expect(document.getElementById("cx-assistant-line")?.textContent).toBe("Sync paused: reconnect Google Drive.");
  });

  it("saves retention for the next sync", async () => {
    const stored: Record<string, unknown> = {};
    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        local: {
          get: async (keys: string | string[]) => {
            const out: Record<string, unknown> = {};
            for (const key of typeof keys === "string" ? [keys] : keys) if (key in stored) out[key] = stored[key];
            return out;
          },
          set: async (values: Record<string, unknown>) => {
            Object.assign(stored, values);
          },
        },
      },
      runtime: {
        sendMessage: async (msg: { action?: string }) => {
          if (msg.action === "status") return { ok: true, state: await readSyncEngineState() };
          return { ok: true };
        },
      },
    };
    mountAssistantSyncPanel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const retention = document.getElementById("cx-assistant-retention") as HTMLInputElement;
    retention.value = "30";
    retention.dispatchEvent(new Event("change"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stored[ASSISTANT_SYNC_RETENTION_KEY]).toBe(30);
    await applyAssistantSyncPreferences({ retentionDays: stored[ASSISTANT_SYNC_RETENTION_KEY] });
    const state = await readSyncEngineState();
    expect(state.retentionDays).toBe(30);
    expect(state.syncEnabled).toBe(false);

    const compact = document.querySelector<HTMLInputElement>('input[name="cx-assistant-detail"][value="compact"]')!;
    compact.checked = true;
    compact.dispatchEvent(new Event("change"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stored[ASSISTANT_SYNC_SHEET_DETAIL_KEY]).toBe("compact");
    await applyAssistantSyncPreferences({ sheetDetail: stored[ASSISTANT_SYNC_SHEET_DETAIL_KEY] });
    expect((await readSyncEngineState()).sheetDetail).toBe("compact");
  });

  it("asks before restoring a trashed sheet and answers with the token from the Enable click", async () => {
    const sent: { action?: string; token?: string; choice?: string }[] = [];
    let interactive = 0;
    (globalThis as { chrome?: unknown }).chrome = {
      storage: { local: { get: async () => ({}), set: async () => {} } },
      identity: {
        getAuthToken: (_details: { interactive: boolean }, callback: (token?: string) => void) => {
          interactive += 1;
          callback("click-token");
        },
      },
      runtime: {
        lastError: undefined,
        sendMessage: async (msg: { action?: string; token?: string; choice?: string }) => {
          sent.push(msg);
          if (msg.action === "status") return { ok: true, state: await readSyncEngineState() };
          if (!msg.choice) return { ok: false, status: "confirm", confirm: "trashed" };
          return { ok: true, status: "ready" };
        },
      },
    };
    mountAssistantSyncPanel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.getElementById("cx-assistant-enable")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const box = document.getElementById("cx-assistant-confirm")!;
    expect(box.hidden).toBe(false);
    expect(box.textContent).toMatch(/in your Google Drive trash/);
    const go = document.getElementById("cx-assistant-confirm-go")!;
    expect(go.textContent).toBe("Restore from trash");
    go.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent.filter((m) => m.action === "enable").map((m) => [m.token, m.choice])).toEqual([
      ["click-token", undefined],
      ["click-token", "restore"],
    ]);
    expect(interactive).toBe(1);
    expect(box.hidden).toBe(true);
  });

  it("shows the old files prompt and the sheet size from state", async () => {
    const { writeSyncEngineState, defaultSyncEngineState } = await import("../src/assistant-sync/db");
    await writeSyncEngineState({
      ...defaultSyncEngineState(),
      syncEnabled: true,
      sheetBytes: 1.2 * 1024 * 1024,
      legacyCleanup: "ask",
      legacyFiles: [{ id: "b", name: "Cortex Memory Backup.json" }],
    });
    const sent: { action?: string; cleanup?: string }[] = [];
    (globalThis as { chrome?: unknown }).chrome = {
      storage: { local: { get: async () => ({}), set: async () => {} } },
      runtime: {
        lastError: undefined,
        sendMessage: async (msg: { action?: string; cleanup?: string }) => {
          sent.push(msg);
          if (msg.action === "status") return { ok: true, state: await readSyncEngineState() };
          return { ok: true };
        },
      },
    };
    mountAssistantSyncPanel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.getElementById("cx-assistant-size")?.textContent).toBe("1.2 MB of 3 MB");
    expect(document.getElementById("cx-assistant-legacy")?.hidden).toBe(false);
    expect(document.getElementById("cx-assistant-legacy-list")?.textContent).toBe("Cortex Memory Backup.json");
    document.getElementById("cx-assistant-legacy-keep")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent.find((m) => m.action === "cleanup")?.cleanup).toBe("keep");
  });
});
