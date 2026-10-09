import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findProductName } from "./helpers/user-facing-name";
import { LEGACY_MEMORY_NAME, PRODUCT_FULL_NAME, PRODUCT_NAME, RENAME_NOTICE } from "../src/shared/product-name";

const root = join(__dirname, "..");

const ALLOW_FILE = new Set([
  "src/shared/product-name.ts",
  "src/assistant-sync/sheet.ts",
  "src/assistant-sync/drive-api.ts",
  "src/assistant-sync/denylist.ts",
  "src/guide/pointer-find.ts",
  "src/options/options.html",
]);

function allowed(hit: { file: string; text: string }): boolean {
  if (hit.text.startsWith("[Cortex]")) return true;
  if (hit.text === "CortexError" || hit.text === "contains-cortex") return true;
  if (hit.text.includes(RENAME_NOTICE) || hit.text === RENAME_NOTICE) return true;
  // Public GitHub Pages and repo URLs still use the Cortex repository name.
  if (/skumar54uncc\.github\.io\/Cortex\b/.test(hit.text)) return true;
  if (/github\.com\/skumar54uncc\/Cortex\b/.test(hit.text)) return true;
  if (ALLOW_FILE.has(hit.file) && hit.text.includes("Cortex")) return true;
  return false;
}

describe("product name", () => {
  it("uses Bobbin in the manifest", () => {
    const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as {
      name: string;
      short_name: string;
      action: { default_title: string };
    };
    expect(manifest.name).toBe(PRODUCT_FULL_NAME);
    expect(manifest.short_name).toBe(PRODUCT_NAME);
    expect(manifest.action.default_title).toContain(PRODUCT_NAME);
    expect(JSON.stringify(manifest)).not.toMatch(/\bCortex\b/);
  });

  it("has no user-facing Cortex except the rename notice and migration code", () => {
    const hits = findProductName(root).filter((h: { file: string; text: string }) => !allowed(h));
    expect(hits, hits.map((h: { file: string; line: number; text: string }) => `${h.file}:${h.line}: ${h.text}`).join("\n")).toEqual([]);
  });

  it("keeps the old Drive title so capture still skips those files", () => {
    expect(LEGACY_MEMORY_NAME).toBe("Cortex Memory");
  });

  it("shows the one-time Settings notice with the exact wording", () => {
    const html = readFileSync(join(root, "src/options/options.html"), "utf8");
    expect(html).toContain(RENAME_NOTICE);
    expect(html).toContain('id="cx-rename-notice"');
  });
});
