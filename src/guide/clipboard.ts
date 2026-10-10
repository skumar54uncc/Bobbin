import { sendRuntimeMessage } from "../shared/extension-runtime";
import { COPY_MESSAGE, COPY_TEXT_MAX, execCommandCopy } from "./exec-copy";

export { COPY_MESSAGE, COPY_TEXT_MAX, OFFSCREEN_COPY_MESSAGE, execCommandCopy } from "./exec-copy";

export function copyShortcutHint(): string {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform) || /Mac OS X/.test(navigator.userAgent);
  return mac ? "Press Cmd+C to copy" : "Press Ctrl+C to copy";
}

/**
 * writeText in a framed extension page still logs a Permissions policy violation
 * even when the call is in a try/catch. Skip it when this document is not top-level
 * (connect-frame inside a web page) or when the document policy forbids clipboard-write.
 * Side panel, options, and other top-level extension pages keep writeText.
 */
export function clipboardWriteAllowed(): boolean {
  if (window.parent !== window) return false;
  try {
    if (window.top !== window) return false;
  } catch {
    return false;
  }
  const policy = (document as Document & { featurePolicy?: { allowsFeature?: (name: string) => boolean } })
    .featurePolicy;
  if (typeof policy?.allowsFeature === "function" && policy.allowsFeature("clipboard-write") === false) {
    return false;
  }
  return true;
}

/**
 * Top-level extension pages: writeText, then execCommand, then the service worker.
 * Framed connect-frame: never writeText. execCommand first (must run before any await
 * so the click gesture is still valid), then the service worker / offscreen document.
 */
export async function copyText(text: string): Promise<boolean> {
  const value = text.slice(0, COPY_TEXT_MAX);
  if (!value) return false;
  if (clipboardWriteAllowed()) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {
      /* Missing user gesture on a top-level extension page. */
    }
  } else if (execCommandCopy(value)) {
    return true;
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
