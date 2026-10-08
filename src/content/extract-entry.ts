/**
 * extract.js: injected by the service worker only after the privacy gate
 * allowed indexing this tab (see src/lib/extract-injector.ts). Runs in the
 * extension's isolated world, next to content.js.
 *
 * On CORTEX_EXTRACT_NOW it extracts readable text (Readability on a sanitized
 * clone), redacts PII, summarizes on device when possible, and sends
 * CORTEX_INDEX. The service worker re-checks the gate on that message.
 */
import { extractPageText } from "./extract";
import { redactPII } from "../lib/pii-filter";
import { summarizeBestEffort } from "../lib/summarize";
import {
  isExtensionRuntimeAlive,
  isInvalidatedExtensionError,
  sendRuntimeMessage,
} from "../shared/extension-runtime";
import { devLog } from "../lib/extension-logger";
import { parseLinkedInPage } from "../lib/capture/linkedin";
import { armYouTubeCapture } from "./youtube-capture";
import { extractTables } from "../lib/capture/tables";
import { extractImages } from "../lib/capture/images";
import { collectImageInputs } from "./image-inputs";
import type { NewChunk } from "../db/schema";

declare global {
  interface Window {
    __cortexExtractLoaded?: boolean;
  }
}

function normalizedUrl(): string {
  const u = new URL(location.href);
  u.hash = "";
  return u.href;
}

let running = false;
/** A capture was requested while one was already reading the page. */
let again = false;

async function extractOnce(flags: CaptureFlags, pass: number): Promise<void> {
  const pageUrl = normalizedUrl();
  const host = location.hostname;
  const linkedIn = /(^|\.)linkedin\.com$/i.test(host);
  const tables = flags.tables ? extractTables(document) : { chunks: [], capturedTableIndexes: [] };
  if (normalizedUrl() !== pageUrl) {
    again = true;
    return;
  }
  const extraChunks: NewChunk[] = tables.chunks.map((c) => ({ ...c, text: redactPII(c.text).redacted }));
  const images = flags.images ? extractImages(document, pageUrl) : null;
  if (images) extraChunks.push({ ...images, text: redactPII(images.text).redacted });
  const imageSrcs = (images?.locator as { images?: { src: string }[] } | undefined)?.images?.map((i) => i.src) ?? [];
  const imageInputs = images && flags.imageDescriptions ? collectImageInputs(document, imageSrcs) : [];
  const raw = extractPageText(document, undefined, { dropTableIndexes: tables.capturedTableIndexes });
  if (normalizedUrl() !== pageUrl) {
    again = true;
    return;
  }
  const title = redactPII(raw.title).redacted;
  const text = redactPII(raw.text).redacted;
  const person = linkedIn ? parseLinkedInPage(document, pageUrl) : null;
  const thinProfile = Boolean(
    person && !person.headline && !person.roleTitle && !person.about && !person.company
  );

  const localMin =
    host.includes("linkedin.com") ? 28 : host.includes("twitter.com") || host === "x.com" ? 38 : 72;
  const textOk = text.length >= localMin;
  if (!textOk && !person && !extraChunks.length) {
    if (thinProfile && pass < 3) again = true;
    return;
  }

  // The profile card is still the loading shell. Save the name now, then read
  // the page again once the role and company have painted.
  const summarize = textOk && !(thinProfile && pass < 3);
  const summary = summarize ? await summarizeBestEffort(text) : "";
  if (!isExtensionRuntimeAlive()) return;
  if (normalizedUrl() !== pageUrl) {
    again = true;
    return;
  }
  const personNow = linkedIn ? parseLinkedInPage(document, pageUrl) : null;

  await sendRuntimeMessage({
    type: "CORTEX_INDEX",
    payload: {
      url: pageUrl,
      title,
      text: summarize && textOk ? text : "",
      summary,
      visitedAt: Date.now(),
      ...(personNow ? { person: personNow } : {}),
      ...(summarize && extraChunks.length ? { extraChunks } : {}),
      ...(summarize && imageInputs.length ? { imageInputs } : {}),
    },
  });
  if (thinProfile && pass < 3) again = true;
}

async function extractAndIndex(flags: CaptureFlags): Promise<void> {
  if (!isExtensionRuntimeAlive()) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    let pass = 0;
    do {
      again = false;
      pass += 1;
      await extractOnce(flags, pass);
      if (again && isExtensionRuntimeAlive()) {
        await new Promise((resolve) => window.setTimeout(resolve, 900));
      }
    } while (again && pass < 4 && isExtensionRuntimeAlive());
  } catch (e) {
    if (isInvalidatedExtensionError(e) || !isExtensionRuntimeAlive()) return;
    devLog.warn("[Cortex] extract:", e);
  } finally {
    running = false;
    if (again && isExtensionRuntimeAlive()) {
      again = false;
      void extractAndIndex(flags);
    }
  }
}
interface CaptureFlags {
  tables: boolean;
  images: boolean;
  /** On-device descriptions: user setting and policy both allow it. */
  imageDescriptions: boolean;
}

if (!window.__cortexExtractLoaded) {
  window.__cortexExtractLoaded = true;
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "CORTEX_EXTRACT_NOW") return undefined;
    sendResponse({ ok: true as const });
    // YouTube watch page with transcripts on (decided by the service worker).
    if (msg.youtube === true) armYouTubeCapture();
    void extractAndIndex({
      tables: msg.tables === true,
      images: msg.images === true,
      imageDescriptions: msg.imageDescriptions === true,
    });
    return undefined;
  });
}
