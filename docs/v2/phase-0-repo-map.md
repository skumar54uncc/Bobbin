# Cortex v2.1, Phase 0: repo map

Mapped 2026-10-08 against the working tree (uncommitted changes included).
Line numbers are approximate after later edits.

## 1. Capture pipeline

1. `src/content/main.ts` (content.js, all http/https pages): lifecycle only.
   Wraps `pushState` and `replaceState`, listens to `popstate`, polls the
   LinkedIn URL every 1s, re-indexes on `visibilitychange` (hidden) and on
   DOM mutations (at most once a minute, `mutation-throttle.ts`). No title
   observer.
2. It sends `CORTEX_INDEX_REQUEST`. The service worker runs the privacy gate
   `shouldSkipIndexing` (`service-worker.ts` ~1073): managed policy, indexing
   consent (`cortex_indexing_consent_v1`), pause, incognito, always-skip
   domains, allowlist, user blocklist, sensitive hostname heuristics.
3. Only after the gate passes, the worker injects `extract.js`
   (`src/content/extract-entry.ts`: Readability, tables, images, LinkedIn,
   PII filter) which sends `CORTEX_INDEX`. The worker re-gates, then
   `commitIndexPayload` writes documents, chunks, visitLog, and people.
4. YouTube: `youtube-capture.ts` and `youtube-bridge.ts` (MAIN world).
   Transcript after 30s of playback.
5. Assistant Sync capture is a second path: `src/assistant-sync/capture.ts`
   and `runtime.ts` turn the same events into sync rows.

Gaps against the spec:

| Spec item | Today |
| --- | --- |
| Dwell while visible, focused, not idle | Not measured. Sync `dwell_minutes` is always null (`runtime.ts` ~215). |
| Prerender and back forward cache | No handling. |
| Title changes in SPAs | Not observed. |
| UTM and AMP cleanup | Local library strips only the hash. Sync keeps an allowlist of query keys (`canonical-url.ts`). No AMP collapse. |
| Searches | Sync only: Google, Google Flights, Bing, DuckDuckGo, YouTube, LinkedIn. Amazon missing. |
| Password field page skip | Sync API exists (`denylist.ts`), live path passes `hasPasswordInput: false` (`runtime.ts` ~241). Local index never checks it. |
| Email and phone redaction | Sync only (`redact-sync.ts`). Local index redacts cards, SSN, keys, tokens (`pii-filter.ts`). |
| Instruction-like text flags | None. |
| `navigator.storage.persist`, `unlimitedStorage` | Neither. |
| Other device visits | `history` permission exists; `history-import.ts` uses `history.search` only, no `isLocal`. |
| Feeds as sessions | Feeds are labeled (`page-type.ts`) and re-indexed at most once a minute, never collapsed into a session. |

## 2. IndexedDB

- `cortex-db` (`src/db/schema.ts`, Dexie v6): `pages`, `visitLog`,
  `documents`, `chunks`, `conversations`, `messages`, `digestCache`,
  `people`, `collections`, `collectionItems`, `highlights`.
- `cortex-assistant-sync` (`src/assistant-sync/db.ts`, v3): `visits`,
  `content`, `searches`, `people`, `companies`, `synced` (`Tab:id` keys),
  `pending` (outbox), `state` (engine state).
- Sync preferences (folder id, file id, backup file id, retention, archives)
  live in `chrome.storage.local` (`preference-keys.ts`).

## 3. Assistant Sync

**Auth.** Scope `drive.file` only. Interactive `getAuthToken` only from the
Enable click (`assistant-sync-panel.ts` ~87). Alarm and Sync now use silent
tokens (`service-worker.ts` ~381). 401 is not retried, and nothing calls
`removeCachedAuthToken`, so a stale token stays until the user enables again.

**Writer.** All Google calls run in the offscreen document (`drive-api.ts`).
One tick (`runSyncTick`, `sync-engine.ts` ~446) makes roughly:

| Step | Requests |
| --- | --- |
| `inspectMemory` | 2 Drive GETs |
| `ensureHeaders` | 6 `values` reads (+ PUT if empty) |
| `reconcileSheet` | 6 `values` reads |
| `purgeRetention` | 6 reads + up to 6 `batchUpdate` deletes, plus archive creation |
| `flushPending` | 1 `values:append` per tab per 200 rows |
| `upsertDaily` | 1 read + 1 PUT or append per date |
| `rewriteAbout` | 1 PUT |
| `upsertDriveJsonBackup` | 1 Drive upload |

That is about 20 reads and 6 to 10 writes per tick, every 30 seconds.

**Schedule.** Alarm `cortex-assistant-sync` every 0.5 min, plus
`cortex-assistant-sync-soon` 0.5 min after a LinkedIn capture (`db.ts` ~68).
Backoff only on 429 and 5xx: 1s doubling to 60s with jitter, stop after 10
failures until the next alarm. No Sync now rate limit, no flush jitter.

**Idempotency.** Rows carry ids, the `synced` table skips known ids, and
`reconcileSheet` reads column A each tick to recover from a crash after
append.

**Layout** (`sheet.ts`): About, Visits, Content, Searches, People,
Companies, Daily. About is rebuilt each tick and ends with
`schema_version: 3`.

**Missing or trashed.** `inspectMemory` returns absent, ready, missing, or
trashed. The timer never creates a file; only Enable does.

**Status UI.** Settings shows On/Off, Last sync, Last error, backfill
state. The overlay mascot shows a phase (wave, lost, syncing, connected).
No relative status line exists yet.

## 4. Connect AI Agents tab

`src/content/agents-view.ts` + `src/shared/agent-prompts.ts`. Cards:
Claude, ChatGPT, Gemini, **Cursor**, Another assistant. No external links;
one button opens Assistant Sync settings. Copy prompt confirms "Copied.".
Prompts start "You are {name}." and forbid the JSON backup and monthly
archives. `tests/agent-prompts.test.ts` asserts the Cursor card and the
backup/archive wording; both change in Phase 4.

## 5. Options, popup, onboarding, side panel

- Options sections: Library, Appearance, Capture, Intelligence, Assistant
  Sync, Privacy and data, Backup (Markdown export, JSON download, restore),
  About (version, credit, no policy links, no feedback link).
- Popup: header, tagline, status, Open search / Assistant Sync / Privacy and
  settings, stats, shortcut hint. No footer message, no menu.
- Onboarding: consent card "Before Cortex indexes anything" with Start
  indexing / Continue without indexing. Capture is off until consent. Older
  installs are grandfathered (`service-worker.ts` ~1326).
- Side panel: `search-shell.html`, the same overlay UI in shell mode.
- Header subtitle already switches between the two v2 strings
  (`overlay.ts` ~361 and ~394).

## 6. Mascot

`assets/mascot/felt-{wave,idle,searching,found,sleepy,syncing,connected,lost,portrait}.webp`
(+ @256) and `felt-head.webp`; `src/content/mascot.ts`, `src/styles/mascot.css`.

## 7. Tests and eval

- 114 Vitest files, 977 tests. Sync: `assistant-sync.test.ts`,
  `assistant-sync-drive.test.ts`, `assistant-sync-engine.test.ts`,
  `assistant-sync-options.test.ts`.
- Eval harness `eval/` (nDCG, Recall, MRR on a frozen corpus):
  `npm run eval:seed`, `npm run eval`, `npm run eval:test`.
- No zod, no Puppeteer, no end to end tests. Validation is hand written per
  message.
- Bundle caps (`scripts/check-bundle-budget.mjs`): service-worker.js has
  about 250 bytes free.

## 8. Manifest

Permissions: tabs, offscreen, alarms, scripting, storage, history,
notifications, sidePanel, contextMenus, identity. Hosts: all http/https.
OAuth: `drive.file`. `incognito: not_allowed`. CSP:
`script-src 'self' 'wasm-unsafe-eval'`. Web accessible: icon, fonts,
mascot, mascot.css.

## 9. Mentions to change

**Sync timing**
- `src/options/options.html` ~431: "updates that sheet about every 30 seconds"
- `src/shared/agent-prompts.ts` ~20: "refreshes it about every 30 seconds"
- `src/assistant-sync/sync-engine.ts` ~56: "on the next 30 second check"
- `src/assistant-sync/db.ts` ~69-73 (comments and the 0.5 min constants)
- `docs/assistant-sync/phase-3.md`, `phase-4.md`: "15 minutes" (stale)
- `dev/phase4/panel.html`, `dev/phase5/dark.html` (previews only)
- Not sync: YouTube "at least 30 seconds" (`options.html` ~225, store doc)

**JSON backup and archives in Drive**
- `drive-api.ts` ~11 `Cortex Memory Backup.json`, `upsertJsonFile`
- `sync-engine.ts` ~290-311 archives in `purgeRetention`, ~485-594 `upsertDriveJsonBackup`, ~489 warning copy
- `sheet.ts` ~111 About line, ~338-361 `archiveTitle`, `archiveAboutRows`, `buildArchiveWorkbook`
- `options.html` ~472-488 Monthly archives toggle
- `agent-prompts.ts` every prompt
- Tests: `agent-prompts.test.ts` ~29, `assistant-sync-drive.test.ts` ~113, `assistant-sync-engine.test.ts` ~243, `assistant-sync-options.test.ts` ~35
- Docs: `docs/assistant-sync/phase-2.md`, `phase-4.md`, `docs/enterprise-audit/*`
- Keep: local "Download backup (JSON)" in Settings, Backup (`options.html` ~709)

**"on this device"**
`overlay.ts` ~361/394, `popup.html` 44/46/87, `onboarding.html` 28/38/55,
`options.html` 65/213/331/529/704, `empty-copy.ts` 7, `ux-local.ts` 187,
`locales/en.json` 3, `smalltalk.ts` 15, `onboarding.ts` 69, `options.ts` 950,
`docs/data-deletion.html` 42, `docs/store-listing.md` 61. All true today.

## 10. Policy check

`PRIVACY_POLICY.md` note at line 60: the code never reads the Google account
email. The only scope is `drive.file`, and nothing calls
`getProfileUserInfo` or a userinfo endpoint. The sentence can stay as is.
