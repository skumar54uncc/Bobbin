# Sheet size

Assistants read the whole Cortex Memory sheet. Claude's Drive connector
exports every tab as CSV, so Cortex estimates the sheet as the UTF-8 size
of that CSV (every tab, header rows included, cells quoted the way CSV
quotes them). The estimate is computed after every flush from local
memory, saved as `sheetBytes` in the sync state, shown in Settings under
Status as "Sheet size", and written to About row 3 ("Sheet size: 1.2 MB.
Rows: ..."). Units are binary: 1 MB is 1,048,576 bytes.

## Modes

| Setting | Standard (default) | Compact |
| --- | --- | --- |
| Visits, Searches, People, Companies | Retention (7 to 365 days) | Last 30 days, or retention if shorter |
| Content excerpts | Last 30 days, up to 800 characters | Last 7 days, up to 400 characters |
| Daily | Retention | Retention |
| Target | Under 3 MB | Under 600 KB |

Both modes merge repeat visits to the same URL on the same local day into
one Visits row with `visit_count`, `last_time`, and total dwell, and drop visits under
5 seconds.

## Trimming

When the estimate passes the target, Cortex removes whole days, oldest
first: Content, then Visits. Today is never removed. Searches, People, and
Companies are trimmed only if the sheet would pass 8 MB. Trimmed rows are
removed from the sheet and from local sync memory in the same flush, with
no reads. The status line says what was removed for a week, for example
"Kept the sheet under 600 KB by removing Content before 2026-09-20."

## Measured sizes

Seeded dataset from `src/assistant-sync/seed.ts`: 150 visits per weekday,
30 on weekend days, an excerpt on every 17th visit, retention 90 days,
measured on 2026-10-02 in America/New_York. Reproduce with
`node --import tsx scripts/measure-sheet-size.ts`.

The seed's excerpts are one short sentence, so the last column refills
each excerpt to its full length (800 characters, clipped to 400 in Compact)
to show the upper bound. The seed has no repeat visits, so merging does not
shrink it; real browsing with repeat visits comes out smaller.

| Seed | Mode | Rows | Size, seed excerpts | Size, full excerpts | Target |
| --- | --- | --- | --- | --- | --- |
| 30 days | Standard | 3,541 visits, 215 excerpts, 30 daily | 508,377 bytes (496 KB) | 666,991 bytes (651 KB) | 3 MB |
| 30 days | Compact | 3,541 visits, 49 excerpts, 30 daily | 480,967 bytes (470 KB) | 497,347 bytes (486 KB) | 600 KB |
| 90 days | Standard | 10,381 visits, 215 excerpts, 90 daily | 1,418,587 bytes (1.4 MB) | 1,577,213 bytes (1.5 MB) | 3 MB |
| 90 days | Compact | 3,541 visits, 49 excerpts, 90 daily | 486,768 bytes (475 KB) | 503,120 bytes (491 KB) | 600 KB |

No case needed a trim. Visits rows are most of the size: about 136 bytes
each in this seed. A heavier browser (around 5,000 page views a month)
would pass 600 KB in Compact, and Cortex would then trim the oldest
excerpts, then the oldest visit days.
