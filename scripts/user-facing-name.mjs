#!/usr/bin/env node
/**
 * Lists user-facing text in src/ that names the product "Cortex": words inside string and
 * template literals in .ts files (comments and identifiers skipped) and text or attribute
 * values in .html files. Internal identifiers (cortex-*, cortex_*, CortexX symbols) are not
 * matched: only the capitalized word on its own. Used by tests/product-name.test.ts.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const WORD = /(?<![A-Za-z0-9_$-])Cortex(?![A-Za-z0-9_$])/g;

/** Strings in a TS/JS source, with comments removed. Returns [line, text] pairs. */
export function stringsIn(src) {
  const out = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      const startLine = line;
      let text = "";
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\") {
          text += src[i] + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (src[i] === "\n") line++;
        text += src[i];
        i++;
      }
      i++;
      out.push([startLine, text]);
      continue;
    }
    i++;
  }
  return out;
}

/** HTML text and attribute values, without <script>/<style> bodies or comments. */
export function htmlText(src) {
  const cleaned = src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " ")).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, (m) => m.replace(/[^\n]/g, " "));
  return cleaned.split("\n").map((text, idx) => [idx + 1, text]);
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.(ts|html)$/.test(name) && !name.endsWith(".d.ts")) files.push(full);
  }
  return files;
}

export function findProductName(root) {
  const hits = [];
  for (const file of walk(join(root, "src"))) {
    const src = readFileSync(file, "utf8");
    const parts = file.endsWith(".html") ? htmlText(src) : stringsIn(src);
    for (const [line, text] of parts) {
      if (WORD.test(text)) hits.push({ file: relative(root, file), line, text: text.trim().slice(0, 160) });
      WORD.lastIndex = 0;
    }
  }
  return hits;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const h of findProductName(process.cwd())) console.log(`${h.file}:${h.line}: ${h.text}`);
}
