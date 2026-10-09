/**
 * Runs in the chat page through chrome.scripting.executeScript, after the user clicks
 * Insert into chat. It must stay self-contained: Chrome sends only this function's source.
 *
 * It writes into the focused text field, or the one that was focused when the Cortex panel
 * opened, and never submits: no Enter key, no clicks, no form submit.
 */
export type InsertResult = { ok: true } | { ok: false; reason: "nofield" | "rejected" };

export function insertIntoField(text: string): InsertResult {
  const editable = (el: Element | null | undefined): el is HTMLElement => {
    if (!el || !el.isConnected) return false;
    if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
    if (el instanceof HTMLInputElement) return /^(text|search|)$/.test(el.type) && !el.disabled && !el.readOnly;
    return el instanceof HTMLElement && el.isContentEditable;
  };
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  if (!editable(el)) el = (window as unknown as { __cortexLastField?: Element | null }).__cortexLastField ?? null;
  if (!editable(el)) return { ok: false, reason: "nofield" };
  el.focus({ preventScroll: false });

  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    // setRangeText leaves the page's own value tracking alone, so frameworks see the change.
    el.setRangeText(text, start, end, "end");
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: text }));
    return { ok: true };
  }

  const before = el.textContent ?? "";
  const data = new DataTransfer();
  data.setData("text/plain", text);
  const paste = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
  el.dispatchEvent(paste);
  // The editor took the paste (it may insert after this returns).
  if (paste.defaultPrevented || (el.textContent ?? "") !== before) return { ok: true };
  document.execCommand("insertText", false, text);
  return (el.textContent ?? "") !== before ? { ok: true } : { ok: false, reason: "rejected" };
}
