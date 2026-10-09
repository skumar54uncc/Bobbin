#!/usr/bin/env node
/** Fails when a shipped bundle exceeds its byte budget. Run after `npm run build`. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const KB = 1024;
/** Budgets in bytes. content.js is injected into every http(s) page. */
export const BUNDLE_BUDGETS = {
  // content.js: lifecycle + messaging only since Phase 5 task 0.2 (was 45 KB).
  "content.js": 15 * KB,
  // extract.js is injected only after the privacy gate passes, never on every
  // page. It grew with YouTube identity capture (Phase 6 follow-up), then to 76 KB in
  // v2 Phase 3B fixes: LinkedIn profile sections (overlay stripping, full About, roles, schools, skills).
  // 76 KB to 84 KB in v2 Phase 4.0: no new code, keeps 8 KB free for the next capture fix.
  "extract.js": 84 * KB,
  "resurface-chip.js": 8 * KB,
  "youtube-bridge.js": 4 * KB,
  // Search cards, digest hierarchy, filters, and on-device photo sharpening.
  "overlay.js": 164 * KB,
  // Multi-provider cloud chat (OpenAI-compatible and Anthropic) lives in the worker.
  // Sync scheduling and dwell tracking add 5.3 KB; valibot message checks add 5.2 KB.
  // Set with 15 KB headroom before v2 Phase 2. Readability left for offscreen in Phase 2,
  // so about 49 KB is free. Largest parts now: Dexie and the worker itself.
  "service-worker.js": 254 * KB,
  // 700 KB to 708 KB in v2 Phase 4.0: no new code, keeps 8 KB free (Pages docs filled the old headroom).
  "offscreen.js": 708 * KB,
  // Readability for imported history pages: lazy, offscreen only (DOMParser needs a document).
  "history-extract.js": 40 * KB,
  // Assistant Sync: Drive client and int8 topic vectors, lazy only.
  // Caps stay under the 130 KB float file so that file cannot return.
  // 48 KB to 56 KB in v2 Phase 2: repeat visit merging, sheet size budget, Drive restore and cleanup.
  // 56 KB to 64 KB after the live test: Drive-created sheet setup and Google error details. Keeps 8 KB free.
  // 64 KB to 72 KB in v2 Phase 3: URL cleanup, instruction flags, other device visits, device column.
  // 72 KB to 77 KB in v2 Phase 3B: Pages day docs (sections, size cap, Drive upload), feed posts. Keeps 8 KB free.
  // 77 KB to 83 KB in the Phase 3B fixes: user deleted day docs and Undo, labeled profile sections, challenge pages.
  "assistant-sync.js": 83 * KB,
  "assistant-sync-topics.js": 48 * KB,
  "assistant-sync-capture.js": 16 * KB,
  // v2 Phase 5: Ask any assistant's local record (searches and page text, sync on or off), lazy in offscreen.
  // Its own chunk so assistant-sync.js keeps its 8 KB free. 18.6 KB at creation; keeps 8 KB free.
  "assistant-sync-local.js": 27 * KB,
  // Options Assistant Sync panel. Stays far under a Dexie or Drive client import.
  "assistant-sync-options.js": 16 * KB,
  // pdfjs-dist (Phase 5.9): lazy chunk and worker, loaded only when a PDF is read.
  "pdf.js": 560 * KB,
  "pdf.worker.min.mjs": 1400 * KB,
  "search-shell.js": 164 * KB,
  "options.js": 40 * KB,
  // v2 Phase 4 guided setup: the Connect frame in the panel, the setup side panel, the optional
  // on-page pointer (injected only into the assistant tab), and the lazy Settings section.
  "connect-frame.js": 24 * KB,
  "guide-panel.js": 26 * KB,
  "guide-pointer.js": 16 * KB,
  "connect-options.js": 24 * KB,
  "popup.js": 20 * KB,
  "onboarding.js": 10 * KB,
};

const dist = join(process.cwd(), "dist");
let failed = false;
for (const [file, budget] of Object.entries(BUNDLE_BUDGETS)) {
  let size = -1;
  try {
    size = statSync(join(dist, file)).size;
  } catch {
    /* missing */
  }
  const ok = size >= 0 && size <= budget;
  if (!ok) failed = true;
  const status = size < 0 ? "MISSING" : ok ? "ok" : "OVER";
  console.log(
    `${status.padEnd(7)} ${file.padEnd(20)} ${String(size).padStart(8)} / ${String(budget).padStart(8)} bytes`
  );
}
// The ONNX Runtime binary must ship exactly once, under wasm/ (Phase 6).
const strayDesign = [];
function rejectDesignOnly(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === "dev" || name === "PREVIEW.png") {
      strayDesign.push(full.slice(dist.length + 1));
      continue;
    }
    if (statSync(full).isDirectory()) rejectDesignOnly(full);
  }
}
rejectDesignOnly(dist);
if (strayDesign.length) {
  failed = true;
  console.error(`FAIL    design-only file in the package: ${strayDesign.join(", ")}`);
}
const strayWasm = readdirSync(dist).filter((f) => f.endsWith(".wasm"));
if (strayWasm.length) {
  failed = true;
  console.error(`FAIL    duplicate .wasm at the package root: ${strayWasm.join(", ")}`);
}
const swSource = readFileSync(join(dist, "service-worker.js"), "utf8");
const swDomLoader =
  swSource.includes("document.createElement") ||
  swSource.includes("document.getElementsByTagName") ||
  swSource.includes("document.head") ||
  swSource.includes("document.currentScript");
if (swDomLoader) {
  failed = true;
  console.error(
    "FAIL    service-worker.js touches document (chunk loader must stay out of the service worker)"
  );
}
if (failed) {
  console.error("Bundle budget check FAILED");
  process.exit(1);
}
console.log("Bundle budget check passed");
