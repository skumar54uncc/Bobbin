/**
 * What "Show me on the page" outlines, per assistant and step. The only place targets live.
 * Names come from the owner's live checks; see docs/guided-setup.md to change them.
 * Names are tried in order, the most exact first; each by aria-label, then by visible text.
 * CSS selectors come last, only when no name matched.
 * A step with no entry shows the card with words only.
 */
import type { AssistantId } from "../config/assistants";

export interface PointerTarget {
  /** Matched whole against aria-label, then visible text. Case and spacing are ignored. */
  names: string[];
  /** Last resort. */
  selectors: string[];
}

const named = (...names: string[]): PointerTarget => ({ names, selectors: [] });

export const POINTER_TARGETS: Readonly<Partial<Record<AssistantId, Readonly<Record<string, PointerTarget>>>>> = {
  claude: {
    connect: named("Google Drive"),
    instructions: named("Instructions for Claude"),
  },
  chatgpt: {
    connect: named("Plugins", "Apps"),
    extra: named("Connector search"),
  },
  gemini: {
    connect: named("Google Workspace", "Connected apps", "Settings and help"),
  },
  grok: {
    connect: named("Google Drive"),
  },
};

export function pointerTarget(assistant: AssistantId, step: string): PointerTarget | null {
  return POINTER_TARGETS[assistant]?.[step] ?? null;
}

export function hasPointer(assistant: AssistantId): boolean {
  return Object.keys(POINTER_TARGETS[assistant] ?? {}).length > 0;
}
