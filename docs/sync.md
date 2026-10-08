# Assistant Sync: cadence and quota math

Quota numbers come from `docs/quotas.md`: 300 reads and 300 writes per minute per project, 60 of each per
minute per user. Every Cortex user shares one Google Cloud project, so the per-project numbers are the ones
that bind.

## What triggers a flush

A flush is one `spreadsheets.batchUpdate` holding every change: new rows per tab (`appendCells`), the Daily
rows for touched days (`updateCells` in place, or `appendCells` for a new day), the About tab
(`updateCells`), rows past retention (`deleteDimension` by position), and any tab the user deleted
(`addSheet`).

| Trigger | When it runs |
| --- | --- |
| Activity | A visit ends (tab closed, navigated away, or silent for an hour). The flush runs 5 minutes after the previous flush, plus 0 to 60 seconds of jitter. If the last flush was longer ago, it runs within 60 seconds. |
| Safety alarm | Every 15 minutes. Ends stale visits, then plans a flush with jitter. Sends nothing when nothing changed. |
| Startup | Browser start, extension install or update. Plans a flush with jitter. |
| Sync now | Runs at once if the last flush was 60 seconds ago or more. Otherwise Settings counts down ("Syncing in 23s") and it runs when the minute is up. The button rests for 30 seconds after a press. |
| Enable | Reads the sheet, then writes the backfill. A backfill over 1.5 MB continues one minute later. |

Hard rules, enforced by `runFlush` and `plannedFlushAt` in `src/assistant-sync/`:

- At most one flush per minute per user, Sync now included.
- Rows of a visit go out only after the visit ends, so dwell and the excerpt are final when written.
  Visits with less than 5 seconds of measured attention are dropped.
- On 429 or 5xx: exponential backoff with full jitter, from 30 seconds up to 15 minutes. Rows stay queued.
  Nothing is dropped.
- Three flushes in a row that end in 429 start slow mode: flushes run on the 15-minute cadence for 24 hours.
  Settings says so.
- On 401: the service worker drops the cached token, gets a fresh one silently, and retries once. A second
  refusal pauses sync and Settings shows "Sync paused: reconnect Google Drive."
- Idempotent: every row has a stable id, and a key per row is stored locally once Google confirms the batch.
  An inflight record is written before sending. If Chrome dies mid-flush, or Google's reply is lost, the next
  flush reads the sheet's id column and marks what arrived. Nothing is appended twice.

The status line in Settings is built from this recorded state, never from a fixed string. Examples:

- "Synced 2 min ago. Updates about every 5 minutes while you browse, and at least every 15 minutes."
- "Waiting to sync 14 new pages. Next try in 3 min."
- "Sync paused: reconnect Google Drive."

## Reads

A normal flush makes zero reads. Cortex keeps the sheet layout locally: tab ids, which tabs have a header,
and the rows of each tab as a run-length list of dates in sheet order. Appends extend the list. Retention
turns old runs into row ranges and deletes them bottom first, so earlier indexes stay valid.

Reads happen only in verification, which costs 2 reads (`spreadsheets.get` for tab ids and one
`values:batchGet` of columns A and B of every tab):

| Reason | How often |
| --- | --- |
| Enable | Once per Enable click |
| Browser start | At most once per 24 hours per user |
| Recovery | After a 5xx, a lost reply, a 400 or 404, or a crash mid-flush |

Reads per user per day, normal use: 2. Upper bound with one recovery a day: 4.

## Writes per user

While browsing without pause: at most one write every 5 minutes, about 12 an hour. The jitter makes the
average gap about 5.5 minutes, about 11 an hour. An idle browser with nothing new makes no requests.

## Project-wide math

Worst case: every user is browsing at the same moment, nonstop. Real traffic is spread over the day, so these
are ceilings.

| Users | Writes per minute, all active | Share of 300 | Reads per minute, normal | Startup check spike |
| --- | --- | --- | --- | --- |
| 30 | 6 | 2% | 0 | 60 reads if all 30 start Chrome in the same minute (20%) |
| 1,000 | 200 | 67% | 0 | 2,000 reads if all start in the same minute |
| 10,000 | 2,000 | 667% | 0 | 20,000 reads if all start in the same minute |

Per user, Cortex never exceeds 1 write and 2 reads in a minute, far under the 60 per user limit.

### The previous engine, for comparison

The previous engine ran every 30 seconds and made about 20 reads and 6 to 10 writes per run. That is about
40 reads and 12 to 20 writes per minute per user. 30 users made about 1,200 reads per minute: four times the
project quota.

### Where it stops scaling, and what happens then

- Up to about 1,000 users all active at once, writes stay under the project quota.
- Above that, Google returns 429 to some flushes. Full-jitter backoff spreads the retries. After three 429s in
  a row a user drops to the 15-minute cadence for a day, which cuts that user's writes by two thirds. Rows
  queue locally and nothing is lost. At 10,000 users all in slow mode the ceiling is about 667 writes per
  minute, still over 300, so a fleet that large needs a quota increase from the Google Cloud console.
- The startup check is the only read burst. It is limited to once a day per user and goes out with up to 60
  seconds of jitter. When many browsers start in the same minute, 429s push those checks out through the
  same backoff. Normal flushes keep working on the cached layout until the check succeeds.
- Google plans to bill quota overages later in 2026, so a large rollout should request the increase before it
  ships, not after the 429s start.

## Where this lives

| Piece | File |
| --- | --- |
| Cadence constants, backoff, status line | `src/assistant-sync/schedule.ts` |
| One flush, verification, recovery | `src/assistant-sync/sync-engine.ts` (`runFlush`) |
| Request builders, row positions | `src/assistant-sync/flush-plan.ts` |
| Dwell measurement in the tab | `src/content/dwell.ts` |
| Visit end, 5 second filter, excerpt | `src/assistant-sync/finalize.ts` |
| Alarms, open visits, token refresh | `src/background/service-worker.ts` |
| Google calls (offscreen only) | `src/assistant-sync/drive-api.ts` |
| Last 50 passes (counts and status, no URLs) | `src/assistant-sync/flush-log.ts`, key `cortex_assist_flush_log` |

Dwell is measured wherever capture runs, whether or not sync is on: the
tab asks the worker, which answers with the same gate as indexing. The
local library keeps reading time per page and visit
(`src/lib/reading-time.ts`). The live test is in `docs/live-sync-test.md`.
