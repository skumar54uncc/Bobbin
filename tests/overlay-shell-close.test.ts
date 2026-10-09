import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("panel close button", () => {
  it("is left out in Chrome's side panel, which has its own", () => {
    const src = readFileSync(join(__dirname, "..", "src", "content", "overlay.ts"), "utf8");
    expect(src).toMatch(/overlayShellMode\s*\?\s*""\s*:\s*`<button type="button" class="cortex-icon-btn cortex-x" data-act="close"/);
    expect(src.match(/class="cortex-icon-btn cortex-x"/g)).toHaveLength(1);
  });
});
