// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { insertIntoField } from "../src/attach/insert-field";

afterEach(() => {
  document.body.innerHTML = "";
  delete (window as { __cortexLastField?: unknown }).__cortexLastField;
});

describe("Insert into chat", () => {
  it("writes at the caret of the focused box and never submits", () => {
    document.body.innerHTML = `<form><textarea>Hello </textarea><button>Send</button></form>`;
    const form = document.querySelector("form")!;
    const box = document.querySelector("textarea")!;
    const submit = vi.fn((e: Event) => e.preventDefault());
    const keys = vi.fn();
    form.addEventListener("submit", submit);
    document.addEventListener("keydown", keys, true);
    const input = vi.fn();
    box.addEventListener("input", input);
    box.focus();
    box.setSelectionRange(6, 6);
    expect(insertIntoField("Context")).toEqual({ ok: true });
    expect(box.value).toBe("Hello Context");
    expect(input).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
    expect(keys).not.toHaveBeenCalled();
  });

  it("uses the box that had focus when the Cortex panel opened", () => {
    document.body.innerHTML = `<textarea id="chat"></textarea><button id="other">x</button>`;
    (window as { __cortexLastField?: unknown }).__cortexLastField = document.getElementById("chat");
    (document.getElementById("other") as HTMLButtonElement).focus();
    expect(insertIntoField("Context")).toEqual({ ok: true });
    expect((document.getElementById("chat") as HTMLTextAreaElement).value).toBe("Context");
  });

  it("finds no box when nothing editable has focus", () => {
    document.body.innerHTML = `<textarea disabled></textarea><input type="password"><button>x</button>`;
    (document.querySelector("input") as HTMLInputElement).focus();
    expect(insertIntoField("Context")).toEqual({ ok: false, reason: "nofield" });
    (window as { __cortexLastField?: unknown }).__cortexLastField = document.querySelector("textarea");
    expect(insertIntoField("Context")).toEqual({ ok: false, reason: "nofield" });
  });

  it("is self-contained, and never presses keys, clicks, or submits", () => {
    const src = readFileSync(join(__dirname, "..", "src", "attach", "insert-field.ts"), "utf8");
    expect(src).not.toMatch(/^import /m);
    expect(src).not.toMatch(/KeyboardEvent|\.click\(|\.submit\(|requestSubmit|"Enter"/);
  });

  it("only the Connect frame can ask for items or an insert", () => {
    const sw = readFileSync(join(__dirname, "..", "src", "background", "service-worker.ts"), "utf8");
    const items = sw.slice(sw.indexOf('type === "CORTEX_PACKET_ITEMS"'), sw.indexOf('type === "CORTEX_PACKET_INSERT"'));
    const insert = sw.slice(sw.indexOf('type === "CORTEX_PACKET_INSERT"'), sw.indexOf('type === "CORTEX_DWELL_ALLOWED"'));
    expect(items).toContain("!isConnectFrameSender(sender) || !req");
    expect(insert).toContain("!isConnectFrameSender(sender) || !text.trim()");
    expect(insert).toContain("func: insertIntoField");
  });
});
