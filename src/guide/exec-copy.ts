export const COPY_TEXT_MAX = 100_000;
export const COPY_MESSAGE = "CORTEX_COPY_TEXT";
export const OFFSCREEN_COPY_MESSAGE = "CORTEX_OFFSCREEN_COPY";

/** execCommand copy from a hidden textarea. Used in the offscreen document (reason CLIPBOARD). */
export function execCommandCopy(text: string): boolean {
  const existing = document.getElementById("cx-clipboard");
  const ta = existing instanceof HTMLTextAreaElement ? existing : document.createElement("textarea");
  const created = ta !== existing;
  ta.value = text;
  if (created) {
    ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0";
    document.body.appendChild(ta);
  }
  ta.focus();
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } finally {
    if (created) ta.remove();
  }
  return ok;
}

/**
 * Injected into the offscreen document or copy-tab.html. Must stay self-contained:
 * Chrome sends only this function's source to executeScript. writeText can hang
 * in automation, so this path uses execCommand only.
 */
export function copyInPage(value: string): boolean {
  const box = document.querySelector("textarea");
  if (!box) return false;
  box.value = value;
  box.focus();
  box.select();
  return document.execCommand("copy");
}

/**
 * Offscreen copy uses execCommand only. writeText here has no user gesture, and in
 * automation it can hang instead of rejecting, which would stall the service worker reply.
 */
export async function copyInOffscreen(text: string): Promise<boolean> {
  const value = text.slice(0, COPY_TEXT_MAX);
  if (!value) return false;
  try {
    window.focus();
  } catch {
    /* Offscreen documents may ignore focus. */
  }
  return execCommandCopy(value);
}
