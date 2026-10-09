/**
 * What the on-page pointer outlines for each step, and how a step completes itself.
 * The only place targets live; docs/guided-setup.md says how to change them.
 *
 * A target is always a control the user acts on (a button, a toggle, a text box, or a
 * clickable list item), never a title. Names come from the owner's live checks.
 */
import type { AssistantId } from "../config/assistants";

export type ControlKind = "button" | "item" | "textbox" | "toggle";

export interface PointerTarget {
  /** Text or aria-label near the control, matched whole (case and spacing ignored). Null: the control carries a name from `controls`. */
  anchor: string | null;
  kind: ControlKind;
  /** For buttons: the control's own text or aria-label. Any name, or "<name> <anchor>", matches. */
  controls?: string[];
  /** What the label on the page says. "{paste}" becomes Cmd+V or Ctrl+V. */
  label: string;
}

/** Read from the target element only. */
export type DoneCheck = "connected" | "contains-cortex" | "toggle-on";

export interface StepPointer {
  /** Tried in order, the step's own control first, then the way there. */
  targets: PointerTarget[];
  done: DoneCheck | null;
}

const CONNECT = ["Connect", "+", "Add"];

export const POINTER_TARGETS: Readonly<Partial<Record<AssistantId, Readonly<Record<string, StepPointer>>>>> = {
  claude: {
    connect: {
      targets: [{ anchor: "Google Drive", kind: "button", controls: CONNECT, label: "Click Connect" }],
      done: "connected",
    },
    instructions: {
      targets: [{ anchor: "Instructions for Claude", kind: "textbox", label: "Paste here ({paste}), then Save" }],
      done: "contains-cortex",
    },
  },
  chatgpt: {
    connect: {
      targets: [
        { anchor: "Google Drive", kind: "item", label: "Click Google Drive" },
        { anchor: "Plugins", kind: "item", label: "Click Plugins" },
        { anchor: "Integrations", kind: "item", label: "Click Integrations" },
      ],
      done: null,
    },
    extra: {
      targets: [{ anchor: "Connector search", kind: "toggle", label: "Turn this on" }],
      done: "toggle-on",
    },
  },
  gemini: {
    connect: {
      targets: [
        { anchor: "Google Workspace", kind: "toggle", label: "Turn this on" },
        { anchor: "Connected apps", kind: "item", label: "Click Connected apps" },
        { anchor: null, kind: "button", controls: ["Settings and help"], label: "Click Settings and help" },
      ],
      done: "toggle-on",
    },
    instructions: {
      targets: [{ anchor: null, kind: "button", controls: ["+ Add", "Add"], label: "Click + Add, paste ({paste}), then Save" }],
      done: null,
    },
  },
  grok: {
    connect: {
      targets: [{ anchor: "Google Drive", kind: "button", controls: CONNECT, label: "Click Connect" }],
      done: "connected",
    },
  },
};

export function stepPointer(assistant: AssistantId, step: string): StepPointer | null {
  return POINTER_TARGETS[assistant]?.[step] ?? null;
}

/** The label text, with the paste shortcut for this computer. */
export function pointerLabel(target: PointerTarget, mac: boolean): string {
  return target.label.replace("{paste}", mac ? "Cmd+V" : "Ctrl+V");
}
