# v2 Phase 8 notes: reliability and tests

Spec: unit coverage for canonicalization, denylist, redaction, local time, sheet rows, About text, batchUpdate, backoff, consent; mocked Drive integration; e2e; evals; error copy; capture budget.

## Built

- Copy in a host-framed connect-frame never calls `writeText`. The click handler runs `document.execCommand("copy")` synchronously, then the service worker / offscreen document if that returns false. Side panel, options, and other top-level extension pages still use writeText first. No `clipboardWrite` permission. `e2e/copy-policy.spec.ts` asserts zero Permissions-policy console logs and real clipboard content.
- Homepage Install button points at the existing Chrome Web Store item `happibddmmagkgneicjkndapcpmhdbfn` (same listing after the rename).
- Muse plan note stays "Check your plan" until confirmed.
- `docs/errors.md` lists every user-facing error sentence. `displayError` maps known codes and hides unknown snake_case codes.
- `docs/assistant-evals.md` is the 16-question assistant smoke test for manual runs. Retrieval regression stays `npm run eval -- --ci`.

## Tests

- Unit: `tests/clipboard.test.ts`, `tests/local-time-dst.test.ts`, `tests/sheet-rows.test.ts`, `tests/consent-state.test.ts`, `tests/display-error.test.ts`, `tests/capture-budget.test.ts`, `tests/errors-doc.test.ts`. Existing assistant-sync engine, Drive, merge, schedule, denylist, and redaction suites cover enable, backfill, 429, 401, missing sheet, retention, and archive trash after confirmation.
- E2e: `e2e/copy-policy.spec.ts`, `e2e/phase8-reliability.spec.ts` (consent, LinkedIn fixture, SPA, IndexedDB, popup footer, Connect copy/links, Attach insert without submit). Playwright, not Puppeteer; this repo's harness.
- Performance: dwell ticks in the content script stay well under 5 ms per page. Flush Google work runs in the offscreen document, not the service worker. A two-hour memory soak is a manual check before release, not a CI job.

## Open

- Muse plan note: keep "Check your plan" until confirmed.
- Two-hour browsing memory soak: run on a real profile before the store upload.
