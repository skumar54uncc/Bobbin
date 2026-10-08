# Cortex Privacy Policy

Last updated: October 8, 2026

Cortex is a free Chrome extension built and maintained by one
independent developer. It has no servers, no ads, no analytics, and no
paid plans. This policy explains exactly what Cortex collects, where it
goes, and how you control it.

## The short version

- Cortex stores your browsing memory on your device.
- If you turn on Assistant Sync, Cortex also writes one spreadsheet to
  your own Google Drive. Nobody else gets a copy, including the
  developer.
- Cortex never sells, rents, or shares your data, and never uses it for
  advertising or to train AI models.
- You can pause, export, or delete everything at any time.

## What Cortex collects

When capture is on, Cortex records:

- Pages you visit: title, address (with tracking parameters removed),
  domain, date and time, time spent on the page, and how far you
  scrolled.
- Searches you make on supported search engines and sites, with the
  search text.
- Short excerpts of pages you read for 5 minutes or longer (up to 800
  characters, or 400 with Compact sheet detail). You can turn excerpts off.
- LinkedIn profiles and company pages you open: name, headline,
  company, and the profile photo shown on the page, stored only on your
  device and never synced. Cortex copies the photo only while you are
  on that page, so viewing your library makes no requests to LinkedIn.
  Turn photos off in Settings with Show profile photos. Cortex never
  collects contact details or messages, and never visits pages on its
  own.
- Topic labels that Cortex computes on your device to help search.

Cortex does not collect anything in Incognito windows, on pages that
contain a password field, or on sites in the block list (banking,
health portals, webmail, password managers, LinkedIn Messaging, and any
site you add). Cortex removes email addresses, phone numbers, and long
card-like numbers from captured text.

## Where your data is stored

- **On your device:** in your browser's local storage (IndexedDB). It
  stays there until you delete it or uninstall Cortex.
- **In your Google Drive (only if you turn on Assistant Sync):** Cortex
  creates one folder named "Cortex Memory" containing one spreadsheet
  named "Cortex Memory", and nothing else. Cortex uses the Google
  permission that only allows access to files Cortex itself created
  (drive.file). Cortex cannot see any other file in your Drive. Cortex
  writes new rows to this spreadsheet and reads it only to check that it
  still exists and to remove rows older than your retention setting.
  Rows in the spreadsheet are kept for your retention setting (7 to 365
  days, default 90) while Assistant Sync is on. If you turn Assistant
  Sync off, the spreadsheet stays in your Drive until you delete it;
  Cortex offers a button to delete it for you.
- **Your Google account:** Cortex uses Google sign in only to get
  permission to write the spreadsheet. Cortex does not store or collect
  your Google account email address, contacts, or any other Google
  data. [CURSOR: confirm this matches the code; if the code reads the
  account email, describe exactly how it is used instead.]

The developer has no server and no access to your data in either place.

## AI assistants

Assistant Sync exists so that AI assistants you choose can read your
Cortex Memory spreadsheet through their own Google Drive integration.
Cortex never sends your data to any of them. You decide which assistant
to connect, and you grant it access through that company's own Google
Drive connection.

When you connect an assistant, its provider can access the spreadsheet
under that provider's own privacy policy and terms, outside Cortex's
control. Providers Cortex gives setup instructions for:

- Anthropic (Claude)
- OpenAI (ChatGPT)
- Google (Gemini)
- xAI (Grok)
- Meta (Muse)
- Microsoft (Copilot)
- Perplexity

Only connect assistants you trust, review their policies, and
disconnect Google Drive in the assistant if you stop using it.

Content in the spreadsheet comes from websites you visited. Cortex
labels it as website text and instructs assistants never to follow
instructions found inside it, but Cortex cannot guarantee how a third
party assistant behaves.

## Optional built in AI

If your version of Cortex offers an optional AI feature that uses an
API key you provide, your question and the relevant excerpts are sent
to that provider only when you use it, under that provider's policy.

## Google API Services disclosure

The use of information received from Google APIs will adhere to the
Chrome Web Store User Data Policy, including the Limited Use
requirements (https://developer.chrome.com/docs/webstore/program-policies/limited-use).

Cortex's use and transfer of information received from Google APIs to
any other app will adhere to the Google API Services User Data Policy
(https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements.

Cortex uses Google sign in and the drive.file permission only to create
and update your Cortex Memory spreadsheet. Cortex does not use Google
data for advertising, does not sell it, does not transfer it to anyone,
and does not allow humans to read it, except with your explicit consent
for support, for security reasons, or where required by law.

## Feedback form

If you send feedback through the Cortex feedback form, it is collected
with Google Forms, a Google service, and stored in the developer's
Google account. The developer receives what you type, your email
address only if you choose to provide it, and your Cortex and browser
versions, which the form fills in for you. The form does not collect
your Google account email. Please do not paste
browsing history or personal information into feedback.

## Your controls

- Pause capture for 1 hour, for today, or until you resume.
- Block any site.
- Turn excerpts or LinkedIn capture off.
- Set how long data is kept (7 to 365 days, default 90).
- Export your data as a file.
- Delete your last hour, last day, or everything.
- Turn off Assistant Sync and delete the Drive spreadsheet from inside
  Cortex. You can also revoke Cortex's Google access at
  https://myaccount.google.com/permissions.
- Uninstalling Cortex deletes all local data. Your Drive spreadsheet
  stays in your Drive until you delete it.

## Children

Cortex is not directed at children under 13 and does not knowingly
collect data from them.

## Security

Your data stays on your device and in your own Google account. Cortex
contains no remote code, requests only the permissions it needs, and
validates all data it handles. No system is perfectly secure; keep your
device and Google account protected.

## Changes

If this policy changes, the new version will be posted at this address
with a new date, and Cortex will show a notice inside the extension for
any material change.

## Contact

Use the feedback form in Cortex (Settings, then Send feedback) or email
[shailesh.entrant@gmail.com](mailto:shailesh.entrant@gmail.com).
