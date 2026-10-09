import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./fixtures";

const SHOTS = join(__dirname, "..", "dev", "v2-phase6");

test("popup footer and About Bobbin match the free-forever copy", async ({ context, extensionId }) => {
  mkdirSync(SHOTS, { recursive: true });

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 380, height: 720 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.locator("#cx-tagline")).toHaveText("Private library of pages you read on this device");
  await expect(popup.locator(".cx-popup-footer")).toContainText(
    "Free forever. No ads. No servers. Your data stays yours."
  );
  const why = popup.locator("#cx-why-free");
  await expect(why).toHaveText("Why it's free");
  await popup.screenshot({ path: join(SHOTS, "popup.png") });

  const [about] = await Promise.all([
    context.waitForEvent("page"),
    why.click(),
  ]);
  await about.waitForLoadState("domcontentloaded");
  expect(about.url()).toContain("options.html#cx-sec-about");
  const section = about.locator("#cx-sec-about");
  await expect(section.locator("#cx-about-h")).toHaveText("About Bobbin");
  await expect(section).toContainText("Bobbin keeps the thread of everything you read.");
  await expect(section).toContainText("Free, and built to stay that way");
  await expect(section).toContainText("about every 5 minutes");
  await expect(section).toContainText("Page text goes into Google Docs in your Bobbin Memory folder");
  await expect(section).not.toContainText("every 2 minutes");
  await expect(section.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
  await expect(section.getByRole("link", { name: "Terms of Use" })).toBeVisible();
  await expect(section.getByRole("link", { name: "Send feedback" })).toBeVisible();
  await expect(section).toContainText("Version");
  await section.scrollIntoViewIfNeeded();
  await about.screenshot({ path: join(SHOTS, "settings-about.png") });

  const onb = await context.newPage();
  await onb.setViewportSize({ width: 720, height: 900 });
  await onb.goto(`chrome-extension://${extensionId}/onboarding.html`);
  await expect(onb.locator(".cx-opt-subtitle")).toHaveText("Read it once. Ask your AI anytime.");
  await onb.screenshot({ path: join(SHOTS, "onboarding.png") });
});
