/**
 * Ask any assistant: builds a context packet from local memory, previews it, and puts it
 * into the chat box on the page (Insert into chat) or on the clipboard (Copy). Never sends.
 */
import { formatPacket, itemLine, packetHeader, TEMPLATES, type PacketItem, type PacketRequest } from "./packet";

export type InsertReply = { ok: true } | { ok: false; reason: "nofield" | "rejected" | "blocked" };

export interface AttachDeps {
  request: (req: PacketRequest) => Promise<PacketItem[] | null>;
  insert: (text: string) => Promise<InsertReply>;
  copy: (text: string) => Promise<boolean>;
  now?: () => Date;
}

export const ATTACH_TITLE = "Ask any assistant";
export const ATTACH_LEAD = "Works in any chat. Cortex finds it in your memory and puts it in the chat box; you press send.";

const INSERT_ERRORS: Record<Exclude<InsertReply, { ok: true }>["reason"], string> = {
  nofield: "Cortex could not find a chat box. Click into the message box on the page, then try again, or use Copy.",
  rejected: "The chat box did not accept the text. Use Copy and paste it instead.",
  blocked: "Cortex cannot write on this page. Use Copy and paste it instead.",
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(className: string, text: string): HTMLButtonElement {
  const b = el("button", className, text);
  b.type = "button";
  return b;
}

export function renderAttachView(container: HTMLElement, deps: AttachDeps): void {
  const now = deps.now ?? (() => new Date());
  const root = el("section", "cx-attach");
  root.setAttribute("aria-labelledby", "cx-attach-title");
  const title = el("h3", "cx-connect-h", ATTACH_TITLE);
  title.id = "cx-attach-title";

  const form = el("form", "cx-attach-form");
  const input = el("input", "cx-attach-input");
  input.type = "text";
  input.maxLength = 500;
  input.placeholder = "Ask about your browsing";
  input.setAttribute("aria-label", "Your question");
  const find = el("button", "cx-btn cx-btn-secondary", "Find");
  find.type = "submit";
  form.append(input, find);

  const templates = el("div", "cx-attach-templates");
  templates.setAttribute("aria-label", "Templates");
  const templateButtons = TEMPLATES.map((t) => {
    const b = button("cx-attach-chip", t.label);
    b.dataset.template = t.id;
    templates.append(b);
    return { t, b };
  });

  const preview = el("div", "cx-attach-preview");
  preview.hidden = true;
  const header = el("p", "cx-attach-header");
  const list = el("ul", "cx-attach-items");
  const textLabel = el("label", "cx-attach-toggle");
  const withText = el("input");
  withText.type = "checkbox";
  textLabel.append(withText, el("span", undefined, "Include page text"));
  const actions = el("div", "cx-attach-actions");
  const insert = button("cx-btn cx-btn-primary", "Insert into chat");
  const copy = button("cx-btn cx-btn-secondary", "Copy");
  actions.append(insert, copy);
  preview.append(header, list, textLabel, actions);

  const status = el("p", "cx-attach-status");
  status.setAttribute("role", "status");

  root.append(title, el("p", "cx-connect-lead", ATTACH_LEAD), form, templates, preview, status);
  container.append(root);

  let current: Omit<PacketRequest, "withText"> | null = null;
  let items: PacketItem[] = [];
  const removed = new Set<string>();
  let run = 0;

  const kept = () => items.filter((i) => !removed.has(i.key));
  const packet = () => formatPacket(kept(), withText.checked);

  const paint = () => {
    const shown = kept();
    preview.hidden = !current || shown.length === 0;
    header.textContent = shown.length ? packetHeader(shown) : "";
    list.replaceChildren(
      ...shown.map((item) => {
        const li = el("li", "cx-attach-item");
        const line = el("span", "cx-attach-line", itemLine(item));
        const remove = button("cx-attach-remove", "Remove");
        remove.setAttribute("aria-label", `Remove ${item.label}`);
        remove.addEventListener("click", () => {
          removed.add(item.key);
          paint();
          if (!kept().length) status.textContent = "Everything was removed. Pick a template or ask again.";
        });
        li.append(line, remove);
        if (withText.checked && item.text) li.append(el("p", "cx-attach-excerpt", item.text.replace(/\s+/g, " ").slice(0, 300)));
        return li;
      })
    );
  };

  const load = async () => {
    if (!current) return;
    const mine = ++run;
    status.textContent = "Looking in your memory.";
    const got = await deps.request({ ...current, withText: withText.checked }).catch(() => null);
    if (mine !== run) return;
    if (got == null) {
      items = [];
      status.textContent = "Cortex could not search right now. Try again.";
    } else {
      items = got;
      status.textContent = got.length
        ? ""
        : current.source === "searches"
          ? "No searches saved for that time. Cortex saves searches while Assistant Sync is on."
          : "Nothing found for that. Try other words or a template.";
    }
    paint();
  };

  const start = (req: Omit<PacketRequest, "withText">) => {
    current = req;
    removed.clear();
    void load();
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const query = input.value.trim();
    if (query) start({ source: "query", query });
  });
  for (const { t, b } of templateButtons) {
    b.addEventListener("click", () => {
      input.value = "";
      start({ source: t.source, ...t.range(now()) });
    });
  }
  // Page text is read only when asked for, so turning it on looks again.
  withText.addEventListener("change", () => void load());

  insert.addEventListener("click", () => {
    const text = packet();
    if (!text) return;
    insert.disabled = true;
    void deps
      .insert(text)
      .catch((): InsertReply => ({ ok: false, reason: "blocked" }))
      .then((res) => {
        status.textContent = res.ok ? "Inserted. Review it in the chat box, then send." : INSERT_ERRORS[res.reason];
      })
      .finally(() => {
        insert.disabled = false;
      });
  });
  copy.addEventListener("click", () => {
    const text = packet();
    if (!text) return;
    void deps.copy(text).then((ok) => {
      status.textContent = ok ? "Copied. Paste it into any chat." : "Copy did not work.";
    });
  });
}
