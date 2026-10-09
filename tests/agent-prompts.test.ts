/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import {
  AGENT_PROMPT_TEMPLATES,
  AGENTS_INTRO_BODY,
  AGENTS_SHEET_RULES,
  AGENTS_STEPS,
  AGENTS_TAB_LABEL,
  getAgentPrompt,
} from "../src/shared/agent-prompts";
import { renderAgentsView } from "../src/content/agents-view";
import { CADENCE_SENTENCE } from "../src/assistant-sync/schedule";

describe("agent prompts", () => {
  it("exposes Connect AI Agents tab label", () => {
    expect(AGENTS_TAB_LABEL).toBe("Connect AI Agents");
  });

  it("teaches live sheet use and names only files Cortex writes", () => {
    const blob = [
      AGENTS_INTRO_BODY,
      ...AGENTS_STEPS,
      ...AGENTS_SHEET_RULES,
      ...AGENT_PROMPT_TEMPLATES.map((t) => t.prompt),
    ].join("\n");
    expect(blob).toMatch(/Cortex Memory/);
    expect(blob).toMatch(/live/i);
    expect(blob).toMatch(/Pages doc/);
    expect(blob).not.toMatch(/Content tab|for 5 minutes/);
    expect(blob).toMatch(/About/);
    // Cortex writes one Drive file. Copy never points at archives or backups it no longer makes.
    expect(blob.toLowerCase()).not.toMatch(/json backup|archive/);
    expect(blob).not.toMatch(/\u2014/);
  });

  it("states the sync cadence from the scheduler, not a hardcoded number", () => {
    expect(AGENTS_INTRO_BODY).toContain(CADENCE_SENTENCE);
    expect(AGENTS_INTRO_BODY).not.toMatch(/30 seconds/);
  });

  it("includes Claude, ChatGPT, Gemini, and Cursor-style templates", () => {
    const ids = AGENT_PROMPT_TEMPLATES.map((t) => t.id);
    expect(ids).toEqual(
      expect.arrayContaining(["claude", "chatgpt", "gemini", "cursor", "generic"])
    );
    expect(getAgentPrompt("claude")?.prompt.length).toBeGreaterThan(80);
    const prompts = AGENT_PROMPT_TEMPLATES.map((t) => t.prompt);
    expect(new Set(prompts).size).toBe(prompts.length);
    expect(getAgentPrompt("claude")?.prompt).toMatch(/You are Claude/);
    expect(getAgentPrompt("chatgpt")?.prompt).toMatch(/You are ChatGPT/);
    expect(getAgentPrompt("gemini")?.prompt).toMatch(/You are Gemini/);
    expect(getAgentPrompt("cursor")?.prompt).toMatch(/Cursor agent/);
  });
});

describe("agents view", () => {
  it("renders steps, rules, and Assist Sync deep link", () => {
    const host = document.createElement("div");
    const open = vi.fn();
    renderAgentsView(host, { openAssistSyncSettings: open });
    expect(host.textContent).toContain("Connect AI agents");
    expect(host.querySelectorAll("[data-agent]").length).toBe(
      AGENT_PROMPT_TEMPLATES.length
    );
    const btn = host.querySelector<HTMLButtonElement>("[data-cortex-open-assist-sync]");
    expect(btn).toBeTruthy();
    btn!.click();
    expect(open).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Copy prompt");
    expect(host.querySelector(".cortex-agents-prompt")).toBeTruthy();
  });
});
