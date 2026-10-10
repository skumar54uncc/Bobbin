# User-facing error copy

Exact sentences shown to people. Internal codes (`nano_unavailable`, `foreign_sender`, `already_running`, HTTP 401/429) stay in logs and message payloads, never in the UI.

## Search, Ask, and Digest (`src/lib/errors.ts`)

| State | Message | Next step |
| --- | --- | --- |
| On-device AI missing | On-device AI is not available in this browser profile. | Enable Cloud Chat in Bobbin settings, or use a Chrome build with built-in AI. |
| Cloud Chat off | Cloud Chat is not set up. | Open Bobbin settings and add your Gemini API key from Google AI Studio. |
| Bad Gemini key | The Gemini API key was rejected. | Check the key in settings or create a new one in Google AI Studio. |
| Gemini rate limit | Gemini rate limit reached. | Wait a few minutes and try again. |
| Gemini quota | Gemini quota exceeded for this key. | Check usage in Google AI Studio or switch keys. |
| Question too long | That question is too long. | Shorten your message and try again. |
| Empty library | Nothing in your library matched. | Browse some pages, then ask again. |
| Empty time range | No indexed visits in that time range. | Try a wider time range or different keywords. |
| Embedding failed | Semantic indexing failed for part of your library. | Retry later; keyword search may still work. |
| Storage full | Bobbin storage limit reached. | Clear old data from Bobbin settings. |
| Too many requests | Too many requests. Slow down for a minute. | Wait briefly, then try again. |
| Bad link | That link could not be opened. | |
| Foreign sender | Request rejected. | |
| Search too long | That search is too long. | Shorten your query and try again. |
| Page too large | This page is too large to index. | |
| Tab mismatch | Indexing was rejected for this tab. | |

Chat overlay fallbacks when a payload has no `message`:

- Could not start chat.
- No response from Bobbin. Next step: Try again. If it keeps happening, reload the extension.
- Could not reach the extension background.
- Search failed.
- Digest failed.

## Assistant Sync

Status line (`src/assistant-sync/schedule.ts`):

- Assistant Sync is off.
- Sync paused: reconnect Google Drive.
- Adding your recent history to the sheet.
- Waiting to sync N new page(s). Next try in M min.
- Waiting to sync N new page(s). Next try in M min. Google asked Bobbin to slow down, so it syncs every 15 minutes until {time}.
- Google asked Bobbin to slow down. Syncing about every 15 minutes until {time}.
- Waiting to sync N new page(s). Next sync in about M min.
- Synced {ago}. Updates about every 5 minutes while you browse, and at least every 15 minutes.
- Not synced yet. Updates about every 5 minutes while you browse, and at least every 15 minutes.

Drive and enable (`src/assistant-sync/sync-engine.ts`, `runtime.ts`):

- The Bobbin Memory file is missing from Drive. Sync will stay paused until you turn it on again.
- The Bobbin Memory file is in the trash. Sync will stay paused until you turn it on again.
- Bobbin Memory has not been created in Drive yet. Turn sync on to create it.
- Google did not accept the last update. Bobbin will check the sheet and try again.
- Google did not allow Bobbin to create or edit the sheet.
- Google did not allow Bobbin to create or edit the sheet. Google said: {Google's message}
- Google did not accept the sign-in. Press Enable to reconnect Google Drive.
- Google sent a reply Bobbin could not read. Bobbin will try again.
- Bobbin could not reach Google. Reload the extension and press Enable again.
- Sync did not start.
- Sign in to Google is needed before Bobbin can sync.
- Turn Assistant Sync on before syncing.
- This action is only available from Bobbin settings.

## Connect AI Agents and Ask any assistant

- Copied
- Copied. Paste it into any chat.
- Looking in your memory.
- Bobbin could not search right now. Try again.
- Everything was removed. Pick a template or ask again.
- Inserted. Review it in the chat box, then send.
- Bobbin could not find a chat box. Click into the message box on the page, then try again, or use Copy.
- The chat box did not accept the text. Use Copy and paste it instead.
- Bobbin cannot write on this page. Use Copy and paste it instead.
- Setup did not start.
- Pick an assistant first.
- Bobbin could not open a tab.

Manual copy fallback (clipboard blocked and offscreen copy failed): Press Cmd+C to copy / Press Ctrl+C to copy, with a selected read-only box.

## Indexing consent and onboarding

- Indexing is off until you agree on the welcome page.
- Could not start indexing. Try again from Settings.
- Could not allow indexing.
- Indexing is on. Bobbin is scanning recent history on this device when needed.
- Indexing is allowed. New pages you read can be saved on this device.
- Starting indexing…

Popup indexing line: Off (no consent), Paused (consented, paused), Active (consented, not paused).

## Settings, backup, forget, history

- Could not delete data.
- Could not save. Try again.
- Could not load models. Check the key.
- Could not export. Try again.
- Could not restore. Try again.
- Could not forget that data.
- Enter a site like example.com.
- A scan is already running.
- Could not start scan.
- Your administrator has turned off indexing, so backups cannot be restored.
- Could not finish. Try again.
- This action is only available from Bobbin.
- This file could not be read as a Bobbin backup.
- This file is not a Bobbin backup (it is not valid JSON).
- Confirm the restore first.
- Pick a From date on or before the To date.
