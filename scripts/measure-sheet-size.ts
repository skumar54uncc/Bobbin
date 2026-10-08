/**
 * Measures the CSV size of the seeded sheet in both sheet detail modes.
 * Run: npx tsx scripts/measure-sheet-size.ts
 * Results go in docs/sheet-size.md.
 */
import { seedMemory } from "../src/assistant-sync/seed";
import { buildWorkbook, type MemoryRows } from "../src/assistant-sync/sheet";
import { formatSheetSize, SHEET_DETAIL, type SheetDetail } from "../src/assistant-sync/sheet-detail";
import { tabCutoffs } from "../src/assistant-sync/sync-engine";

const NOW = Date.parse("2026-10-02T16:00:00.000Z");
const ZONE = "America/New_York";
const RETENTION_DAYS = 90;

/** The seed's excerpts are one sentence. This fills each one to 800 characters to show the upper bound. */
function fullExcerpts(memory: MemoryRows): MemoryRows {
  const filler = "Measured reading text for the size check. ".repeat(30);
  return { ...memory, content: memory.content.map((row) => ({ ...row, excerpt: `${row.excerpt} ${filler}`.slice(0, 800) })) };
}

function measure(memory: MemoryRows, detail: SheetDetail) {
  const workbook = buildWorkbook(memory, {
    title: "Cortex Memory",
    timeZone: ZONE,
    syncedAt: "2026-10-02 12:00",
    detail,
    cutoffs: tabCutoffs(NOW, ZONE, RETENTION_DAYS, detail),
  });
  const rows = Object.fromEntries(workbook.tabs.map((tab) => [tab.title, Math.max(0, tab.rows.length - 1)]));
  return { bytes: workbook.bytes, rows };
}

const lines: string[] = [];
for (const days of [30, 90]) {
  const seed = seedMemory({ days, now: NOW, timeZone: ZONE });
  for (const detail of ["standard", "compact"] as SheetDetail[]) {
    const plain = measure(seed, detail);
    const full = measure(fullExcerpts(seed), detail);
    lines.push(
      [
        `${days} days`,
        detail,
        `${plain.rows.Visits} visits, ${plain.rows.Content} excerpts, ${plain.rows.Daily} daily`,
        `${plain.bytes} (${formatSheetSize(plain.bytes)})`,
        `${full.bytes} (${formatSheetSize(full.bytes)})`,
        formatSheetSize(SHEET_DETAIL[detail].targetBytes),
      ].join(" | ")
    );
  }
}
console.log(lines.join("\n"));
