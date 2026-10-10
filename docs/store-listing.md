# Chrome Web Store listing (Bobbin 2.0.0)

Hosted pages, after GitHub Pages deploys `docs/` from `main`:

- Homepage: https://skumar54uncc.github.io/Bobbin/
- Privacy policy: https://skumar54uncc.github.io/Bobbin/privacy
- Terms of Use: https://skumar54uncc.github.io/Bobbin/terms
- Data deletion: https://skumar54uncc.github.io/Bobbin/data-deletion.html
- Listing: https://chromewebstore.google.com/detail/cortex-%E2%80%94-local-second-bra/happibddmmagkgneicjkndapcpmhdbfn (same item after the rename)

## Single purpose

Bobbin is a personal browsing memory: it remembers the pages you read so you can search them, and can optionally share that memory with your own AI assistant through your Google Drive.

## Category

Productivity → Workflow and planning

## Title

Bobbin: Browsing Memory for AI

## Tagline

The missing memory for your AI.

## Short description (124 characters)

The missing memory for your AI. Bobbin privately captures what you browse and read, so your AI assistant knows it too. Free.

## Full description

Bobbin is a Chrome extension that remembers the pages you read, after you press I agree on the welcome page. You can search that library later or ask questions in ordinary language. Indexing, search, and the language model run on your computer. There is no Bobbin server, no account, and no tracking. The extension is free. There is no paid plan.

It keeps the main text of articles you read, captions from YouTube videos you watch (with a link to the moment), text from PDFs you open (with a link to the page), tables, image captions, highlights you add, and LinkedIn profiles you view. Sites such as banking, health, and email are skipped. Incognito windows are never indexed. You can pause indexing, block a site, or forget a page whenever you want.

Search is available from the Bobbin panel, the side panel, or the address bar (type cx, then a space). Ask returns an answer with citations you can open. There is also a daily or weekly digest of what you read. Notes can be exported as Markdown. You can back up the library and restore it.

If you want an assistant you already use to see the same memory, turn on Assistant Sync. That takes a second I agree. Bobbin then writes a folder named Bobbin Memory in your own Google Drive: one spreadsheet and one Google Doc per day. The Google permission is drive.file, which means files Bobbin creates, not the rest of your Drive. Connect walks you through linking an assistant that can read Drive. Ask any assistant finds pages on this device and puts a short context packet in the chat box. You press send.

Cloud Chat stays off unless you add your own API key. If you turn it on, only short retrieved snippets are sent, not whole pages, PDFs, or images. The privacy policy and Terms of Use are in Settings and on the homepage.

## Data disclosures

What leaves the device, and only with Assistant Sync on, to the user's own Google Drive:

- Browsing activity: page titles, addresses, times, time on page, scroll depth, topics, and searches, in the Bobbin Memory spreadsheet.
- Website content: the main text of pages the user read (20 seconds on screen or scrolled 30%, up to 4,000 characters per page), in one Google Doc per day in Bobbin Memory/Pages.
- Personal information shown on LinkedIn profiles the user opens: name, headline, company, location, current role, About, Experience (title, company, dates, location, first 300 characters of the description), Education (school, degree, field, years), and up to 10 skills. Never photos, contact info, or messages.
- LinkedIn feed post text (author name, up to 1,500 characters, time seen) only when the user turns on "Save text of LinkedIn posts I scroll past". Off by default.

Nothing goes to the developer or any server. Incognito windows, the block list, pages with a password field, and sensitive sites are never captured. Email addresses, phone numbers, long digit runs, and invisible characters are removed from all synced text.

## Permission justifications

| Permission | Justification |
|------------|----------------|
| `host_permissions` `http://*/*`, `https://*/*` | Bobbin indexes the pages you read on any site (single purpose: personal browsing memory). Content scripts read page text on sites you visit, after in-product consent. Sensitive sites, Incognito, login pages, and your block list are skipped. Host access is not used to call Google Drive; Drive uses the OAuth token from `identity` with scope `drive.file` only. |
| `tabs` | Know which tab you opened Bobbin on (in-page panel on web pages, side panel on Chrome pages), skip Incognito, and detect PDF tabs. |
| `scripting` | Inject the Bobbin panel when you open it, inject the page reader only after privacy checks pass, and insert Ask any assistant text into the focused chat box on a click. |
| `offscreen` | Run the on-device embedding model, search, PDF reading, and Assistant Sync HTTPS in a hidden extension page. Service workers cannot keep long WebAssembly jobs alive. Also copies text with the CLIPBOARD reason when a host page blocks the Clipboard API in the in-page panel. |
| `storage` | Save settings on this device. Also reads enterprise policy from managed storage. |
| `unlimitedStorage` | The local library (page text, embeddings, visits) can exceed Chrome's default 10 MB extension quota. All of it stays in IndexedDB on this device. |
| `alarms` | Daily retention cleanup, storage housekeeping, re-chunking older pages, and Assistant Sync polling only while sync is on. |
| `history` | Optional: after you press I agree on the welcome page (or Scan history in Settings), build an initial index from recent history. Not continuous watching. |
| `notifications` | One notification when the optional consented history import starts and finishes. |
| `sidePanel` | Show Bobbin on pages where the in-page panel cannot run, such as the New Tab page, and show guided setup beside the assistant tab. |
| `contextMenus` | Save to Bobbin for selected text, and add a page to a collection. Removed when you turn those features off. |
| `omnibox` keyword `cx` | Search the local library from the address bar. Suggestions come only from your library. |
| `identity` | Google sign-in for optional Assistant Sync. Interactive `getAuthToken` runs only when you press Enable / I agree. Later Sync now and the alarm use a silent token. OAuth scope is `drive.file` only. |

No remote code. All JavaScript and WebAssembly ship in the package. Content Security Policy: `script-src 'self' 'wasm-unsafe-eval'`.

## Privacy practices answers

**Single purpose:** Bobbin is a personal browsing memory: it remembers the pages you read so you can search them, and can optionally share that memory with your own AI assistant through your Google Drive.

**Data types collected** (tick these three only):

| Type | Tick | Why |
|------|------|-----|
| Web history | yes | URLs, titles, and visit times of pages you read, after consent. |
| Website content | yes | Page text, YouTube captions, table rows, PDF text, image alt text, highlights, and (if you turn it on) LinkedIn feed posts. |
| Personally identifiable information | yes | Name, headline, company, location, and role history of LinkedIn profiles you open. Off in settings if you do not want it. |

Leave unticked: health, financial, authentication, personal communications, location, user activity (no clicks, keystrokes, or analytics), website content of other users.

**Certifications:**
- Data is not sold to third parties, and is not transferred for purposes unrelated to the single purpose.
- Data is not used or transferred to determine creditworthiness or for lending.
- Use of the data is limited to the single purpose above.

**Remote code:** no.

**Data transmission:** nothing is sent anywhere by default. Two optional paths leave the device: (1) Cloud Chat, if you add your own Gemini API key: the question and retrieved snippets go to Google's Gemini API. (2) Assistant Sync, if you press I agree: a copy of memory is written to your own Google Drive with `drive.file` only.

**Limited Use:** Bobbin's use of information received from Google APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements. Bobbin's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.

**Privacy policy URL:** https://skumar54uncc.github.io/Bobbin/privacy
