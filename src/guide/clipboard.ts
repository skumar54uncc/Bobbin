import { sendRuntimeMessage } from "../shared/extension-runtime";
import { COPY_MESSAGE, COPY_TEXT_MAX } from "./exec-copy";

export { COPY_MESSAGE, COPY_TEXT_MAX, OFFSCREEN_COPY_MESSAGE } from "./exec-copy";

export function copyShortcutHint(): string {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform) || /Mac OS X/.test(navigator.userAgent);
  return mac ? "Press Cmd+C to copy" : "Press Ctrl+C to copy";
}

/**
 * a. navigator.clipboard.writeText
 * b. the service worker copies through the offscreen document
 * Host pages can block clipboard access for iframes (Permissions-Policy).
 */
export async function copyText(text: string): Promise<boolean> {
  const value = text.slice(0, COPY_TEXT_MAX);
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* Permissions-Policy on the host page, or a missing user gesture. */
  }
  try {
    const res = (await sendRuntimeMessage({ type: COPY_MESSAGE, text: value })) as { ok?: boolean } | undefined;
    return res?.ok === true;
  } catch {
    return false;
  }
}

/** Selected read-only box when both clipboard paths fail. */
export function showManualCopy(parent: HTMLElement, text: string): HTMLTextAreaElement {
  parent.querySelector(".cx-copy-manual")?.remove();
  const wrap = document.createElement("div");
  wrap.className = "cx-copy-manual";
  const hint = document.createElement("p");
  hint.className = "cx-copy-manual-hint";
  hint.textContent = copyShortcutHint();
  const box = document.createElement("textarea");
  box.className = "cx-copy-manual-box";
  box.readOnly = true;
  box.value = text;
  box.setAttribute("aria-label", "Text to copy");
  wrap.append(hint, box);
  parent.append(wrap);
  box.focus();
  box.select();
  return box;
}
