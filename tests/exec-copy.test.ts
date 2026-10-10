// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  document.body.innerHTML = "";
});
import { copyInOffscreen, copyInPage, execCommandCopy } from "../src/guide/exec-copy";

describe("execCommandCopy", () => {
  it("copies from a hidden textarea and removes it", () => {
    const fn = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { configurable: true, writable: true, value: fn });
    expect(execCommandCopy("hello from offscreen")).toBe(true);
    expect(fn).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("returns false when execCommand fails", () => {
    Object.defineProperty(document, "execCommand", { configurable: true, writable: true, value: () => false });
    expect(execCommandCopy("nope")).toBe(false);
  });

  it("copies from the offscreen textarea with execCommand, not writeText", async () => {
    const ta = document.createElement("textarea");
    ta.id = "cx-clipboard";
    document.body.append(ta);
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (t: string) => written.push(t) },
    });
    const fn = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { configurable: true, writable: true, value: fn });
    expect(await copyInOffscreen("hello")).toBe(true);
    expect(fn).toHaveBeenCalledWith("copy");
    expect(written).toEqual([]);
  });

  it("copyInPage uses the page textarea", () => {
    const ta = document.createElement("textarea");
    document.body.append(ta);
    Object.defineProperty(document, "execCommand", { configurable: true, writable: true, value: () => true });
    expect(copyInPage("abc")).toBe(true);
    expect(ta.value).toBe("abc");
  });
});
