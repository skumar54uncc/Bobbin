import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/** Widths: the setup side panel (Chrome allows about 320 and up), the docked panel, the full panel. */
const WIDTHS = [320, 360, 420, 640, 920];

async function noSideScroll(page: Page | Frame, label: string): Promise<void> {
  const box = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(box.scroll, `${label}: sideways scroll`).toBeLessThanOrEqual(box.client);
}

async function openAll(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => ((d as HTMLDetailsElement).open = true)));
}

const STUB = (title: string) => `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><span>Google Drive</span></body></html>`;

/** SYNTHETIC stand-ins for Claude's pages, hand-written for the test. */
const CLAUDE_CONNECTORS = `<!doctype html><html><head><title>Connectors</title></head><body><h1>Connectors</h1><ul>
<li><h3>GitHub</h3><button>Connect</button></li><li><h3>Google Drive</h3><button id="drive">Connect</button></li></ul></body></html>`;
const CLAUDE_SETTINGS = `<!doctype html><html><head><title>Settings</title></head><body><h1>Settings</h1>
<label for="ins">Instructions for Claude</label><br><textarea id="ins" rows="4" cols="40"></textarea><button>Save</button></body></html>`;

test.describe("guided setup", () => {
  test("Connect view wraps at every panel width, accordions open and closed", async ({ context, extensionId }) => {
    const page = await context.newPage();
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`chrome-extension://${extensionId}/connect-frame.html`);
      await expect(page.locator(".cx-connect-card")).toHaveCount(7);
      await noSideScroll(page, `connect ${width} closed`);
      for (const id of ["claude", "chatgpt", "gemini", "grok", "muse", "perplexity", "other"]) {
        await page.click(`.cx-connect-card[data-assistant="${id}"]`);
        await noSideScroll(page, `connect ${width} ${id}`);
      }
      const before = await page.locator(".cx-connect-trouble").boundingBox();
      await openAll(page);
      await noSideScroll(page, `connect ${width} open`);
      // Accordions push content down: the troubleshooting box grows in place, nothing floats.
      const after = await page.locator(".cx-connect-trouble").boundingBox();
      expect(after!.height).toBeGreaterThan(before!.height);
      expect(after!.y).toBeGreaterThanOrEqual(before!.y);
    }
  });

  test("setup panel wraps at side panel widths", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/connect-frame.html`);
    for (const assistant of ["claude", "chatgpt", "gemini", "muse"]) {
      // A real side panel loads on its tab while that tab is active. Headless tabs are not
      // reliably active, so give every tab the guide.
      await page.evaluate(async (id) => {
        const tabs = await chrome.tabs.query({});
        const map = Object.fromEntries(
          tabs.map((t) => [`tab:${t.id}`, { assistant: id, tabId: t.id, done: [], result: "no" }])
        );
        await chrome.storage.session.set({ cortex_guide: map });
      }, assistant);
      for (const width of [320, 360, 420]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`chrome-extension://${extensionId}/guide-panel.html`);
        await expect(page.locator(".cx-guide-step").first()).toBeVisible();
        await noSideScroll(page, `guide ${assistant} ${width}`);
        await openAll(page);
        await noSideScroll(page, `guide ${assistant} ${width} open`);
      }
    }
  });

  test("Start setup inside a web page opens the assistant and the side panel", async ({ context, extensionId, serviceWorker }) => {
    await context.route("https://claude.ai/**", (route) => route.fulfill({ contentType: "text/html", body: STUB("Claude connectors") }));
    await context.route("https://cortex-e2e.test/**", (route) => route.fulfill({ contentType: "text/html", body: STUB("Some article") }));
    const page = await context.newPage();
    await page.goto("https://cortex-e2e.test/article");
    // Frame it the way the Cortex panel does: from the content script world, with the dynamic URL.
    await serviceWorker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: "https://cortex-e2e.test/*" });
      await chrome.scripting.executeScript({
        target: { tabId: tab!.id! },
        func: () => {
          const frame = document.createElement("iframe");
          frame.src = chrome.runtime.getURL("connect-frame.html");
          frame.style.cssText = "width:420px;height:800px;border:0";
          document.body.append(frame);
        },
      });
    });
    await expect.poll(() => page.frames().some((f) => f.url().includes("connect-frame.html"))).toBe(true);
    const frame = page.frames().find((f) => f.url().includes("connect-frame.html"))!;
    // Enable signs in from this frame: the extension page keeps chrome.identity inside a web page.
    await expect(frame.locator(".cx-connect-status .cx-connect-enable")).toHaveText("Enable");
    expect(await frame.evaluate(() => typeof chrome.identity?.getAuthToken)).toBe("function");
    const start = async (id: string) => {
      await frame.click(`.cx-connect-card[data-assistant="${id}"]`);
      await frame.click(".cx-connect-start");
      // Start setup re-enables its button once sidePanel.open has answered.
      await expect(frame.locator(".cx-connect-start")).toBeEnabled();
      await page.waitForTimeout(1500);
    };
    const panelFor = (match: string) =>
      serviceWorker.evaluate(async (m) => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.reverse().find((t) => (t.url || t.pendingUrl || "").startsWith(m));
        if (!tab) return { options: null, state: null };
        const options = await chrome.sidePanel.getOptions({ tabId: tab.id! });
        const got = await chrome.storage.session.get("cortex_guide");
        return { options, state: (got.cortex_guide as Record<string, { assistant: string }>)[`tab:${tab.id}`] };
      }, match);

    await start("claude");
    const assistantTab = context.pages().find((p) => p.url().startsWith("https://claude.ai/"))!;
    expect(assistantTab.url()).toBe("https://claude.ai/customize/connectors");
    await expect(frame.locator(".cx-connect-start-note")).toHaveText("Cortex opens Claude in a new tab and shows these steps in the side panel beside it.");
    const panel = await panelFor("https://claude.ai/");
    expect(panel.options).toMatchObject({ path: "guide-panel.html", enabled: true });
    expect(panel.state?.assistant).toBe("claude");

    // Other has no link: a new tab page, which Cortex otherwise gives the search panel.
    await page.bringToFront();
    // A second real click into this frame does not reach it in headless Playwright; evaluate runs as a user gesture.
    await frame.click('.cx-connect-card[data-assistant="other"]');
    await frame.evaluate(() => (document.querySelector(".cx-connect-start") as HTMLButtonElement).click());
    await expect(frame.locator(".cx-connect-start")).toBeEnabled();
    await page.waitForTimeout(1500);
    await expect(frame.locator(".cx-connect-start-note")).toHaveText("Cortex opens a new tab and shows these steps in the side panel beside it.");
    const otherPanel = await panelFor("chrome://newtab");
    expect(otherPanel.options).toMatchObject({ path: "guide-panel.html", enabled: true });
    expect(otherPanel.state?.assistant).toBe("other");
    // The stub has a "Google Drive" title but no control: nothing is drawn on the page.
    await page.waitForTimeout(3500);
    expect(await assistantTab.locator("[data-cortex-guide]").count()).toBe(0);
  });

  test("the pointer outlines the control on the assistant tab only, then follows the steps in order", async ({ context, extensionId }) => {
    await context.route("https://claude.ai/**", (route) =>
      route.fulfill({ contentType: "text/html", body: new URL(route.request().url()).pathname === "/new" ? CLAUDE_SETTINGS : CLAUDE_CONNECTORS })
    );
    await context.route("https://cortex-e2e.test/**", (route) => route.fulfill({ contentType: "text/html", body: CLAUDE_CONNECTORS }));
    const other = await context.newPage();
    await other.goto("https://cortex-e2e.test/article");
    const claude = await context.newPage();
    await claude.goto("https://claude.ai/customize/connectors");
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/connect-frame.html`);
    // The panel page runs as a tab here; its guide walks the Claude tab.
    await panel.evaluate(async () => {
      const own = (await chrome.tabs.getCurrent())!;
      const [target] = await chrome.tabs.query({ url: "https://claude.ai/*" });
      const state = { assistant: "claude", tabId: target!.id, done: [], result: null };
      await chrome.storage.session.set({ cortex_guide: { [`tab:${own.id}`]: state } });
    });
    await panel.goto(`chrome-extension://${extensionId}/guide-panel.html`);
    // On by default: no checkbox, no permission prompt.
    await expect(panel.locator("input[type=checkbox]")).toHaveCount(0);
    await expect(claude.locator("[data-cortex-guide]")).toHaveCount(1);
    expect(await other.locator("[data-cortex-guide]").count()).toBe(0);
    // It outlines the Connect button, and clicks still reach it.
    const top = await claude.evaluate(() => {
      const r = document.getElementById("drive")!.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.id;
    });
    expect(top).toBe("drive");

    await panel.click("text=I did this");
    await expect.poll(() => claude.url()).toBe("https://claude.ai/new#settings/account");
    await expect(panel.locator(".cx-guide-progress")).toHaveText("Step 2 of 3");
    await expect(panel.locator(".cx-guide-done")).toContainText("Connect Google Drive, done");
    await expect(claude.locator("[data-cortex-guide]")).toHaveCount(1);
    // The user pastes; the step completes itself and the tab stays so Save is not lost.
    await claude.fill("#ins", 'My browsing history lives in my Google Drive folder "Cortex Memory".');
    await expect(panel.locator(".cx-guide-progress")).toHaveText("Step 3 of 3");
    await expect(panel.locator(".cx-guide-step")).toContainText("Click Save on the page if you have not yet.");
    expect(claude.url()).toBe("https://claude.ai/new#settings/account");
    await expect(panel.locator(".cx-guide-primary")).toHaveText("Open a new chat");
  });
});
