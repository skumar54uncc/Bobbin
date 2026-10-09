import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const WORD = /(?<![A-Za-z0-9_$-])Cortex(?![A-Za-z0-9_$])/g;

export function stringsIn(src: string): [number, string][] {
  const out: [number, string][] = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "\n") {
      line += 1;
      i += 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") line += 1;
        i += 1;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      const startLine = line;
      let text = "";
      i += 1;
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\") {
          text += src[i] + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (src[i] === "\n") line += 1;
        text += src[i];
        i += 1;
      }
      i += 1;
      out.push([startLine, text]);
      continue;
    }
    i += 1;
  }
  return out;
}

export function htmlText(src: string): [number, string][] {
  const cleaned = src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " ")).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, (m) => m.replace(/[^\n]/g, " "));
  return cleaned.split("\n").map((text, idx) => [idx + 1, text]);
}

function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.(ts|html)$/.test(name) && !name.endsWith(".d.ts")) files.push(full);
  }
  return files;
}

export function findProductName(root: string): { file: string; line: number; text: string }[] {
  const hits: { file: string; line: number; text: string }[] = [];
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
