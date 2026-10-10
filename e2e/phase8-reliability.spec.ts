import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, articleHtml, LOREM_PARAGRAPHS } from "./fixtures";

const PROFILE = readFileSync(join(__dirname, "..", "tests", "fixtures", "linkedin", "profile.html"), "utf8");

async function docUrls(sw: import("@playwright/test").Worker): Promise<string[]> {
  return sw.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const req = indexedDB.open("cortex-db");
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("documents")) {
            db.close();
            resolve([]);
            return;
          }
          const all = db.transaction("documents", "readonly").objectStore("documents").getAll();
          all.onsuccess = () => {
            resolve((all.result as { url?: string }[]).map((d) => d.url ?? ""));
            db.close();
          };
        };
        req.onerror = () => resolve([]);
      })
  );
}

test("consent, LinkedIn, SPA, popup footer, Connect copy, Attach insert without submit", async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await serviceWorker.evaluate(async () => {
    await chrome.storage.local.remove([
      "cortex_indexing_consent_v1",
      "cortex_onboarding_done_v1",
      "cortex_first_install_backfill_done_v1",
    ]);
  });
  await context.route("https://blocked-consent.test/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: articleHtml("Consent blocked article", LOREM_PARAGRAPHS),
    })
  );
  const denied = await context.newPage();
  await denied.goto("https://blocked-consent.test/article");
  await denied.waitForTimeout(2500);
  expect((await docUrls(serviceWorker)).some((u) => u.includes("blocked-consent.test"))).toBe(false);
  await denied.close();

  await serviceWorker.evaluate(() => chrome.storage.local.set({ cortex_indexing_consent_v1: Date.now() }));

  await context.route("https://www.linkedin.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PROFILE })
  );
  await context.route("https://spa-e2e.test/**", (route) => {
    const url = new URL(route.request().url());
    const title = url.pathname.includes("two") ? "Second spa article" : "First spa article";
    return route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: articleHtml(title, LOREM_PARAGRAPHS),
    });
  });

  const linkedin = await context.newPage();
  await linkedin.goto("https://www.linkedin.com/in/mira-okafor-lind-12ab/");
  const spa = await context.newPage();
  await spa.goto("https://spa-e2e.test/one");
  await spa.evaluate(() => {
    history.pushState({}, "", "/two");
    document.title = "Second spa article";
    const h1 = document.querySelector("h1");
    if (h1) h1.textContent = "Second spa article";
  });

  await expect
    .poll(async () => (await docUrls(serviceWorker)).some((u) => u.includes("spa-e2e.test/two")), { timeout: 45_000 })
    .toBe(true);

  await expect
    .poll(async () => {
      return serviceWorker.evaluate(
        () =>
          new Promise<string | null>((resolve) => {
            const req = indexedDB.open("cortex-db");
            req.onsuccess = () => {
              const db = req.result;
              if (!db.objectStoreNames.contains("people")) {
                db.close();
                resolve(null);
                return;
              }
              const all = db.transaction("people", "readonly").objectStore("people").getAll();
              all.onsuccess = () => {
                const row = (all.result as { name?: string }[])[0];
                db.close();
                resolve(row?.name ?? null);
              };
            };
            req.onerror = () => resolve(null);
          })
      );
    }, { timeout: 45_000 })
    .toBe("Mira Okafor-Lind");

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.locator(".cx-popup-footer")).toContainText("Free forever. No ads. No servers. Your data stays yours.");

  const connect = await context.newPage();
  await connect.goto(`chrome-extension://${extensionId}/connect-frame.html`);
  await expect(connect.locator(".cx-connect-card")).toHaveCount(7);
  const claude = connect.locator('.cx-connect-card[data-assistant="claude"]');
  await claude.click();
  await expect(connect.locator(".cx-connect-start")).toBeVisible();
  await context.route("https://claude.ai/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: "<!doctype html><title>Claude</title>" })
  );
  const opened = context.waitForEvent("page");
  await connect.locator(".cx-connect-start").click();
  const claudeTab = await opened;
  expect(claudeTab.url()).toContain("https://claude.ai/customize/connectors/id/google-drive-drivemcp");

  await context.route("https://chat-e2e.test/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html><body>
<form id="chat"><textarea id="box">Hello </textarea><button type="submit">Send</button></form>
<script>window.__submitted=false;document.getElementById("chat").addEventListener("submit",function(e){e.preventDefault();window.__submitted=true});</script>
</body></html>`,
    })
  );
  const chat = await context.newPage();
  await chat.goto("https://chat-e2e.test/room");
  await chat.locator("#box").focus();
  await serviceWorker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: "https://chat-e2e.test/*" });
    await chrome.scripting.executeScript({
      target: { tabId: tab!.id! },
      func: () => {
        const frame = document.createElement("iframe");
        frame.src = chrome.runtime.getURL("connect-frame.html");
        frame.style.cssText = "width:420px;height:640px;border:0";
        document.body.append(frame);
      },
    });
  });
  await expect.poll(() => chat.frames().some((f) => f.url().includes("connect-frame.html"))).toBe(true);
  const frame = chat.frames().find((f) => f.url().includes("connect-frame.html"))!;
  const inserted = await frame.evaluate(async () => {
    return chrome.runtime.sendMessage({ type: "CORTEX_PACKET_INSERT", text: "Context from Bobbin" });
  });
  expect(inserted).toMatchObject({ ok: true });
  await expect(chat.locator("#box")).toHaveValue(/Context from Bobbin/);
  expect(await chat.evaluate(() => (window as unknown as { __submitted?: boolean }).__submitted)).toBe(false);
});
