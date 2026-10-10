import { test, expect, articleHtml } from "./fixtures";

/** Ask any assistant works with Assistant Sync off: searches and page text are kept locally. */
test("Ask any assistant finds today's searches and page text with Assistant Sync off", async ({ context, serviceWorker, extensionId }) => {
  // SYNTHETIC pages, hand-written for the test.
  await context.route("https://www.bing.com/**", (r) =>
    r.fulfill({
      contentType: "text/html; charset=utf-8",
      body: articleHtml("tidepool lantern - Search", [
        "Results for tidepool lantern. The tidepool lantern is a small light used by shore walkers at night.",
        "More results about tidepool lanterns, their batteries, and where coastal clubs buy them in bulk.",
        "People also ask how bright a tidepool lantern should be for safe walking along wet rocks.",
      ]),
    })
  );
  await context.route("http://attach-e2e.test/**", (r) =>
    r.fulfill({
      contentType: "text/html; charset=utf-8",
      body: articleHtml("The quillwort survey", [
        "The quillwort survey team counted plants in four shallow lakes during the dry autumn weeks.",
        "Volunteers logged water depth beside each clump and found the plants thrive below half a metre.",
        "A second quillwort count is planned for spring, with the same lakes and two new volunteers.",
      ]),
    })
  );
  // As if onboarding was finished: capture is on, Assistant Sync was never turned on.
  await serviceWorker.evaluate(() => chrome.storage.local.set({ cortex_indexing_consent_v1: true }));
  for (const url of ["https://www.bing.com/search?q=tidepool+lantern", "http://attach-e2e.test/quillwort"]) {
    const p = await context.newPage();
    await p.goto(url);
    await p.waitForTimeout(2500);
    await p.close();
  }

  const count = (dbName: string, stores: string[]) =>
    serviceWorker.evaluate(
      ([name, names]) =>
        new Promise<Record<string, number>>((resolve) => {
          const req = indexedDB.open(name);
          req.onsuccess = () => {
            const db = req.result;
            const have = names.filter((n) => db.objectStoreNames.contains(n));
            const out: Record<string, number> = Object.fromEntries(names.map((n) => [n, 0]));
            if (!have.length) return resolve(out);
            const tx = db.transaction(have, "readonly");
            for (const n of have) tx.objectStore(n).count().onsuccess = (e) => (out[n] = (e.target as IDBRequest<number>).result);
            tx.oncomplete = () => {
              db.close();
              resolve(out);
            };
          };
          req.onerror = () => resolve({});
        }),
      [dbName, stores] as const
    );
  const counts = async () => {
    const local = await count("cortex-local-memory", ["searches", "texts"]);
    const sync = await count("cortex-assistant-sync", ["searches", "content", "visits"]);
    return { localSearches: local.searches, localTexts: local.texts, ...sync };
  };
  await expect.poll(async () => (await counts()).localSearches ?? 0, { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
  await expect.poll(async () => (await counts()).localTexts ?? 0, { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
  // Sync is off: the tables it uploads from stay empty.
  expect(await counts()).toMatchObject({ searches: 0, content: 0, visits: 0 });

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/connect-frame.html`);
  const status = await panel.evaluate(() => chrome.runtime.sendMessage({ type: "CORTEX_ASSISTANT_SYNC", action: "status" }));
  expect(status?.state?.syncEnabled).toBe(false);
  const ask = (req: Record<string, unknown>) =>
    panel.evaluate((r) => chrome.runtime.sendMessage({ type: "CORTEX_PACKET_ITEMS", ...r }), req) as Promise<{ ok: boolean; items: { label: string; url?: string; text?: string }[] }>;
  const dayStart = new Date().setHours(0, 0, 0, 0);
  const searches = await ask({ source: "searches", from: dayStart, to: Date.now(), withText: false });
  expect(searches.items.map((i) => i.label)).toContain('Bing search: "tidepool lantern"');

  await expect
    .poll(async () => (await ask({ source: "pages", from: dayStart, to: Date.now(), withText: true })).items.find((i) => i.url?.includes("attach-e2e.test"))?.text ?? "", {
      timeout: 30_000,
    })
    .toContain("A second quillwort count is planned for spring");
  const without = await ask({ source: "pages", from: dayStart, to: Date.now(), withText: false });
  expect(without.items.every((i) => i.text == null)).toBe(true);
});
