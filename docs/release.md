# Bobbin 2.0.0 release

Do not upload until the hosted pages are live and the OAuth consent screen is In production. Do not change the manifest `key` or the published item id `happibddmmagkgneicjkndapcpmhdbfn`. Do not mint a new OAuth client.

Package: `bobbin-2.0.0.zip` at the repo root (gitignored). **22,262,328 bytes**, 104 zip entries, `manifest.json` at the root, no source maps. Built with `npm run build:store` so the zip uses the Chrome Web Store OAuth client, not the unpacked `dev` client. Do not change the manifest `key` or the published item id `happibddmmagkgneicjkndapcpmhdbfn`. After a store build, run `npm run build` again if you still test unpacked (`dev` client).

## 1. Merge into main (homepage, privacy, terms)

GitHub Pages for this repo serves the `docs/` folder on `main` as https://skumar54uncc.github.io/Bobbin/.

1. Open a PR of the `v2` work into `main` (do not force-push). Include `docs/index.html`, `docs/privacy/index.html`, `docs/terms/index.html`, `docs/PRIVACY_POLICY.md`, `docs/data-deletion.html`, and `docs/store-listing.md`.
2. Merge the PR.
3. Wait for Pages to deploy. Confirm:
   - https://skumar54uncc.github.io/Bobbin/
   - https://skumar54uncc.github.io/Bobbin/privacy
   - https://skumar54uncc.github.io/Bobbin/terms
   - https://skumar54uncc.github.io/Bobbin/data-deletion.html
4. The Install button on the homepage already points at the live listing (same item after the rename).

Until this merge, OAuth "In production" and the store listing cannot truthfully point at the new privacy and terms URLs.

## 2. Google Cloud

1. Open the Google Cloud project that owns the Chrome extension OAuth client bound to item `happibddmmagkgneicjkndapcpmhdbfn`. Do not create a new client.
2. OAuth consent screen:
   - App name: **Bobbin**
   - User support email and developer contact: shailesh.entrant@gmail.com
   - Homepage: https://skumar54uncc.github.io/Bobbin/
   - Privacy policy: https://skumar54uncc.github.io/Bobbin/privacy
   - Terms of Use: https://skumar54uncc.github.io/Bobbin/terms
   - Scopes: `https://www.googleapis.com/auth/drive.file` only (non-sensitive; app verification is not required)
3. Publish the consent screen **In production**. Testing mode grants expire after 7 days.
4. Brand verification (name and logo) is optional and needs a domain you own in Search Console. github.io may not qualify. If it is refused, ship without it (users see the project domain instead of the logo), or verify a domain later.

## 3. Chrome Web Store

1. Upload `bobbin-2.0.0.zip` to the existing item (same id). Rename the listing to **Bobbin: Browsing Memory for AI**.
2. Privacy policy URL: https://skumar54uncc.github.io/Bobbin/privacy
3. Paste listing text from `docs/store-listing.md`:
   - Tagline: The missing memory for your AI.
   - Short description (108 characters): The missing memory for your AI. Bobbin remembers pages you read for Claude, ChatGPT, Gemini, and Grok. Free.
   - Detailed description: the Full description in that file
4. Single purpose statement: Bobbin is a personal browsing memory: it remembers the pages you read so you can search them, and can optionally share that memory with your own AI assistant through your Google Drive.
5. Permission justifications: copy the table in `docs/store-listing.md`. Host access is for reading pages you visit. Google Drive calls use the OAuth token, not host access.
6. Privacy practices: tick Web history, Website content, and Personally identifiable information only. Certify the three Limited Use boxes. Remote code: no. Data transmission: default none; optional Gemini snippets; optional Drive copy with `drive.file`.
7. Limited Use certification: both sentences from the privacy policy (Chrome Web Store User Data Policy and Google API Services User Data Policy).
8. Screenshots: felt design, Bobbin name. Exact sizes in the graphics list below. No personal browsing data on screen.
9. Submit for review. Existing users keep the item; they see the new name after the store update. `unlimitedStorage` has no extra install warning, but any new permission still needs a justification.

## 4. Fresh-profile test

Use a new Chrome profile. Load `bobbin-2.0.0.zip` unpacked (unzip) or install the store listing once it is in review / published.

1. Install. The welcome page must appear **before** any indexing. Read the consent copy. Press **I agree**. Confirm a sensitive site (a bank URL) is skipped if you open one.
2. Browse three ordinary articles and one LinkedIn profile. Wait until the popup shows pages saved.
3. Settings > Assistant Sync. Read the second consent. Press **I agree** / Enable. Sign in to Google. Confirm one folder named Bobbin Memory and one spreadsheet, no JSON backup file in Drive.
4. Connect AI Agents. Pick **Claude**. Start setup. Complete Connect Google Drive, paste the instruction, open a new chat.
5. Ask Claude these six questions (score: starts by saying whether it is in the log; no invented people or pages):
   1. What did I browse last week? Filter by date, not by your own knowledge of the topic.
   2. What did I read yesterday? Give the titles and about how long I spent.
   3. What did I search for in the last 7 days?
   4. Who did I look up on LinkedIn recently, and what was their current role?
   5. How up to date is this log? Give both Last checked and Last new activity from the About tab.
   6. If I ask for a person I never looked up, say it is not in the log. Do not invent a profile.
6. On google.com, press Copy in Connect (Other or an instruction). Confirm Copied and a working paste. Repeat on linkedin.com/feed. There must be no "Clipboard API has been blocked" console line from Bobbin.

## 5. Beta plan

Ship to 3 to 5 people before a wide store push.

- Pick people who already use Claude, ChatGPT, or Gemini with Google Drive.
- Send the zip or a trusted tester link, the welcome consent text, and the six questions above.
- Ask them to Enable sync, run Claude setup, and report: consent screens, Drive file count (must be one folder and one sheet), copy on LinkedIn, and whether the assistant invented anything.
- Watch for 429s on the shared Sheets project (status line should slow to 15 minutes after repeated 429s).
- Only then submit or promote the listing.

## Store graphics (regenerate with the Bobbin name)

Chrome Web Store image requirements ([store images](https://developer.chrome.com/docs/webstore/images)):

| Asset | Size | Notes |
|-------|------|--------|
| Store icon | 128 x 128 PNG | Also ship 16 x 16 and 48 x 48 in the package (`icons/icon-16.png`, `icon-48.png`, `icon-128.png`). Square, no padding that makes the mark tiny. |
| Screenshot 1 | 1280 x 800 PNG | Connect AI Agents: seven assistant tiles, Bobbin mascot, sentence-case copy. |
| Screenshot 2 | 1280 x 800 PNG | Assistant Sync in Settings: status line, Enable, Drive explained. |
| Screenshot 3 | 1280 x 800 PNG | Ask any assistant: packet preview and Insert into chat. |
| Screenshot 4 | 1280 x 800 PNG | Search or Ask in the in-page panel over a generic article. No personal data. |
| Screenshot 5 | 1280 x 800 PNG | About Cortex / free forever section in Settings. |
| Small promo tile | 440 x 280 PNG | Optional. Wordmark Bobbin plus mascot. |
| Large promo tile | 920 x 680 PNG | Optional. |
| Marquee promo tile | 1400 x 560 PNG | Optional. |

Screenshots may be 640 x 400 instead of 1280 x 800, but pick one size and use it for all five. Light theme unless the About shot is dark. No em dashes in captions. Suggested captions:

1. Connect Claude, ChatGPT, Gemini, and more to your Bobbin memory.
2. Assistant Sync writes one folder in your own Google Drive.
3. Ask any assistant. Bobbin puts the context in the chat box.
4. Search what you read, on this device.
5. Free forever. No ads. No servers.

Promo video is optional. If you record one, keep it under a minute and do not show real browsing history.
