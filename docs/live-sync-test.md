# Live Assistant Sync test (about 15 minutes)

Run this against a real Google Sheet in a separate Chrome profile, so your
everyday profile and Drive stay untouched.

## Before the clock starts

1. Build: `npm run build`. For console lines on every pass, build with
   `CORTEX_DEBUG=1 npm run build` instead.
2. Chrome: profile menu > Add, and sign the new profile in with a test
   Google account. Cortex asks Chrome for a token, and Chrome uses the
   profile's account. If the OAuth consent screen of the dev client is in
   testing mode, the account must be on its test user list.
3. In the new profile open `chrome://extensions`, turn on Developer mode,
   Load unpacked, pick `dist/`.
4. Finish onboarding and allow capture.
5. Open two windows side by side: Settings > Assistant Sync, and a
   browsing window.
6. Open the flush log: `chrome://extensions` > Cortex > Inspect views:
   service worker. In the console:

   ```js
   const log = async () => console.table((await chrome.storage.local.get("cortex_assist_flush_log")).cortex_assist_flush_log);
   await log();
   ```

   Run `await log()` again after each step. Each row is one pass: time,
   trigger (`enable`, `alarm`, `now`), status, rows appended, Sheets reads
   and writes. No URLs or titles are logged.

## Minute 0: enable

1. Settings > Assistant Sync > Enable. Sign in, allow.
2. Check Drive: one spreadsheet "Cortex Memory", inside a folder "Cortex
   Memory". If earlier attempts left Cortex Memory folders, the sheet is
   in the oldest one and no new folder appears. Tabs in order: About,
   Visits, Content, Searches, People, Companies, Daily. There is no
   "Sheet1" tab.
3. Flush log: one `enable` row, status `ready`. The Enable pass reads the
   sheet first, so reads is above 0 here. That is expected.
4. If Enable fails, Settings, Last error starts with "Google did not allow
   Cortex to create or edit the sheet." for a 403, followed by Google's
   message. In the console, print what failed:

   ```js
   (await chrome.storage.local.get("cortex_assist_flush_log")).cortex_assist_flush_log.at(-1).error_detail
   ```

   `call` is search, folder create, sheet create, batchUpdate, or read.
   Send that object as it is.
5. Write down the time. About row 2 shows "Last synced" with that time.

## Minutes 1 to 4: browse

Do each item in a new tab and close the tab when done.

| Do | Expect in the sheet |
| --- | --- |
| Open 5 different articles, read each for at least 20 seconds | 5 article rows in Visits, dwell_minutes filled |
| Open one article for under 5 seconds, close it | No row |
| Search Google twice | 2 Searches rows |
| Open one LinkedIn profile for 20 seconds (if signed in) | 1 People row, no photo column, no photo URL |
| Open a site in your block list, or a bank site | No row |
| Open one.google.com or myaccount.google.com | No row (on the block list by default) |
| Open the Cortex Memory sheet itself, and its Drive folder | No row |
| Open one article and leave the tab open | No row yet |
| Reopen one of the 5 articles, read 20 seconds, close it | Still one row for it, visit_count 2, dwell is the total |

Also check locally: open Cortex search, search for one of the articles.
The result shows "Read N min" (or "Read under a minute").

## Minutes 5 to 7: activity flush

The first activity flush comes 5 minutes after the Enable pass, plus 0 to
60 seconds of jitter.

1. Flush log: a new `alarm` row, status `ready`, reads 0, writes 1.
   appended is the rows you expect plus 1, because today's Daily row
   counts too.
2. Sheet, counting rows under the header:
   - Visits: one row per article per day; the reopened article shows
     visit_count 2, time is when you first opened it and last_time is
     when you reopened it. The last two column headers are visit_count
     and last_time. Search pages
     and the LinkedIn profile also get a Visits row, with the same id as
     their Searches or People row. The short read, the blocked site, and
     the open tab are absent. Article rows have 1 to 3 labels in topics
     (a page that matches no topic stays blank).
   - Searches: 2. People: 1 if you opened a profile.
   - Content: empty. Excerpts are written only for pages read 5 minutes or more.
   - About row 2: "Last synced" moved to this flush.
   - About row 3: "Sheet size: N KB." and the counts match the tab row
     counts. Settings, Status, Sheet size shows the same size.
   - About, last row: schema_version: 4. Near the top: "This sheet is
     managed by Cortex. Editing or deleting rows can cause wrong answers."
   - Type into any cell on any tab: Sheets shows a warning before the
     edit and lets you continue. Press Cancel so the sheet stays as
     Cortex wrote it. Data, Protect sheets and ranges lists one
     "Managed by Cortex" entry per tab (7).
   - Daily: a row for today with pages_visited, profiles_viewed, searches.
     pages_visited counts every visit, so the reopened article counts twice.

## Minute 7: Sync now and the countdown

1. Close the tab you left open.
2. Press Sync now within a minute of the last flush. The status line
   reads "Syncing in Ns" and counts down, then "Syncing now.". Cortex
   never flushes more than once a minute. The button rests for 30
   seconds after a press.
3. Flush log: a `now` row, appended 2 (the visit and today's Daily row),
   reads 0, writes 1.
4. Sheet: the closed article is in Visits.
5. Press Sync now again with nothing new. Flush log shows appended 0 and
   writes 0.

## Minute 9: duplicates

In each of Visits, Searches, People: select column A, then Data > Column
stats. Unique values must equal the count of values. This reads the sheet
without changing it.

## Minute 10: crash during a flush

1. Read two more articles and close them.
2. Press Sync now and quit Chrome right away (Cmd+Q).
3. Reopen the profile. Startup plans a flush. Wait for the next row in the
   flush log. If the quit landed mid write, this pass reads the sheet first
   (reads above 0) to learn what was saved.
4. Repeat the Column stats check. No duplicates, and both articles are
   there once.

## Minutes 10 to 15: quiet time

Do nothing. The safety alarm runs every 15 minutes and plans a pass. With
nothing pending the pass makes no write: the flush log shows an `alarm`
row with appended 0 and writes 0, and the sheet does not change.

## Pass criteria

- Every expected row is in the sheet once, within 7 minutes of closing the
  tab, and right after Sync now.
- No rows for short reads, blocked sites, or open tabs.
- Normal flushes: 0 reads, 1 write.
- About and Daily match the tab counts.
- No duplicate ids after the crash step.
- Every tab warns before a manual edit, with one "Managed by Cortex"
  protection each.

## Optional: history import (outside the 15 minutes)

Settings, History import: Time range Last 7 days, Max URLs to try 50,
then Scan history. Imported
articles show up in Cortex search with their text, not just the title.
Before Phase 2 the service worker had no DOM to parse them; now the
offscreen document does it. This needs no sheet, so you can run it any
time.
