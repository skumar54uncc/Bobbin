// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { execCommandCopy } from "../src/guide/exec-copy";

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
});
