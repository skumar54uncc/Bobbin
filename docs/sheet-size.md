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
| 30 days | Standard | 3,541 visits, 30 daily | 521,028 bytes (509 KB) | 3 MB |
| 30 days | Compact | 3,541 visits, 30 daily | 521,028 bytes (509 KB) | 600 KB |
| 90 days | Standard | 10,381 visits, 90 daily | 1,520,038 bytes (1.4 MB) | 3 MB |
| 90 days | Compact | 3,541 visits, 90 daily | 526,829 bytes (514 KB) | 600 KB |

No case needed a trim. Visits rows are most of the size: about 147 bytes
each in this seed, including the `pages_doc` link.

## Pages day doc sizes

Characters are what the day doc cap counts (headings, metadata lines,
labels, and text): 500,000 with Standard sheet detail, 150,000 with
Compact. HTML bytes are the UTF-8 size of the upload; the inline styles
(9pt text, 11pt headings, 14pt title, single spacing) add bytes to the
upload but no characters to the doc.

| Day | Sections | Characters | HTML bytes | Characters per section | HTML bytes per section |
| --- | --- | --- | --- | --- | --- |
| Largest seeded day, seed text (one sentence per page) | 10 | 3,157 | 6,585 | 315.7 | 658.5 |
| Same day, every page filled to 4,000 characters | 10 | 42,532 | 45,960 | 4,253.2 | 4,596.0 |
| 200 pages at 4,000 characters, before the cap | 200 | 843,179 | 906,836 | 4,215.9 | 4,534.2 |
| Same 200 pages after the Standard cap (every body shortened, every heading kept) | 200 | 499,779 | 563,436 | 2,498.9 | 2,817.2 |
| Same 200 pages after the Compact cap | 200 | 149,779 | 213,436 | 748.9 | 1,067.2 |

Before the compact layout (heading "[id] HH:MM · title · domain", no
styles), the seeded day was 3,077 characters and 3,928 HTML bytes for 10
sections (307.7 characters per section), and 42,452 characters (4,245.2
per section) with every page full. The domain now sits on the metadata
line as "Domain: ...", which adds 8 characters per section.
