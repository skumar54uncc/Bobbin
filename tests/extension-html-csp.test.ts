import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walkHtml(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkHtml(full));
    else if (name.endsWith(".html")) out.push(full);
  }
  return out;
}

const srcRoot = join(__dirname, "..", "src");
const files = walkHtml(srcRoot);

describe("extension HTML CSP", () => {
  it("scans the shipped extension pages", () => {
    const names = files.map((f) => f.slice(srcRoot.length + 1).replaceAll("\\", "/"));
    expect(names).toEqual(expect.arrayContaining([
      "offscreen/offscreen.html",
      "popup/popup.html",
      "options/options.html",
      "onboarding/onboarding.html",
      "search/search-shell.html",
      "guide/connect-frame.html",
      "guide/guide-panel.html",
      "legal/privacy.html",
      "legal/terms.html",
    ]));
  });

  it("has no inline script, on* handler, or javascript: URL", () => {
    expect(files.length).toBeGreaterThan(5);
    const failures: string[] = [];
    for (const file of files) {
      const rel = file.slice(srcRoot.length + 1).replaceAll("\\", "/");
      const html = readFileSync(file, "utf8");
      for (const tag of html.matchAll(/<script\b([^>]*)>/gi)) {
        if (!/\bsrc\s*=/.test(tag[1] ?? "")) failures.push(`${rel}: inline <script>`);
      }
      if (/\s+on[a-z]+\s*=/i.test(html)) failures.push(`${rel}: on* attribute`);
      if (/javascript:/i.test(html)) failures.push(`${rel}: javascript: URL`);
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
