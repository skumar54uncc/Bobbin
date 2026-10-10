import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const PAGES = [
  "src/options/options.html",
  "src/popup/popup.html",
  "src/onboarding/onboarding.html",
  "src/search/search-shell.html",
  "src/offscreen/offscreen.html",
];
const SCRIPTS = ["src/options/assistant-sync-panel.ts", "src/onboarding/onboarding.ts", "src/popup/popup.ts", "src/content/overlay.ts", "src/content/mascot.ts"];
const webpack = readFileSync(join(ROOT, "webpack.config.js"), "utf8");
const dist = join(ROOT, "dist");

/** Every mascot file a page names in src or srcset, relative to the page. */
function htmlRefs(html: string): string[] {
  const refs: string[] = [];
  for (const [, attr, value] of html.matchAll(/\b(src|srcset)="([^"]*mascot[^"]*)"/g)) {
    const urls = attr === "srcset" ? value!.split(",").map((part) => part.trim().split(/\s+/)[0]!) : [value!];
    refs.push(...urls);
  }
  return refs;
}

/** Poses a script swaps in: `felt-${name}` templates and literal pose names. */
function scriptPoses(source: string): string[] {
  const poses = new Set<string>();
  for (const [, name] of source.matchAll(/["'`]felt-([a-z]+)["'`]/g)) poses.add(name!);
  for (const [, name] of source.matchAll(/mascot\/felt-([a-z]+)\.webp/g)) poses.add(name!);
  // A `felt-${state}` template: the allowed states are the KNOWN_STATES set or the parameter's union type.
  if (/felt-\$\{\w+\}/.test(source)) {
    const known = /KNOWN_STATES = new Set\(\[([\s\S]*?)\]\)/.exec(source)?.[1] ?? "";
    const union = /function setMascot\(state: ([^)]*)\)/.exec(source)?.[1] ?? "";
    for (const [, name] of `${known} ${union}`.matchAll(/"([a-z]+)"/g)) poses.add(name!);
  }
  return [...poses];
}

describe("mascot images in the UI pages", () => {
  it("copies every page to the dist root and assets/mascot to dist/mascot", () => {
    for (const page of PAGES) expect(webpack).toContain(`{ from: "${page}", to: "." }`);
    expect(webpack).toContain('{ from: "assets/mascot", to: "mascot"');
  });

  it("names only mascot files that exist in assets and in dist", () => {
    const refs = PAGES.flatMap((page) => htmlRefs(readFileSync(join(ROOT, page), "utf8")).map((ref) => ({ page, ref })));
    expect(refs.length).toBeGreaterThanOrEqual(6);
    for (const { page, ref } of refs) {
      expect(ref, `${page} names ${ref}`).toMatch(/^mascot\/[\w@.-]+\.webp$/);
      const file = ref.slice("mascot/".length);
      expect(existsSync(join(ROOT, "assets/mascot", file)), `assets/mascot/${file} for ${page}`).toBe(true);
      if (existsSync(dist)) expect(existsSync(join(dist, ref)), `dist/${ref} for ${page}`).toBe(true);
    }
  });

  it("swaps in only poses that exist, at both sizes", () => {
    const poses = new Set(SCRIPTS.filter((s) => existsSync(join(ROOT, s))).flatMap((s) => scriptPoses(readFileSync(join(ROOT, s), "utf8"))));
    expect(poses).toContain("connected");
    expect(poses).toContain("lost");
    for (const pose of poses) {
      const sizes = pose === "head" ? [`felt-${pose}.webp`] : [`felt-${pose}.webp`, `felt-${pose}@256.webp`];
      for (const file of sizes) {
        expect(existsSync(join(ROOT, "assets/mascot", file)), `assets/mascot/${file}`).toBe(true);
        if (existsSync(dist)) expect(existsSync(join(dist, "mascot", file)), `dist/mascot/${file}`).toBe(true);
      }
    }
  });
});
