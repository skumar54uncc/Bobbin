# Guided setup: Connect your AI

How the Connect AI Agents tab, the setup side panel, and the optional on-page pointer work, and how to update them. Everything ships in the extension package. There is no remote config: a fix reaches users only in a new release.

## Where it shows

| Surface | File | Notes |
| --- | --- | --- |
| Cortex panel, Connect AI Agents tab | `connect-frame.html` (`src/guide/connect-frame.ts`) | An extension frame inside the panel's closed shadow root, so Start setup runs in an extension click. Listed in `web_accessible_resources` with `use_dynamic_url`. Offers no Enable button: a web page hosts the frame, so Enable stays in Settings. |
| Settings, Connect your AI | `src/options/connect-section.ts` | Same view. Its Enable runs the Assistant Sync Enable button, so sign-in and the old-files question stay in one place. |
| Setup side panel | `guide-panel.html` (`src/guide/guide-panel.ts`) | Set for the assistant's tab only. Has its own Enable (interactive sign-in from that click). |
| On-page pointer | `guide-pointer.js` (`src/guide/guide-pointer.ts`) | Injected into the guide's tab only, after the user turns on Show me on the page. |

The view itself is `src/guide/connect-view.ts`. Styles: `src/guide/guide.css`.

## Start setup

1. The click calls `startGuide` (`src/guide/start.ts`).
2. It opens the assistant's first confirmed link in a new tab, or a plain new tab when there is none (Muse, Other).
3. It sends `CORTEX_GUIDE_PANEL` to the service worker, which sets `guide-panel.html` as that tab's side panel. The worker is the only writer because its own handlers otherwise point new tabs on restricted pages (the new tab page, `about:blank`) at search.
4. It calls `chrome.sidePanel.open({ tabId })`. Chrome allows this only during a user click. If Chrome refuses, the tab stays open and the view says how to open the panel from the toolbar.

Guide state lives in `chrome.storage.session` under `cortex_guide`, keyed `tab:<id>`, newest five kept.

The panel never types into or clicks anything on the assistant's site. Copy puts the instruction on the clipboard; Open navigates the guide's own tab.

## Auto-advance

`stepForUrl` in `src/config/assistants.ts` highlights the step whose confirmed link the tab is on. It is only a highlight: every step can be ticked by hand, and nothing waits for it.

## Assistant config

`src/config/assistants.ts` has one entry per assistant, every field explicit. Each link has:

- `url`: opened by an Open button, or `null`.
- `path`: the words shown when there is no button.
- `verified`: `"live"` (the owner saw it work), `"docs"` (official documentation), or `"unverified"`.

An `"unverified"` link never gets a button, and never drives auto-advance. Only `https://` URLs open.

Never add a URL without a source. When a site changes:

1. Edit the entry. Set `verified` to how you confirmed it.
2. Update `tests/assistants-config.test.ts`, which lists every URL and flag.
3. Run the checks below.

The standing instruction comes from `standingInstructionFor`. Muse gets it as a chat message starting `Remember this permanently: `.

## Show me on the page

1. The toggle calls `chrome.permissions.request` for that one assistant's origin, at that moment. The origins are listed in `optional_host_permissions` and are never required.
2. If Chrome grants it and the guide's tab is on that assistant's site, the panel injects `guide-pointer.js` into that tab with `chrome.scripting.executeScript` and sends the step to show.
3. The script checks the page origin again, then looks for the step's target for up to 3 seconds.
   - When found, it draws a pulsing outline that lets clicks through (`pointer-events: none`).
   - When not found, or when more than one place matches, it shows the card with words only. A wrong arrow is worse than none.
4. The card can be closed. It reads the page only to find the target.

Note: Cortex already holds `http://*/*` and `https://*/*` as required host permissions for capture, so Chrome grants these requests without a prompt today. The request stays in place so the pointer keeps working if the broad access is ever narrowed.

### Updating pointer targets

All targets live in `src/guide/pointer-targets.ts`, keyed by assistant and step id:

```ts
claude: {
  connect: named("Google Drive"),
  instructions: named("Instructions for Claude"),
},
```

- `names` are tried in order, the most exact first. Each is matched whole (case and spacing ignored) against `aria-label`, then visible text.
- `selectors` are a last resort. Prefer names: sites rename classes far more often than labels.
- Use only labels you have seen on the live site. A step with no entry shows words only.

Each assistant with targets has a hand-written fixture in `tests/fixtures/guide/<assistant>.html`. Fixtures start with a `SYNTHETIC` comment; they are not copies of the sites. Mark the expected element with `data-expect="<step id>"`. `tests/guide-pointer.test.ts` checks every target against its fixture.

To turn a broken pointer off, delete its entry and ship a release. The card then shows the step in words.

## Checks

```sh
npx tsc --noEmit -p .
npx vitest run tests/assistants-config.test.ts tests/guide-*.test.ts tests/connect-view.test.ts
npm run build && npx playwright test e2e/guided-setup.spec.ts
```

The Playwright spec checks for no sideways scroll at 320 to 920 px with accordions open and closed. It also runs Start setup from a frame in a web page and confirms the side panel opens. Last, it checks that the pointer draws only on the assistant's tab.
