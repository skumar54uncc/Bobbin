// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderAttachView, type AttachDeps } from "../src/attach/attach-view";
import type { PacketItem, PacketRequest } from "../src/attach/packet";

const settle = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
};

const ITEMS: PacketItem[] = [
  { key: "a", kind: "page", at: Date.UTC(2026, 9, 9, 10), label: "Bread", url: "https://a.com", text: "Knead it." },
  { key: "b", kind: "page", at: Date.UTC(2026, 9, 9, 11), label: "Butter", url: "https://b.com", text: "Churn it." },
];

function mount(over: Partial<AttachDeps> = {}) {
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const deps = {
    request: vi.fn(async (req: PacketRequest) => ITEMS.map((i) => (req.withText ? i : { ...i, text: undefined }))),
    insert: vi.fn(async () => ({ ok: true as const })),
    copy: vi.fn(async () => true),
    now: () => new Date(2026, 9, 9, 15, 0),
    ...over,
  };
  renderAttachView(host, deps);
  return { host, deps };
}

const chip = (host: HTMLElement, label: string) => [...host.querySelectorAll<HTMLButtonElement>(".cx-attach-chip")].find((b) => b.textContent === label)!;
const buttonText = (host: HTMLElement, text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text)!;

describe("Ask any assistant", () => {
  it("runs a template with its time range, excerpts off by default", async () => {
    const { host, deps } = mount();
    expect(host.querySelector(".cx-attach-preview")!.hasAttribute("hidden")).toBe(true);
    chip(host, "What did I read today").click();
    await settle();
    expect(deps.request).toHaveBeenCalledWith({ source: "pages", from: new Date(2026, 9, 9).getTime(), to: new Date(2026, 9, 9, 15).getTime(), withText: false });
    expect(host.querySelector(".cx-attach-header")?.textContent).toMatch(/^Context from my Cortex browsing memory: 2 items, /);
    expect(host.querySelectorAll(".cx-attach-item")).toHaveLength(2);
    expect(host.querySelector(".cx-attach-excerpt")).toBeNull();
    expect(host.querySelector<HTMLInputElement>(".cx-attach-toggle input")!.checked).toBe(false);
  });

  it("searches the typed question", async () => {
    const { host, deps } = mount();
    host.querySelector<HTMLInputElement>(".cx-attach-input")!.value = "bread recipes";
    host.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    expect(deps.request).toHaveBeenCalledWith({ source: "query", query: "bread recipes", withText: false });
  });

  it("removes items, and Include page text looks again and adds excerpts", async () => {
    const { host, deps } = mount();
    chip(host, "What did I read today").click();
    await settle();
    host.querySelector<HTMLButtonElement>('[aria-label="Remove Bread"]')!.click();
    expect(host.querySelectorAll(".cx-attach-item")).toHaveLength(1);
    expect(host.querySelector(".cx-attach-header")?.textContent).toMatch(/: 1 item, /);
    const toggle = host.querySelector<HTMLInputElement>(".cx-attach-toggle input")!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await settle();
    expect(deps.request).toHaveBeenLastCalledWith(expect.objectContaining({ withText: true }));
    // Removed items stay removed.
    expect(host.querySelectorAll(".cx-attach-item")).toHaveLength(1);
    expect(host.querySelector(".cx-attach-excerpt")?.textContent).toBe("Churn it.");
    buttonText(host, "Insert into chat").click();
    await settle();
    const sent = vi.mocked(deps.insert).mock.calls[0]![0] as string;
    expect(sent).toMatch(/^Context from my Cortex browsing memory: 1 item, /);
    expect(sent).toContain("Butter (https://b.com)\n  Page text: Churn it.");
    expect(sent).not.toContain("Bread");
    expect(host.querySelector(".cx-attach-status")?.textContent).toBe("Inserted. Review it in the chat box, then send.");
  });

  it("copies the same packet, and explains insert problems in words", async () => {
    const { host, deps } = mount({ insert: vi.fn(async () => ({ ok: false as const, reason: "nofield" as const })) });
    chip(host, "What did I read today").click();
    await settle();
    buttonText(host, "Copy").click();
    await settle();
    expect(vi.mocked(deps.copy).mock.calls[0]![0]).not.toContain("Page text");
    expect(host.querySelector(".cx-attach-status")?.textContent).toBe("Copied. Paste it into any chat.");
    buttonText(host, "Insert into chat").click();
    await settle();
    expect(host.querySelector(".cx-attach-status")?.textContent).toBe(
      "Cortex could not find a chat box. Click into the message box on the page, then try again, or use Copy."
    );
  });

  it("says when there are no searches for that time", async () => {
    const { host } = mount({ request: vi.fn(async () => []) });
    chip(host, "What did I search for yesterday").click();
    await settle();
    expect(host.querySelector(".cx-attach-status")?.textContent).toBe("No searches saved for that time. Searches are kept while capture is on.");
    expect(host.querySelector(".cx-attach-preview")!.hasAttribute("hidden")).toBe(true);
  });
});
