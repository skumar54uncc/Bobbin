# v2 Phase 6 notes: free and independent messaging

Spec: popup footer, About Bobbin, header subtitle from real Assistant Sync state.
Cadence in About is 5 minutes (not 2), and Pages docs are named.

## Built

- Popup footer: "Free forever. No ads. No servers. Your data stays yours." plus "Why it's free", which opens Settings at `#cx-sec-about`.
- Settings **About Bobbin**: title "Free, and built to stay that way", the independent-developer copy, Privacy Policy, Terms of Use, Send feedback (version and browser prefilled, no browsing data), and Version.
- Header tagline: "Private library of pages you read on this device" when Assistant Sync is off; "On this device and in your Google Drive" when it is on. Popup, overlay, and onboarding read `CORTEX_SYNC_LABEL`.
- Pages host is `https://skumar54uncc.github.io/Bobbin/` (main, `/docs`). Privacy and data-deletion still use `privacy-policy.html` and `data-deletion.html` until Phase 7 adds `/privacy` and `/terms`. Terms of Use points at `TERMS.md` until then.
- Tagline: "Read it once. Ask your AI anytime." Onboarding first screen, store listing, and the start of the manifest description. Brand line on About: "Bobbin keeps the thread of everything you read." Header subtitle still follows Assistant Sync on/off.

## Tests

- `tests/about-copy.test.ts`
- `e2e/about-free.spec.ts`
- Screenshots (SYNTHETIC PREVIEW of the chrome-extension pages): `dev/v2-phase6/popup.png`, `dev/v2-phase6/settings-about.png`
