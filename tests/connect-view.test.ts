// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CONNECT_LEAD, CONNECT_TITLE, renderConnectView, type ConnectDeps } from "../src/guide/connect-view";
import { COMMON_TROUBLESHOOTING } from "../src/config/assistants";

const settle = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
};

function mount(over: Partial<ConnectDeps> = {}, on = true) {
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const deps: ConnectDeps = {
    status: vi.fn(async () => ({ on, line: on ? "Synced 2 min ago." : "", problem: false })),
    enable: vi.fn(async () => ({ message: "Sync is on.", needsSettings: false })),
    openSettings: vi.fn(),
    start: vi.fn(async () => ({ ok: true })),
    ...over,
  };
  const view = renderConnectView(host, deps);
  return { host, deps, view };
}

const card = (host: HTMLElement, id: string) => host.querySelector<HTMLButtonElement>(`.cx-connect-card[data-assistant="${id}"]`)!;

describe("Connect your AI view", () => {
  it("shows the header, real sync status, and the seven cards with plan notes", async () => {
    const { host } = mount();
    await settle();
    expect(host.querySelector(".cx-connect-title")?.textContent).toBe(CONNECT_TITLE);
    expect(CONNECT_TITLE).toBe("Connect your AI to your Bobbin memory");
    expect(host.querySelector(".cx-connect-lead")?.textContent).toBe(CONNECT_LEAD);
    expect(host.querySelector(".cx-connect-mascot img")?.getAttribute("src")).toContain("felt-wave");
    expect(host.querySelector(".cx-connect-status-title")?.textContent).toBe("Assistant Sync is on");
    expect(host.querySelector(".cx-connect-status-line")?.textContent).toBe("Synced 2 min ago.");
    const names = [...host.querySelectorAll(".cx-connect-card-name")].map((n) => n.textContent);
    expect(names).toEqual(["Claude", "ChatGPT", "Gemini", "Grok", "Muse", "Perplexity", "Other"]);
    expect(host.querySelector(".cx-connect-badge")).toBeNull();
    expect(card(host, "claude").querySelector(".cx-connect-logo")?.getAttribute("width")).toBe("24");
    expect(card(host, "claude").querySelector(".cx-connect-logo")?.getAttribute("src")).toContain("assistant-logos/claude.svg");
    expect(card(host, "chatgpt").querySelector(".cx-connect-card-plan")?.textContent).toMatch(/^Needs a ChatGPT plan/);
    expect(host.querySelector(".cx-connect-guide")?.hasAttribute("hidden")).toBe(true);
  });

  it("opens the chosen assistant's guide and starts setup from the click", async () => {
    const { host, deps } = mount();
    await settle();
    card(host, "grok").click();
    expect(card(host, "grok").getAttribute("aria-checked")).toBe("true");
    const guide = host.querySelector<HTMLElement>(".cx-connect-guide")!;
    expect(guide.hidden).toBe(false);
    expect(guide.querySelector(".cx-connect-h")?.textContent).toBe("Set up Grok");
    expect(guide.querySelector(".cx-connect-step--sync")).toBeNull();
    // Step titles only: the side panel does the copying and the opening.
    expect([...guide.querySelectorAll(".cx-connect-steps li")].map((li) => li.textContent)).toEqual([
      "Connect Google Drive",
      "Add the Bobbin instruction",
      "Test it in a new chat",
    ]);
    expect(guide.querySelector(".cx-connect-copy, .cx-connect-instruction, pre")).toBeNull();
    guide.querySelector<HTMLButtonElement>(".cx-connect-start")!.click();
    await settle();
    expect(deps.start).toHaveBeenCalledWith("grok");
  });

  it("offers Enable in the status card when sync is off, before any assistant is picked", async () => {
    const { host, deps } = mount({}, false);
    await settle();
    const status = host.querySelector<HTMLElement>(".cx-connect-status")!;
    expect(status.querySelector(".cx-connect-status-title")?.textContent).toBe("Assistant Sync is off");
    const enable = status.querySelector<HTMLButtonElement>(".cx-connect-enable")!;
    expect(enable.textContent).toBe("Enable");
    enable.click();
    await settle();
    expect(deps.enable).toHaveBeenCalledTimes(1);
    expect(status.querySelector(".cx-connect-feedback")?.textContent).toBe("Sync is on.");
    // Picking an assistant shows only its steps: Enable is not repeated.
    card(host, "claude").click();
    expect(host.querySelectorAll(".cx-connect-enable")).toHaveLength(1);
  });

  it("sends people to Settings when Bobbin has a question about an earlier folder", async () => {
    const { host, deps } = mount({ enable: vi.fn(async () => ({ message: "Answer it in Settings.", needsSettings: true })) }, false);
    await settle();
    host.querySelector<HTMLButtonElement>(".cx-connect-enable")!.click();
    await settle();
    [...host.querySelectorAll<HTMLButtonElement>(".cx-connect-feedback button")].find((b) => b.textContent === "Open Settings")!.click();
    expect(deps.openSettings).toHaveBeenCalledTimes(1);
  });

  it("hides the Enable button once sync is on", async () => {
    const { host } = mount({}, true);
    await settle();
    expect(host.querySelector<HTMLElement>(".cx-connect-status-action")!.hidden).toBe(true);
  });

  it("in Settings, shows sync status and Enable only in the Assistant Sync section", async () => {
    const off = mount({ enable: null }, false);
    await settle();
    const status = off.host.querySelector<HTMLElement>(".cx-connect-status")!;
    expect(status.hidden).toBe(false);
    expect(status.querySelector(".cx-connect-status-line")?.textContent).toBe("Turn it on in Assistant Sync above so your assistant has something to read.");
    const go = status.querySelector<HTMLButtonElement>(".cx-connect-enable")!;
    expect(go.textContent).toBe("Go to Assistant Sync");
    go.click();
    expect(off.deps.openSettings).toHaveBeenCalledTimes(1);
    const on = mount({ enable: null }, true);
    await settle();
    expect(on.host.querySelector<HTMLElement>(".cx-connect-status")!.hidden).toBe(true);
  });

  it("shows the start failure in words", async () => {
    const { host } = mount({ start: async () => ({ ok: false, error: "Press the Bobbin button." }) });
    await settle();
    card(host, "claude").click();
    host.querySelector<HTMLButtonElement>(".cx-connect-start")!.click();
    await settle();
    expect(host.querySelector(".cx-connect-start-note")?.textContent).toBe("Press the Bobbin button.");
  });

  it("lists every troubleshooting item, the chosen assistant's first", async () => {
    const { host } = mount();
    await settle();
    const items = () => [...host.querySelectorAll(".cx-connect-trouble-list li")].map((li) => li.textContent);
    expect(items()).toEqual([...COMMON_TROUBLESHOOTING]);
    card(host, "muse").click();
    expect(items()[0]).toBe("Muse forgets: send the Remember message again in a new chat.");
    expect(items()).toHaveLength(COMMON_TROUBLESHOOTING.length);
  });

  it("shows Other's full steps and a visible standing instruction with Copy", async () => {
    const { standingInstructionFor, assistantById } = await import("../src/config/assistants");
    const clip: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (s: string) => void clip.push(s) },
    });
    const { host } = mount();
    await settle();
    card(host, "other").click();
    const guide = host.querySelector<HTMLElement>(".cx-connect-guide")!;
    expect([...guide.querySelectorAll(".cx-connect-step-text")].map((p) => p.textContent).join(" ")).toContain(
      "Open your assistant's settings"
    );
    expect(guide.querySelector(".cx-connect-pointer")).toBeNull();
    const box = guide.querySelector<HTMLTextAreaElement>(".cx-connect-instruction")!;
    expect(box.readOnly).toBe(true);
    expect(box.value).toBe(standingInstructionFor(assistantById("other")!));
    guide.querySelector<HTMLButtonElement>(".cx-connect-copy")!.click();
    await settle();
    expect(clip).toEqual([box.value]);
    expect(guide.querySelector(".cx-connect-instruction-block [role=status]")?.textContent).toBe("Copied");
  });

  it("uses accordions that push content down and a grid that wraps", () => {
    const css = readFileSync(join(__dirname, "..", "src", "guide", "guide.css"), "utf8");
    expect(css).not.toMatch(/position:\s*(absolute|fixed)/);
    expect(css).toMatch(/\.cx-connect-grid \{[^}]*grid-template-columns: repeat\(auto-fill, minmax\(min\(100%, 150px\), 1fr\)\)/);
    expect(css).not.toMatch(/overflow-x:\s*(auto|scroll)/);
    const { host } = mount();
    expect(host.querySelectorAll("details.cx-connect-trouble")).toHaveLength(1);
  });
});
