export const COPY_TEXT_MAX = 100_000;
export const COPY_MESSAGE = "CORTEX_COPY_TEXT";
export const OFFSCREEN_COPY_MESSAGE = "CORTEX_OFFSCREEN_COPY";

/** execCommand copy from a hidden textarea. Used in the offscreen document (reason CLIPBOARD). */
export function execCommandCopy(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } finally {
    ta.remove();
  }
  return ok;
}
