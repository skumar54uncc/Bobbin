# v2 Phase 5 notes: Attach to chat

Spec: "Ask any assistant" in the panel; see [../attach-to-chat.md](../attach-to-chat.md).

## Built

- `src/attach/packet.ts`: templates, header, item lines, page text lines, caps.
- `src/attach/packet-items.ts`: builds items from local search, people, Assistant Sync searches
  and Pages doc text (page text read only when "Include page text" is on).
- `src/attach/insert-field.ts`: self-contained insert function run by `chrome.scripting`.
- `src/attach/attach-view.ts`: the section, mounted in `connect-frame.ts` only.
- Service worker: `CORTEX_PACKET_ITEMS` and `CORTEX_PACKET_INSERT`, both only from the Connect
  frame. The in-page panel remembers the focused box when it opens (`__cortexLastField`).

## Fix found while testing

`isConnectFrameSender` compared against `chrome.runtime.getURL("connect-frame.html")`. Because
the frame is a `use_dynamic_url` resource, the service worker's `getURL` returns the dynamic id
while the frame reports the extension id, so every frame-gated message was refused. That also
blocked the Phase 4 Enable button in the panel. The check now accepts both URLs; a unit test
and the Insert e2e cover it.

## Spec notes

- `activeTab` not added: host permissions already cover scripting, and side panel clicks do not
  grant it.
- Insert is best effort per editor; Copy always works.

## Tests

- `tests/attach-packet.test.ts`, `tests/attach-view.test.ts`, `tests/attach-insert.test.ts`.
- `e2e/guided-setup.spec.ts`: Insert into a SYNTHETIC chat page's textarea and contenteditable,
  zero submits, and the no-box reply.
- Screenshot (SYNTHETIC PREVIEW): `dev/v2-phase5/attach.png`.

## Works with Assistant Sync off

Searches and page text are kept in a local record whenever capture is on, with sync on or off
(`src/assistant-sync/local-memory.ts`, its own IndexedDB database `cortex-local-memory`). Same denylist,
redaction and instruction flagging as sync. The sync engine never opens that database, so turning
sync on later uploads none of what was browsed while it was off. Forget and Delete all cover
them. The privacy policy's on-device table gained one row naming them.
Its code is the lazy `assistant-sync-local.js` chunk (cap 27 KB), so `assistant-sync.js` keeps 8 KB free.
Tests: `tests/local-memory.test.ts`, `e2e/attach-sync-off.spec.ts`.
