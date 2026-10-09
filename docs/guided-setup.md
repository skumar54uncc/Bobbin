# Guided setup: Connect your AI

How the Connect AI Agents tab, the setup side panel, and the on-page pointer work, and how to update them. Everything ships in the extension package. There is no remote config: a fix reaches users only in a new release.

## Where it shows

| Surface | File | Notes |
| --- | --- | --- |
| Cortex panel, Connect AI Agents tab | `connect-frame.html` (`src/guide/connect-frame.ts`) | An extension frame inside the panel's closed shadow root, so Start setup runs in an extension click. Listed in `web_accessible_resources` with `use_dynamic_url`. Offers no Enable button: a web page hosts the frame, so Enable stays in Settings. |
| Settings, Connect your AI | `src/options/connect-section.ts` | Same view. Its Enable runs the Assistant Sync Enable button, so sign-in and the old-files question stay in one place. |
| Setup side panel | `guide-panel.html` (`src/guide/guide-panel.ts`) | Set for the assistant's tab only. Has its own Enable (interactive sign-in from that click). |
| On-page pointer | `guide-pointer.js` (`src/guide/guide-pointer.ts`) | Injected into the guide's tab only, on the assistant's own site. |

The view itself is `src/guide/connect-view.ts`: status, the assistant cards, the chosen assistant's step titles, Start setup, and Troubleshooting. Styles: `src/guide/guide.css`.

## Start setup

1. The click calls `startGuide` (`src/guide/start.ts`).
2. It opens the first step's page in a new tab, or a plain new tab when there is none (Muse, Other).
3. It sends `CORTEX_GUIDE_PANEL` to the service worker, which sets `guide-panel.html` as that tab's side panel. The worker is the only writer because its own handlers otherwise point new tabs on restricted pages (the new tab page, `about:blank`) at search.
4. It calls `chrome.sidePanel.open({ tabId })`. Chrome allows this only during a user click. If Chrome refuses, the tab stays open and the view says how to open the panel from the toolbar.

Guide state lives in `chrome.storage.session` under `cortex_guide`, keyed `tab:<id>`, newest five kept. It holds the assistant, the tab, the done step ids, and the Yes/No answer.

## The side panel

- Progress dots and "Step N of M" at the top.
- An Enable block, only while Assistant Sync is off.
- Done steps as one line each, with a checkmark.
- The current step only: its title, one sentence, one primary button, a small "I did this" link, and a status line. The test step has Yes and No instead of "I did this"; No opens Troubleshooting.
- Troubleshooting, collapsed, at the bottom.

The primary button does the step's action:

- `open`: navigates the guide's own tab to the step's page. On that page already, it only points again.
- `copy`: copies the instruction (`"instruction"`) or the test question (`"test"`) first. On the step's own page the button reads "Copy instruction" or "Copy the test question". If the clipboard fails, the text appears for the user to select.
- Neither: the button reads "Done" and completes the step.

The panel never types into or clicks anything on the assistant's site.

## Step order and advancing

Steps go strictly in order. `currentStep` is the first step not done, and `completeStep` accepts only that step. The tab's address never completes or skips a step, and a done signal for any other step is ignored.

When a step completes (by "I did this", by the button, or by the pointer), the panel sends the tab to the next step's page and points at its target. One exception: when an instruction box completes itself, the tab stays put so an unsaved paste is never lost, and the outline says "Now click Save".

## Assistant config

`src/config/assistants.ts` has one entry per assistant, every field explicit. Links are `home`, `connect`, `instructions`, `extra`, and `newChat`. Each has:

- `url`: the page a step's button opens, or `null`.
- `path`: the words shown ("Find it at: ...") when the link cannot be opened.
- `verified`: `"live"` (the owner saw it work), `"docs"` (official documentation), or `"unverified"`.

An `"unverified"` link is never opened. Only `https://` URLs open. Each step has `id`, `title`, `text` (one sentence), `button`, `open` (a link key or `null`), and `copy`. At most four steps; the last is always `test`.

Never add a URL without a source. When a site changes:

1. Edit the entry. Set `verified` to how you confirmed it.
2. Update `tests/assistants-config.test.ts`, which lists every page each step opens and every flag.
3. Run the checks below.

The standing instruction comes from `standingInstructionFor`. Muse gets it as a chat message starting `Remember this permanently: `. The test question comes from `testQuestionFor`; Gemini's starts with `@Google Drive`.

## The on-page pointer

1. It is on by default. When the guide's tab is on the assistant's site and the current step has a target, the panel injects `guide-pointer.js` with `chrome.scripting.executeScript` and sends the step. It does this when the panel opens, after each page load in that tab, and after a step completes. Cortex already holds host access for capture, so nothing extra is requested.
2. The script checks the page origin, then looks for the step's control for 3 seconds.
   - Found with confidence: a pulsing outline and a short label beside it, both `pointer-events: none`, so clicks reach the page.
   - Not found, or more than one match: nothing at all on the page. The panel's words are enough. A wrong outline is worse than none.
3. After the first 3 seconds it keeps checking about once a second, for about 3 minutes, while the tab is visible. A menu or dialog that opens later then gets its outline.
4. It never clicks or types. It reads the page only to find the target and to read the target's own state.

### Targets: actionable elements only

All targets live in `src/guide/pointer-targets.ts`, keyed by assistant and step id. Each step lists targets in order, the step's own control first, then the way there:

```ts
gemini: {
  connect: {
    targets: [
      { anchor: "Google Workspace", kind: "toggle", label: "Turn this on" },
      { anchor: "Connected apps", kind: "item", label: "Click Connected apps" },
      { anchor: null, kind: "button", controls: ["Settings and help"], label: "Click Settings and help" },
    ],
    done: "toggle-on",
  },
},
```

- `anchor` is the name next to the control (matched whole against `aria-label` or text, case and spacing ignored). `kind` is `button`, `item`, `textbox`, or `toggle`.
- For a `button`, `controls` are the control's own words. "Connect", "+", "Add", or "Connect Google Drive" all match the Google Drive row.
- From the anchor, `src/guide/pointer-find.ts` takes the anchor itself if it is the right kind of control, or a text box tied by `label for`. Otherwise it climbs to the smallest box around the anchor that holds any control (its row or card, at most four levels) and takes the one matching control there. It never looks further, so another service's button is never chosen.
- A title, a label, or plain text is never outlined. Disabled and hidden controls are skipped.
- `label` is the words on the page. `{paste}` becomes Cmd+V on a Mac and Ctrl+V elsewhere.
- Use only names you have seen on the live site. A step with no entry gets no outline.

### Steps that complete themselves

`done` reads only the target element:

- `"connected"`: the Connect control now says Connected or Disconnect (or is pressed). Claude and Grok connect.
- `"contains-cortex"`: the instruction box contains "Cortex Memory". Claude instructions.
- `"toggle-on"`: the switch is checked. ChatGPT Connector search, Gemini Google Workspace.

The check applies only to the step's own control (the first target). The pointer then sends `CORTEX_GUIDE_DONE`; the panel accepts it only from its own tab and only for the current step. "I did this" always stays as the manual way.

### Fixtures

Each assistant with targets has a hand-written fixture in `tests/fixtures/guide/<assistant>.html`. Fixtures start with a `SYNTHETIC` comment; they are not copies of the sites. Mark the control the user acts on with `data-expect="<step id>"`. `tests/guide-pointer.test.ts` checks that every step outlines exactly that control, and that no target ever resolves to a non-actionable element.

To turn a broken pointer off, delete its entry and ship a release. The step then shows in the panel only.

## Checks

```sh
npx tsc --noEmit -p .
npx vitest run tests/assistants-config.test.ts tests/guide-*.test.ts tests/connect-view.test.ts
npm run build && npx playwright test e2e/guided-setup.spec.ts
```

The Playwright spec checks for no sideways scroll at 320 to 920 px with accordions open and closed. It runs Start setup from a frame in a web page and confirms the side panel opens. It checks that the pointer outlines the Connect button on the assistant's tab only, that clicks still reach it, that "I did this" opens the next page, and that pasting the instruction completes the step without leaving the page.
