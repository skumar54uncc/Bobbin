import { expect, test, articleHtml, LOREM_PARAGRAPHS } from "./fixtures";

/** Host pages can send Permissions-Policy: clipboard-write=(), which blocks Clipboard API in the panel iframe. */
test("Copy in the in-page panel succeeds when the host page blocks clipboard-write", async ({
  context,
  serviceWorker,
}) => {
  await context.route("https://copy-policy.test/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      headers: { "Permissions-Policy": "clipboard-write=()" },
      body: articleHtml("Clipboard policy page", LOREM_PARAGRAPHS),
    })
  );
  const page = await context.newPage();
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
});
