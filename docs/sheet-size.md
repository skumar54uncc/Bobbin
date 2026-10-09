# Sheet size

Assistants read the whole Cortex Memory sheet. Claude's Drive connector
exports every tab as CSV, so Cortex estimates the sheet as the UTF-8 size
of that CSV (every tab, header rows included, cells quoted the way CSV
quotes them). The estimate is computed after every flush from local
memory, saved as `sheetBytes` in the sync state, shown in Settings under
Status as "Sheet size", and written to About row 5 ("Sheet size: 1.2 MB.
Rows: ..."). Units are binary: 1 MB is 1,048,576 bytes.

## Modes

| Setting | Standard (default) | Compact |
| --- | --- | --- |
| Visits, Searches, People, Companies | Retention (7 to 365 days) | Last 30 days, or retention if shorter |
| Pages day docs (page text, outside the sheet) | Retention | Last 14 days, or retention if shorter |
| Daily | Retention | Retention |
| Target | Under 3 MB | Under 600 KB |

Both modes merge repeat visits to the same URL on the same local day into
one Visits row with `visit_count`, `last_time`, and total dwell, and drop visits under
5 seconds. Page text is not in the sheet: it lives in the Pages day docs
(`docs/sync.md`, "Pages docs"), so it does not count toward the sheet size.

## Trimming

When the estimate passes the target, Cortex removes whole days of Visits,
oldest first. Today is never removed. Searches, People, and Companies are
trimmed only if the sheet would pass 8 MB. Trimmed rows are removed from
the sheet and from local sync memory in the same flush, with no reads. The
status line says what was removed for a week, for example "Kept the sheet
under 600 KB by removing Visits before 2026-09-20."

## Measured sizes

Seeded dataset from `src/assistant-sync/seed.ts`: 150 visits per weekday,
30 on weekend days, page text on every 17th visit, retention 90 days,
measured on 2026-10-08 for 2026-10-02 in America/New_York. Reproduce with
`npx tsx scripts/measure-sheet-size.ts`. The seed has no repeat visits, so
merging does not shrink it; real browsing with repeat visits comes out
smaller.

| Seed | Mode | Rows | CSV size | Target |
| --- | --- | --- | --- | --- |
| 30 days | Standard | 3,541 visits, 30 daily | 520,695 bytes (508 KB) | 3 MB |
| 30 days | Compact | 3,541 visits, 30 daily | 520,695 bytes (508 KB) | 600 KB |
| 90 days | Standard | 10,381 visits, 90 daily | 1,519,705 bytes (1.4 MB) | 3 MB |
| 90 days | Compact | 3,541 visits, 90 daily | 526,496 bytes (514 KB) | 600 KB |

No case needed a trim. Visits rows are most of the size: about 147 bytes
each in this seed, including the `pages_doc` link.

## Pages day doc sizes

Characters are what the 500,000 character cap counts (headings, metadata
lines, labels, and text). HTML bytes are the UTF-8 size of the upload.

| Day | Sections | Characters | HTML bytes |
| --- | --- | --- | --- |
| Largest seeded day, seed text (one sentence per page) | 10 | 3,077 | 3,928 |
| Same day, every page filled to 4,000 characters | 10 | 42,452 | 43,303 |
| 200 pages at 4,000 characters, before the cap | 200 | 841,579 | 855,919 |
| Same 200 pages after the cap (every body shortened, every heading kept) | 200 | 498,179 | 512,519 |
