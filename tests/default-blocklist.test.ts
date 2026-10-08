import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_BLOCKLIST,
  getUserSettingsFresh,
  resetUserSettingsMemoryForTests,
  setUserSettings,
} from "../src/shared/extension-settings";
import { isBlockedDomain } from "../src/lib/privacy";
import { createChromeStorageLocalMock } from "./helpers/chrome-storage-mock";

function install(local: Record<string, unknown> = {}) {
  const mock = createChromeStorageLocalMock(local);
  globalThis.chrome = { storage: mock.storage, runtime: { id: "test", lastError: undefined } } as unknown as typeof chrome;
}

afterEach(() => {
  resetUserSettingsMemoryForTests();
  // @ts-expect-error test cleanup
  delete globalThis.chrome;
});

describe("default block list", () => {
  it("blocks Google account, billing, and photo pages on a new install", async () => {
    install();
    expect([...DEFAULT_BLOCKLIST]).toEqual([
      "myaccount.google.com",
      "accounts.google.com",
      "one.google.com",
      "photos.google.com",
      "payments.google.com",
      "pay.google.com",
    ]);
    const settings = await getUserSettingsFresh();
    expect(settings.blocklist).toEqual([...DEFAULT_BLOCKLIST]);
    expect(isBlockedDomain("one.google.com", settings.blocklist)).toBe(true);
    expect(isBlockedDomain("docs.google.com", settings.blocklist)).toBe(false);
  });

  it("adds the defaults once to a list saved before, and a removed default stays removed", async () => {
    install({ cortex_user_settings: { blocklist: ["bank.example.com", "one.google.com"] } });
    const upgraded = await getUserSettingsFresh();
    expect(upgraded.blocklist).toEqual(["bank.example.com", "one.google.com", ...DEFAULT_BLOCKLIST.filter((d) => d !== "one.google.com")]);

    await setUserSettings({ blocklist: upgraded.blocklist.filter((d) => d !== "photos.google.com") });
    resetUserSettingsMemoryForTests();
    const after = await getUserSettingsFresh();
    expect(after.blocklist).not.toContain("photos.google.com");
    expect(after.blocklist).toContain("pay.google.com");
  });
});
