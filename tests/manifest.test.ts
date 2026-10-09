import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface WarEntry {
  resources: string[];
  matches?: string[];
  use_dynamic_url?: boolean;
}
interface Manifest {
  manifest_version: number;
  name: string;
  short_name: string;
  description: string;
  version: string;
  permissions: string[];
  web_accessible_resources: WarEntry[];
  content_scripts: { js: string[]; matches: string[] }[];
}

const manifest = JSON.parse(
  readFileSync(join(__dirname, "..", "manifest.json"), "utf8")
) as Manifest;

describe("manifest.json", () => {
  it("is MV3", () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it("does not expose model weights or the WASM runtime to web pages", () => {
    const all = manifest.web_accessible_resources.flatMap((e) => e.resources);
    for (const r of all) {
      expect(r).not.toMatch(/^models\//);
      expect(r).not.toMatch(/^wasm\//);
      expect(r).not.toMatch(/\*\*/);
    }
  });

  it("only exposes what the injected overlay loads, with a dynamic URL", () => {
    expect(manifest.web_accessible_resources).toHaveLength(1);
    const [entry] = manifest.web_accessible_resources;
    expect(entry.use_dynamic_url).toBe(true);
    // The overlay links mascot.css and draws mascot/*.webp inside its shadow root on the page.
    // connect-frame.html is the Connect AI Agents tab: an extension frame inside the closed shadow root.
    expect([...entry.resources].sort()).toEqual(["connect-frame.html", "fonts/*.woff2", "icons/icon-48.png", "mascot.css", "mascot/*.webp"]);
    expect(entry.matches).toEqual(["http://*/*", "https://*/*"]);
  });

  it("keeps the always-on content script to content.js only", () => {
    expect(manifest.content_scripts).toHaveLength(1);
    expect(manifest.content_scripts[0].js).toEqual(["content.js"]);
  });
});

describe("store listing fields (Phase 2.9)", () => {
  it("uses the release name and description", () => {
    expect(manifest.name).toBe("Bobbin: Browsing Memory for AI");
    expect(manifest.short_name).toBe("Bobbin");
    expect(manifest.description).toBe(
      "The missing memory for your AI. Bobbin remembers pages you read for Claude, ChatGPT, Gemini, and Grok. Free."
    );
    expect(manifest.description.startsWith("The missing memory for your AI.")).toBe(true);
  });

  it("keeps name within 75 and description within 132 characters", () => {
    expect(manifest.name.length).toBeLessThanOrEqual(75);
    expect(manifest.description.length).toBeLessThanOrEqual(132);
  });

  it("contains no em dash anywhere in the manifest", () => {
    const raw = readFileSync(join(__dirname, "..", "manifest.json"), "utf8");
    expect(raw).not.toContain("—");
  });

  it("disables incognito and pins a public extension key", () => {
    const raw = JSON.parse(readFileSync(join(__dirname, "..", "manifest.json"), "utf8")) as {
      incognito?: string;
      key?: string;
    };
    expect(raw.incognito).toBe("not_allowed");
    expect(raw.key && raw.key.length > 80).toBe(true);
    expect(raw.key).not.toContain("PRIVATE");
  });

  it("limits OAuth to drive.file and does not repeat the Google host", () => {
    const raw = JSON.parse(readFileSync(join(__dirname, "..", "manifest.json"), "utf8")) as {
      permissions: string[];
      host_permissions: string[];
      optional_host_permissions?: string[];
      oauth2?: { client_id: string; scopes: string[] };
    };
    expect(raw.permissions).toContain("identity");
    expect(raw.host_permissions).toEqual(["http://*/*", "https://*/*"]);
    // The setup pointer runs under the existing host access; nothing extra is requested.
    expect(raw.optional_host_permissions).toBeUndefined();
    expect(raw.oauth2?.scopes).toEqual(["https://www.googleapis.com/auth/drive.file"]);
    expect(raw.oauth2?.client_id).toBe(
      "1001602130427-c4skn7nc1rglp56h5egnchv2khlafk5v.apps.googleusercontent.com"
    );
  });
});
