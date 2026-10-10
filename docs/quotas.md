# Google API quotas Cortex depends on

Source: [Google Sheets API usage limits](https://developers.google.com/workspace/sheets/api/limits),
page last updated 2026-09-03 UTC, checked 2026-10-06.

## Sheets API

| Quota | Per minute per project | Per minute per user per project |
| --- | --- | --- |
| Read requests | 300 | 60 |
| Write requests | 300 | 60 |

What the page states, and what Cortex relies on:

- Quotas refill every minute. Going over returns `429: Too many requests`. Google asks for exponential backoff.
- A batch request, including all of its subrequests, counts as one request. Cortex sends every change of a
  flush in one `spreadsheets.batchUpdate`.
- All Sheets requests in a batch are applied atomically. If one subrequest is invalid, nothing is applied.
  Cortex treats a 4xx reply as "nothing was written".
- Google recommends a request payload of 2 MB or less. Cortex caps a flush at 1.5 MB (`FLUSH_BYTE_BUDGET`) and
  sends a larger backlog over several flushes, one minute apart.
- A request that runs longer than 180 seconds returns a timeout error.
- Within the per-minute quotas there is no daily limit.
- Pricing: standard use is free. Exceeding the quota limits "is planned to incur charges to your Google Cloud
  billing account later in 2026". Staying under quota is a cost issue, not only a reliability issue.
- Quota increases are requested from the Quotas and System Limits page in the Google Cloud console. Approval is
  not guaranteed, and large increases can take longer.

## Which Cortex calls count

| Call | Kind | When |
| --- | --- | --- |
| `spreadsheets.batchUpdate` | 1 write | Each flush that has something to send. A flush with nothing to send makes no request. |
| `spreadsheets.get` (sheet ids only) | 1 read | Verification, and once on Enable to find the new file's default tab |
| `spreadsheets.values:batchGet` (columns A:B) | 1 read | Verification only |
| `spreadsheets.batchUpdate` (setup) | 1 write | Enable when no file exists: tabs, headers, About, edit warnings |
| Drive `files.list` | Drive API, not Sheets | Enable with no stored ids: finds the existing sheet, then the existing folder |
| Drive `files.create` | Drive API, not Sheets | Enable when no file exists: the folder (only if none exists), then the spreadsheet |
| Drive `files.get` x2 | Drive API, not Sheets | Verification only |
| Drive `files.update` (media upload of HTML into a Google Doc) | Drive API, not Sheets | After a sheet write, once per changed day of Pages docs, at most 6 per pass. An unchanged day sends nothing. |
| Drive `files.create` (multipart, Google Doc) | Drive API, not Sheets | First upload of a day's Pages doc |
| Drive `files.create` (folder) and `files.list` | Drive API, not Sheets | Once, to make or find the Pages folder; `files.list` again only if a day doc's stored id is lost |
| Drive `files.update` (`trashed`) | Drive API, not Sheets | A day doc past retention, or restoring a trashed day doc or Pages folder |

Cortex never calls Sheets `spreadsheets.create`. With only the drive.file scope it returned
`403 PERMISSION_DENIED` ("The caller does not have permission") in live testing on 2026-10-08, so the
spreadsheet is created with Drive `files.create` (mimeType `application/vnd.google-apps.spreadsheet`,
parents the Cortex Memory folder).

Verification runs on Enable, on the first flush after a browser start when the last check is 24 hours old or
more, and after a flush whose outcome is unknown (a 5xx, a dropped connection, or a crash mid-flush).

Drive API quotas are separate and are not quoted here. Pages docs add Drive calls: while browsing, usually
one `files.update` per flush (today's doc), since only changed days are uploaded. Check the Drive API quota
page in the Google Cloud console before a large rollout.

`docs/sync.md` has the cadence and the per-user math.
