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

Productivity

## Title

Bobbin: Browsing Memory for AI

## Tagline

The missing memory for your AI.

## Short description (108 characters)

The missing memory for your AI. Bobbin remembers pages you read for Claude, ChatGPT, Gemini, and Grok. Free.

## Full description

The missing memory for your AI.

Read it once. Ask your AI anytime.

Bobbin keeps the thread of everything you read. It is a private Chrome extension that indexes pages you read, after you press I agree on the welcome page, and lets you search them or ask questions in plain language. Indexing, search, and the language model run on your device. There is no Bobbin server, no account, and no tracking. Bobbin is free forever.

Optional Assistant Sync copies that memory into a folder named Bobbin Memory in your own Google Drive, only after a second I agree: a spreadsheet index plus one Google Doc per day with the text of pages you read. The Google permission is drive.file (files Bobbin creates, not your whole Drive). Connect setup walks you through Claude, ChatGPT, Gemini, Grok, Muse, Perplexity, or any other assistant that can read Drive. Ask any assistant finds pages in your local memory and puts a context packet in the chat box; you press send. Optional Cloud Chat uses your own Gemini API key and sends only short text snippets, never whole pages, PDFs, or images.

What Bobbin remembers:
- Articles and pages you read
- YouTube videos you watch (from their captions), with links to the exact moment
- PDFs you open, with links to the right page
- Data tables, row by row
- Image captions and alt text
- Your highlights and notes
- LinkedIn profiles you viewed

What you can do:
- Search your library from the Bobbin panel, the side panel, or the address bar (type cx and a space)
- Ask questions and get answers with citations you can click
- Group pages into collections and search inside one
- Get a daily or weekly digest of what you read
- Export your notes as Markdown, or back up and restore your library
- Connect your AI assistant through your own Google Drive
- Paste a context packet into any chat with Ask any assistant

Privacy by design:
- Index storage stays on your computer unless you enable Assistant Sync or Cloud Chat
- You must agree in the product UI before indexing or history import begins
- Sensitive sites like banking, health, and email are skipped automatically
- Incognito windows are never indexed
- Pause indexing, block any site, or forget a site or the last hour at any time
- Choose how long pages are kept
- Privacy policy and Terms of Use open inside the extension and on the homepage

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
