# Bobbin Privacy Policy

Last updated: October 8, 2026

Bobbin is a free Chrome extension built and maintained by one
independent developer. It has no servers, no ads, no analytics, and no
paid plans. This policy explains exactly what Bobbin collects, where it
goes, and how you control it.

## The short version

- Bobbin stores your browsing memory on your device.
- If you turn on Assistant Sync, Bobbin also writes one spreadsheet and
  one Google Doc per day of page text to your own Google Drive. Nobody
  else gets a copy, including the developer.
- Bobbin never sells, rents, or shares your data, and never uses it for
  advertising or to train AI models.
- You can pause, export, or delete everything at any time.

## What Bobbin collects

When capture is on, Bobbin records:

- Pages you visit: title, address (with tracking parameters removed),
  domain, date and time, time spent on the page, and how far you
  scrolled.
- Searches you make on supported search engines and sites, with the
  search text.
- The text of pages you read: a page counts as read when it is on screen
  and focused for 20 seconds or more, or you scroll through 30% or more
  of it. Bobbin keeps up to 4,000 characters of the page's main text,
  preferring the part you scrolled through. With Assistant Sync on, this
  text syncs to your Google Drive in a daily Pages doc.
- For LinkedIn profiles you open: the name, headline, location,
  current role, About, Experience (title, company, dates, location, and
  the first 300 characters of each description), Education (school,
  degree, field, and years), and up to 10 skills shown on the profile. With Assistant Sync on, these sync to that day's Pages doc.
- LinkedIn feed posts, only if you turn on "Save text of LinkedIn posts
  I scroll past" (off by default): for each post that stays on screen
  for 2 seconds or more, the author's name, up to 1,500 characters of
  the post's text, and the time you saw it. With Assistant Sync on,
  these sync to that day's Pages doc.
- LinkedIn profiles and company pages you open: name, headline,
  company, and the profile photo shown on the page. The photo is stored
  only on your device and never synced. Bobbin copies the photo only while you are
  on that page, so viewing your library makes no requests to LinkedIn.
  Turn photos off in Settings with Show profile photos. Bobbin never
  collects contact details or messages, and never visits pages on its
  own.
- Topic labels that Bobbin computes on your device to help search.
- With Assistant Sync on and Chrome history sync turned on in your
  Google account, pages Chrome synced from your other signed-in devices:
  title, address, and time only. They are marked "other device" in the
  sheet. Bobbin reads them from Chrome's own history on this device and
  applies the same block list.

Bobbin does not collect anything in Incognito windows, on pages that
contain a password field, or on sites in the block list (banking,
health portals, webmail, password managers, LinkedIn Messaging, and any
site you add). Your block list starts with Google account, storage,
billing, and photo pages (myaccount.google.com, accounts.google.com,
one.google.com, photos.google.com, payments.google.com, pay.google.com);
you can remove any of them in Settings. Assistant Sync never records
its own Bobbin Memory sheet, folders, or Pages docs. The block list,
Incognito rule, and the cleanup below apply to all captured text,
including page text, profile fields, and feed posts. Bobbin removes
email addresses, phone numbers, numbers of 13 or more digits, and
invisible characters from captured text, and cuts titles to 200
characters. Addresses lose
tracking parameters, AMP pages are recorded as the article, and link
redirects (such as t.co and lnkd.in) are recorded as the page they lead
to. Titles and page text that read like instructions to an AI are listed
on your device for review; Bobbin does not change or send that list.
Bobbin asks Chrome to keep its storage when your disk runs low.

## Where your data is stored

- **On your device:** in your browser's local storage (IndexedDB). It
  stays there until you delete it or uninstall Bobbin.
- **In your Google Drive (only if you turn on Assistant Sync):** Bobbin
  creates one folder named "Bobbin Memory" containing one spreadsheet
  named "Bobbin Memory" and a folder named "Pages" with one Google Doc
  per day, named like "Bobbin Pages 2026-10-08 Thursday", holding the
  page text, LinkedIn profile fields, and (only with the feed setting
  on) LinkedIn post text described above. Nothing else. Bobbin uses the
  Google permission that only allows access to files Bobbin itself
  created (drive.file). Bobbin cannot see any other file in your Drive.
  Bobbin writes new rows to the spreadsheet, rewrites each day's doc
  when that day changes, and reads them only to check that they still
  exist and to remove data older than your retention setting. Rows and
  day docs are kept for your retention setting (7 to 365 days, default
  90) while Assistant Sync is on; with Compact sheet detail, day docs
  are kept for 14 days. Older day docs are moved to your Drive trash.
  A day doc holds up to 500,000 characters (150,000 with Compact), so
  the longest page texts of a busy day may be shortened.
  If you move a day doc or the Pages folder to the trash yourself,
  Bobbin treats that day (or every day, for the folder) as deleted by
  you: it does not restore the file, does not upload that day's page
  text again, and tells you once in Settings, where Undo brings it back.
  Challenge, captcha, sign in, and sign up pages are never recorded.
  If you turn Assistant Sync off, the files stay in your Drive until you
  delete them; Bobbin offers a button to delete them for you.
- **Your Google account:** Bobbin uses Google sign in only to get
  permission to write the spreadsheet and Pages docs. Bobbin does not
  store or collect your Google account email address, contacts, or any
  other Google data.

The developer has no server and no access to your data in either place.

## AI assistants

Assistant Sync exists so that AI assistants you choose can read your
Bobbin Memory spreadsheet and Pages docs through their own Google Drive
integration.
Bobbin never sends your data to any of them. You decide which assistant
to connect, and you grant it access through that company's own Google
Drive connection.

When you connect an assistant, its provider can access the spreadsheet
and Pages docs under that provider's own privacy policy and terms, outside Bobbin's
control. Providers Bobbin gives setup instructions for:

- Anthropic (Claude)
- OpenAI (ChatGPT)
- Google (Gemini)
- xAI (Grok)
- Meta (Muse)
- Microsoft (Copilot)
- Perplexity

Only connect assistants you trust, review their policies, and
disconnect Google Drive in the assistant if you stop using it.

Titles in the spreadsheet and text in the Pages docs come from websites
you visited. Bobbin labels page text as website text and instructs
assistants never to follow instructions found inside it, but Bobbin cannot guarantee how a third
party assistant behaves.

## Optional built in AI

If your version of Bobbin offers an optional AI feature that uses an
API key you provide, your question and the relevant excerpts are sent
to that provider only when you use it, under that provider's policy.

## Google API Services disclosure

The use of information received from Google APIs will adhere to the
Chrome Web Store User Data Policy, including the Limited Use
requirements (https://developer.chrome.com/docs/webstore/program-policies/limited-use).

Bobbin's use and transfer of information received from Google APIs to
any other app will adhere to the Google API Services User Data Policy
(https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements.

Bobbin uses Google sign in and the drive.file permission only to create
and update your Bobbin Memory spreadsheet and Pages docs. Bobbin does not use Google
data for advertising, does not sell it, does not transfer it to anyone,
and does not allow humans to read it, except with your explicit consent
for support, for security reasons, or where required by law.

## Feedback form

If you send feedback through the Bobbin feedback form, it is collected
with Google Forms, a Google service, and stored in the developer's
Google account. The developer receives what you type, your email
address only if you choose to provide it, and your Bobbin and browser
versions, which the form fills in for you. The form does not collect
your Google account email. Please do not paste
browsing history or personal information into feedback.

## Your controls

- Pause capture for 1 hour, for today, or until you resume.
- Block any site.
- Turn LinkedIn capture off, and choose whether LinkedIn feed post text
  is saved (off by default).
- Set how long data is kept (7 to 365 days, default 90).
- Export your data as a file.
- Delete your last hour, last day, or everything.
- Turn off Assistant Sync and delete the Drive folder from inside
  Bobbin. You can also revoke Bobbin's Google access at
  https://myaccount.google.com/permissions.
- Uninstalling Bobbin deletes all local data. Your Drive spreadsheet
  and Pages docs stay in your Drive until you delete them.

## Children

Bobbin is not directed at children under 13 and does not knowingly
collect data from them.

## Security

Your data stays on your device and in your own Google account. Bobbin
contains no remote code, requests only the permissions it needs, and
validates all data it handles. No system is perfectly secure; keep your
device and Google account protected.

## Changes

If this policy changes, the new version will be posted at this address
with a new date, and Bobbin will show a notice inside the extension for
any material change.

## Contact

Use the feedback form in Bobbin (Settings, then Send feedback) or email
[shailesh.entrant@gmail.com](mailto:shailesh.entrant@gmail.com).
