import { expect, test, articleHtml, LOREM_PARAGRAPHS } from "./fixtures";

function isClipboardPolicyLog(text: string): boolean {
  return /permissions policy|clipboard api has been blocked/i.test(text);
}

/** Host pages can send Permissions-Policy: clipboard-write=(), which blocks Clipboard API in the panel iframe. */
test("Copy in the in-page panel succeeds when the host page blocks clipboard-write", async ({
  context,
  serviceWorker,
}) => {
  const policyLogs: string[] = [];
  context.on("console", (msg) => {
    const text = msg.text();
    if (isClipboardPolicyLog(text)) policyLogs.push(text);
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  await context.route("https://copy-policy.test/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      headers: { "Permissions-Policy": "clipboard-write=()" },
      body: articleHtml("Clipboard policy page", LOREM_PARAGRAPHS),
    })
  );
  await context.route("https://clip-read.test/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: "<!doctype html><title>clip</title><textarea id='t'></textarea>",
    })
  );
  const page = await context.newPage();
  page.on("console", (msg) => {
    const text = msg.text();
    if (isClipboardPolicyLog(text)) policyLogs.push(text);
  });
  await page.goto("https://copy-policy.test/blocked");
  await serviceWorker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: "https://copy-policy.test/*" });
    await chrome.scripting.executeScript({
      target: { tabId: tab!.id! },
      func: () => {
        const frame = document.createElement("iframe");
        frame.src = chrome.runtime.getURL("connect-frame.html");
        frame.style.cssText = "width:420px;height:900px;border:0";
        document.body.append(frame);
      },
    });
  });
  await expect.poll(() => page.frames().some((f) => f.url().includes("connect-frame.html"))).toBe(true);
  const frame = page.frames().find((f) => f.url().includes("connect-frame.html"))!;
  await frame.click('.cx-connect-card[data-assistant="other"]');
  await expect(frame.locator(".cx-connect-instruction")).toBeVisible();
  const text = await frame.locator(".cx-connect-instruction").inputValue();
  expect(text.length).toBeGreaterThan(40);
  await frame.click(".cx-connect-copy");
  await expect(frame.locator(".cx-connect-instruction-block [role=status]")).toHaveText("Copied");
  await expect(frame.locator(".cx-copy-manual")).toHaveCount(0);
  expect(policyLogs, policyLogs.join("\n")).toEqual([]);

  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://clip-read.test" });
  const reader = await context.newPage();
  await reader.goto("https://clip-read.test/");
  await reader.locator("#t").click();
  let clip = "";
  try {
    clip = await reader.evaluate(async () => navigator.clipboard.readText());
  } catch {
    clip = "";
  }
  if (!clip) {
    clip = await frame.evaluate(async () => {
      try {
        return await navigator.clipboard.readText();
      } catch {
        return "";
      }
    });
  }
  expect(clip).toBe(text);
});
