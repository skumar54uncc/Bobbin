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
    enable: vi.fn(),
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
    expect(CONNECT_TITLE).toBe("Connect your AI to your Cortex memory");
    expect(host.querySelector(".cx-connect-lead")?.textContent).toBe(CONNECT_LEAD);
    expect(host.querySelector(".cx-connect-mascot img")?.getAttribute("src")).toContain("felt-wave");
    expect(host.querySelector(".cx-connect-status-title")?.textContent).toBe("Assistant Sync is on");
    expect(host.querySelector(".cx-connect-status-line")?.textContent).toBe("Synced 2 min ago.");
    const names = [...host.querySelectorAll(".cx-connect-card-name")].map((n) => n.textContent);
    expect(names).toEqual(["Claude", "ChatGPT", "Gemini", "Grok", "Muse", "Perplexity", "Other"]);
    expect(card(host, "claude").querySelector(".cx-connect-badge")?.textContent).toBe("Recommended, works on free");
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
      "Add the Cortex instruction",
      "Test it in a new chat",
    ]);
    expect(guide.querySelector(".cx-connect-copy, .cx-connect-preview, pre")).toBeNull();
    guide.querySelector<HTMLButtonElement>(".cx-connect-start")!.click();
    await settle();
    expect(deps.start).toHaveBeenCalledWith("grok");
  });

  it("puts Turn on Assistant Sync first when sync is off, Enable inline where it can run", async () => {
    const { host, deps } = mount({}, false);
    await settle();
    expect(host.querySelector(".cx-connect-status-title")?.textContent).toBe("Assistant Sync is off");
    card(host, "claude").click();
    const first = host.querySelector(".cx-connect-steps li")!;
    expect(first.textContent).toMatch(/^Turn on Assistant Sync\./);
    first.querySelector<HTMLButtonElement>("button")!.click();
    expect(deps.enable).toHaveBeenCalledTimes(1);
  });

  it("sends people to Settings for Enable inside the panel frame", async () => {
    const { host, deps } = mount({ enable: null }, false);
    await settle();
    card(host, "chatgpt").click();
    const button = host.querySelector<HTMLButtonElement>(".cx-connect-enable")!;
    expect(button.textContent).toBe("Turn on in Settings");
    button.click();
    expect(deps.openSettings).toHaveBeenCalledTimes(1);
  });

  it("shows the start failure in words", async () => {
    const { host } = mount({ start: async () => ({ ok: false, error: "Press the Cortex button." }) });
    await settle();
    card(host, "claude").click();
    host.querySelector<HTMLButtonElement>(".cx-connect-start")!.click();
    await settle();
    expect(host.querySelector(".cx-connect-start-note")?.textContent).toBe("Press the Cortex button.");
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

  it("uses accordions that push content down and a grid that wraps", () => {
    const css = readFileSync(join(__dirname, "..", "src", "guide", "guide.css"), "utf8");
    expect(css).not.toMatch(/position:\s*(absolute|fixed)/);
    expect(css).toMatch(/\.cx-connect-grid \{[^}]*grid-template-columns: repeat\(auto-fill, minmax\(min\(100%, 150px\), 1fr\)\)/);
    expect(css).not.toMatch(/overflow-x:\s*(auto|scroll)/);
    const { host } = mount();
    expect(host.querySelectorAll("details.cx-connect-trouble")).toHaveLength(1);
  });
});
