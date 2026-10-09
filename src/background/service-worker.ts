/// <reference types="chrome"/>
import {
  db,
  upsertDocument,
  replaceChunksForDocument,
  setChunkEmbedding,
  markChunkEmbedFailed,
  appendVisit,
  getRecentVisits,
  hostnameFromUrl,
} from "../db/schema";
import { chunkArticle } from "../lib/chunking";
import {
  ASSISTANT_SYNC_ALARM,
  ASSISTANT_SYNC_ALARM_PERIOD_MIN,
  ASSISTANT_SYNC_SOON_ALARM,
  countUnsyncedVisits,
  listSyncWarnings,
  readSyncEngineState,
  setDriveFolderTrashHandler,
  writeSyncEngineState,
} from "../assistant-sync/db";
import {
  plannedFlushAt,
  syncStatusLine,
  VERIFY_EVERY_MS,
  type FlushReason,
} from "../assistant-sync/schedule";
import {
  AssistantSyncMessageSchema,
  DwellAllowedMessageSchema,
  DwellMessageSchema,
  FeedPostMessageSchema,
  type FeedPostMessage,
  parseMessage,
  SyncWorkReplySchema,
  type DwellMessage,
  type SyncWorkReply,
} from "../assistant-sync/messages";
import {
  applyRetention,
  forgetAll,
  forgetSince,
  forgetSite,
  FORGET_WINDOWS_MS,
} from "../lib/data-controls";
import { resolveForgetRequest } from "../lib/forget-request";
import {
  RECHUNK_ALARM,
  RECHUNK_ALARM_PERIOD_MIN,
  runRechunkBatch,
} from "../lib/rechunk";
import {
  isBlockedDomain,
  looksSensitiveHostname,
} from "../lib/privacy";
import { shouldAlwaysSkipUrl } from "../lib/sensitive-domains";
import { getUserSettings } from "../shared/extension-settings";
import {
  getEffectiveChatSettings,
  getEffectiveSettings,
} from "../shared/managed-policy";
import {
  deliverOverlayMessage,
  resolveOverlayTabId,
} from "../shared/shell-routing";
import { storageLocalGet, storageLocalSet } from "../shared/storage-local";
import {
  ASSISTANT_SYNC_BACKUP_FILE_ID,
  ASSISTANT_SYNC_FEED_POSTS_KEY,
  ASSISTANT_SYNC_FILE_ID,
  ASSISTANT_SYNC_FOLDER_ID,
  ASSISTANT_SYNC_ON_KEY,
  ASSISTANT_SYNC_PAGES_FOLDER_ID,
  ASSISTANT_SYNC_RETENTION_KEY,
  ASSISTANT_SYNC_SHEET_DETAIL_KEY,
} from "../assistant-sync/preference-keys";
import {
  dwellReportPageOk,
  indexPayloadUrlMatchesTab,
  isOptionsPageSender,
  isGuidePanelSender,
  isExtensionPageSender,
  isPrivilegedExtensionSender,
} from "../lib/message-security";
import { GUIDE_KEY, GUIDE_PANEL_PATH } from "../guide/state";
import {
  CORTEX_EXTENSION_BUS_CHANNEL,
  type CortexBusInbound,
  type CortexBusOutbound,
} from "../lib/extension-bus";
import type { SearchHitDTO } from "../lib/search-engine";
import { CORTEX_EMBED_MODEL_ID } from "../shared/embed-model";
import { agentDebugLog } from "../lib/agent-debug-log";
import { devLog } from "../lib/extension-logger";
import { redactPII } from "../lib/pii-filter";
import { summarizeBestEffort } from "../lib/summarize";
import {
  composeHistoryIndexText,
  dedupeHistoryItems,
  fetchHtmlForHistory,
  historySearch,
  MIN_HISTORY_IMPORT_TEXT_CHARS,
  HISTORY_IMPORT_IDLE,
  HISTORY_IMPORT_FETCH_CONCURRENCY,
  readHistoryImportProgress,
  writeHistoryImportProgress,
} from "../lib/history-import";
import {
  deleteConversation,
  dropLastTurn,
  getConversationMessages,
  listRecentConversations,
} from "../lib/chat/conversation-store";
import { CHAT_LIMITS, SEARCH_LIMITS, STORAGE_LIMITS } from "../lib/limits";
import { isHistoryFetchAllowedUrl } from "../lib/history-fetch-security";
import { isInjectableWebUrl } from "../lib/injectable-url";
import {
  installActiveTabCacheListeners,
  setActiveTabSnapshot,
} from "../lib/active-tab-cache";
import {
  configureSidePanelBehavior,
  enableGlobalSidePanel,
  enableSidePanelForRestrictedTab,
  openSearchSidePanelReliable,
} from "../lib/side-panel-launcher";
import { openCortexSearchForTab } from "../lib/open-cortex-search";
import { openOverlayOnTab } from "../lib/overlay-injector";
import { requestExtraction } from "../lib/extract-injector";
import { canonicalLinkedInUrl, sameLinkedInProfile, sanitizePersonDetail, type LinkedInEntity } from "../lib/capture/linkedin";
import { deletePerson, listPeople, upsertPerson } from "../lib/people";
import { cacheProfilePhoto, getProfilePhoto, profilesWithPhotos } from "../lib/profile-photos";
import { applyDwellReport, readingTimeFor, type DwellLedger } from "../lib/reading-time";
import { FLUSH_LOG_KEY, appendFlushLog, flushLogEntry } from "../assistant-sync/flush-log";
import { canonicalizeUrl, samePage } from "../assistant-sync/canonical-url";
import { isChallengePage } from "../assistant-sync/challenge";
import { resolveEnteredUrl, toSuggestions } from "../lib/omnibox";
import { saveHighlight } from "../lib/highlights";
import { sanitizeExtraChunks, sanitizeImageInputs, type ImageInput } from "../lib/capture/extra-chunks";
import { appendDescriptions, planImageDescriptions, reuseDescribedText } from "../lib/capture/images";
import { isPdfUrl } from "../lib/capture/pdf";
import {
  BACKUP_GATE_MESSAGE,
  BACKUP_WORK_MESSAGE,
  forwardBackupRequest,
  isBackupRequestType,
  type BackupRequestType,
  type BackupWorkMessage,
} from "../lib/export/backup-router";
import { indexPdfTab, type PdfExtractResult } from "../lib/pdf-indexer";
import type { ChunkKind } from "../db/schema";
import type { NewChunk } from "../db/schema";
import {
  sanitizeTranscriptPayload,
  transcriptChunks,
  videoIdFromUrl,
} from "../lib/capture/youtube";
import {
  dayKey,
  pruneShownMap,
  RESURFACE_SHOWN_KEY,
  shouldResurface,
  type SimilarDocument,
} from "../lib/resurface";
import {
  addPageToCollection,
  createCollection,
  deleteCollection,
  listCollections,
} from "../lib/collections";
import { safeHttpHttpsHref } from "../lib/url-security";
import { RateLimiter } from "../lib/rate-limiter";
import {
  ERROR_CODES,
  payloadFromCode,
  CortexError,
} from "../lib/errors";
import {
  notifyFirstInstallHistoryScanFinished,
  notifyFirstInstallHistoryScanStarted,
} from "../lib/first-install-history-notify";
import {
  FIRST_INSTALL_BACKFILL_DONE_KEY,
  FIRST_INSTALL_HISTORY_DAYS,
  FIRST_INSTALL_HISTORY_MAX_URLS,
  INDEXING_CONSENT_KEY,
  ONBOARDING_DONE_KEY,
} from "../shared/onboarding-constants";
import { ensureIndexingHeadroom } from "../lib/storage-eviction";
import {
  computeFreshSnapshot,
  onIndexCommitted,
  refreshSnapshotNow,
  writeSnapshot,
} from "../lib/stats-snapshot";

const MIN_INDEX_CHARS_DEFAULT = 80;

const SW_RATE_LIMITER = new RateLimiter(60_000);

function rateLimitHit(
  bucketKey: string,
  maxPerMinute: number,
  sendResponse: (r: unknown) => void
): boolean {
  if (SW_RATE_LIMITER.check(bucketKey, maxPerMinute)) return true;
  sendResponse({
    ok: false,
    error: ERROR_CODES.RATE_LIMITED,
    ...payloadFromCode(ERROR_CODES.RATE_LIMITED),
  });
  return false;
}

export interface IndexPayload {
  url: string;
  title: string;
  text: string;
  summary: string;
  visitedAt: number;
  /** LinkedIn profile or company parsed by extract.js (Phase 5.1). */
  person?: LinkedInEntity;
  /** Table / image chunks built by extract.js (Phase 5.7, 5.8); validated before use. */
  extraChunks?: unknown;
  /** Downscaled pixels for on-device descriptions (Phase 5.8); never stored. */
  imageInputs?: unknown;
}

/**
 * Records a LinkedIn person/company when people memory is on. The entity must
 * describe the very page that sent it (canonical URL match), so a page cannot
 * plant a different profile. Fields are re-capped here.
 */
async function maybeRecordPerson(person: unknown, pageUrl: string): Promise<boolean> {
  const settings = await getEffectiveSettings();
  if (!settings.peopleMemoryEnabled) return false;
  const p = person as Partial<LinkedInEntity> | null;
  if (!p || (p.kind !== "person" && p.kind !== "company")) return false;
  const canonical = canonicalLinkedInUrl(pageUrl);
  if (!canonical || p.profileUrl !== canonical) return false;
  const cap = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const name = cap(p.name, 120);
  if (!name) return false;
  // Location, about, roles, education and company detail (validated here
  // because the payload comes from the page).
  const detail = sanitizePersonDetail(person);
  const id = await upsertPerson({
    kind: p.kind,
    name,
    headline: cap(p.headline, 220),
    company: cap(p.company, 120),
    profileUrl: canonical,
    ...detail,
  });
  // The user is on this profile now, so this is the only moment Cortex asks LinkedIn for the photo.
  if (id != null && settings.profilePhotosEnabled && detail.photoUrl) {
    void cacheProfilePhoto(canonical, detail.photoUrl, { logo: p.kind === "company" }).catch(() => undefined);
  }
  void chrome.storage?.session?.set({ cortexPeopleTick: Date.now() }).catch(() => undefined);
  return true;
}

function minCharsForUrl(url: string): number {
  try {
    const h = new URL(url).hostname;
    if (h.includes("linkedin.com")) return 32;
    if (h.includes("twitter.com") || h === "x.com") return 40;
  } catch {
    /* ignore */
  }
  return MIN_INDEX_CHARS_DEFAULT;
}

let offscreenCreating: Promise<void> | null = null;

const cortexBus = new BroadcastChannel(CORTEX_EXTENSION_BUS_CHANNEL);

cortexBus.onmessage = (ev: MessageEvent<CortexBusOutbound>) => {
  const d = ev.data;
  if (!d?.kind) return;
  if (d.kind === "chat-event") {
    deliverOverlayMessage(d.tabId, {
      type: "CORTEX_CHAT_PUSH",
      event: d.event,
      requestId: d.requestId,
    });
    return;
  }
  if (d.kind === "digest-done") {
    deliverOverlayMessage(d.tabId, {
      type: "CORTEX_DIGEST_PUSH",
      ok: true,
      result: d.result,
    });
    return;
  }
  if (d.kind === "digest-error") {
    deliverOverlayMessage(d.tabId, {
      type: "CORTEX_DIGEST_PUSH",
      ok: false,
      error: d.message,
    });
  }
};

/** Stale offscreen docs survive extension reload — close so new bundle loads. */
async function closeOffscreenDocument(): Promise<void> {
  try {
    const has = await chrome.offscreen.hasDocument?.();
    if (has) {
      await chrome.offscreen.closeDocument();
    }
  } catch {
    /* ignore */
  }
}

async function ensureOffscreen(): Promise<void> {
  if (offscreenCreating) return offscreenCreating;

  offscreenCreating = (async () => {
    try {
      const has = await chrome.offscreen.hasDocument?.();
      if (has) {
        // #region agent log
        agentDebugLog({
          hypothesisId: "H1",
          location: "service-worker.ts:ensureOffscreen",
          message: "offscreen_already_present",
          data: {},
        });
        // #endregion
        return;
      }

      await chrome.offscreen.createDocument({
        url: chrome.runtime.getURL("offscreen.html"),
        reasons: [chrome.offscreen.Reason.WORKERS, chrome.offscreen.Reason.DOM_PARSER],
        justification:
          "Compute local MiniLM embeddings (Transformers.js) and read the text of imported history pages for Cortex.",
      });
      // #region agent log
      agentDebugLog({
        hypothesisId: "H1",
        location: "service-worker.ts:ensureOffscreen",
        message: "offscreen_created_ok",
        data: {},
      });
      // #endregion
    } catch (e: unknown) {
      // #region agent log
      agentDebugLog({
        hypothesisId: "H1",
        location: "service-worker.ts:ensureOffscreen",
        message: "offscreen_create_failed",
        data: {
          err: e instanceof Error ? e.message : String(e),
        },
      });
      // #endregion
      throw e;
    }
  })();

  try {
    await offscreenCreating;
  } finally {
    offscreenCreating = null;
  }
}

function storedId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Folder and file ids live in chrome.storage. The offscreen document cannot read it. */
async function readAssistantSyncLaunch(): Promise<{
  folderId: string | null;
  fileId: string | null;
  retentionDays?: number;
  sheetDetail?: string;
  backupId: string | null;
  pagesFolderId: string | null;
}> {
  const stored = await storageLocalGet([
    ASSISTANT_SYNC_FOLDER_ID,
    ASSISTANT_SYNC_FILE_ID,
    ASSISTANT_SYNC_PAGES_FOLDER_ID,
    ASSISTANT_SYNC_RETENTION_KEY,
    ASSISTANT_SYNC_SHEET_DETAIL_KEY,
    ASSISTANT_SYNC_BACKUP_FILE_ID,
  ]);
  const retention = stored[ASSISTANT_SYNC_RETENTION_KEY];
  const detail = stored[ASSISTANT_SYNC_SHEET_DETAIL_KEY];
  return {
    folderId: storedId(stored[ASSISTANT_SYNC_FOLDER_ID]),
    fileId: storedId(stored[ASSISTANT_SYNC_FILE_ID]),
    retentionDays: typeof retention === "number" ? retention : undefined,
    sheetDetail: typeof detail === "string" ? detail : undefined,
    backupId: storedId(stored[ASSISTANT_SYNC_BACKUP_FILE_ID]),
    pagesFolderId: storedId(stored[ASSISTANT_SYNC_PAGES_FOLDER_ID]),
  };
}

type SyncWorkAction = "alarm" | "now" | "enable" | "disable" | "cleanup" | "pages";
/** The user's answer to a question Settings asked: restore or create the sheet, the old files cleanup, or removed Pages docs. */
type SyncWorkAnswer = { choice?: "restore" | "create"; cleanup?: "trash" | "keep"; pages?: "undo" | "dismiss" };

async function writeAssistantSyncIds(ids: { folderId?: string | null; fileId?: string | null } | undefined): Promise<void> {
  if (!ids) return;
  const patch: Record<string, string | null> = {};
  if ("folderId" in ids) patch[ASSISTANT_SYNC_FOLDER_ID] = ids.folderId ?? null;
  if ("fileId" in ids) patch[ASSISTANT_SYNC_FILE_ID] = ids.fileId ?? null;
  if (Object.keys(patch).length === 0) return;
  await storageLocalSet(patch);
}

/** Silent token for the alarm and Sync now. The Enable click gets the interactive token itself. */
async function silentDriveToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      const err = chrome.runtime.lastError;
      if (err?.message || !token) {
        reject(new Error(err?.message || "Sign in to Google is needed before Cortex can sync."));
        return;
      }
      resolve(token);
    });
  });
}

function sendToOffscreen<T>(message: Record<string, unknown>): Promise<T | { ok: false; error: string }> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (result) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message ?? "offscreen_unreachable" });
      else resolve(result as T);
    });
  });
}

const OTHER_DEVICE_CURSOR_KEY = "cortex_assist_other_device_since";
/** The first pass looks back this far for pages Chrome synced from other devices. */
const OTHER_DEVICE_LOOKBACK_MS = 7 * 24 * 60 * 60_000;
const OTHER_DEVICE_PAGES_PER_PASS = 500;
const OTHER_DEVICE_VISITS_PER_PASS = 300;

interface OtherDeviceVisit {
  id: string;
  url: string;
  title: string;
  visitedAt: number;
}

/**
 * Visits chrome.history marks isLocal false: Chrome synced them from the user's other signed-in
 * devices. Title, URL, and time only. A missing isLocal (older Chrome) counts as this device.
 */
async function collectOtherDeviceVisits(now: number): Promise<{ visits: OtherDeviceVisit[]; until: number }> {
  const stored = await storageLocalGet([OTHER_DEVICE_CURSOR_KEY]);
  const cursor = stored[OTHER_DEVICE_CURSOR_KEY];
  const since = typeof cursor === "number" ? cursor : now - OTHER_DEVICE_LOOKBACK_MS;
  const items = await chrome.history.search({ text: "", startTime: since, endTime: now, maxResults: OTHER_DEVICE_PAGES_PER_PASS });
  const found: OtherDeviceVisit[] = [];
  for (const item of items) {
    if (!item.url) continue;
    // isLocal is Chrome 115+; the installed @types/chrome predates it.
    const visits = (await chrome.history.getVisits({ url: item.url })) as (chrome.history.VisitItem & { isLocal?: boolean })[];
    for (const visit of visits) {
      if (visit.isLocal !== false) continue;
      const at = visit.visitTime ?? 0;
      if (at <= since || at > now) continue;
      found.push({ id: `other:${visit.visitId}`, url: item.url, title: item.title ?? "", visitedAt: at });
    }
  }
  found.sort((a, b) => a.visitedAt - b.visitedAt);
  const kept: OtherDeviceVisit[] = [];
  const allowed = new Map<string, boolean>();
  for (const visit of found) {
    if (kept.length >= OTHER_DEVICE_VISITS_PER_PASS) break;
    let ok = allowed.get(visit.url);
    if (ok === undefined) {
      ok = !(await shouldSkipIndexing(visit.url, {})).skip;
      allowed.set(visit.url, ok);
    }
    if (ok) kept.push(visit);
  }
  const capped = kept.length >= OTHER_DEVICE_VISITS_PER_PASS;
  return { visits: kept, until: capped ? kept[kept.length - 1]!.visitedAt : now };
}

async function sendSyncWork(action: SyncWorkAction, token: string, answer: SyncWorkAnswer = {}): Promise<SyncWorkReply> {
  const launch = await readAssistantSyncLaunch();
  const other =
    action === "alarm" || action === "now"
      ? await collectOtherDeviceVisits(Date.now()).catch(() => null)
      : null;
  await ensureOffscreen();
  const raw = await sendToOffscreen<unknown>({
    type: "CORTEX_ASSISTANT_SYNC_WORK",
    action,
    token,
    folderId: launch.folderId,
    fileId: launch.fileId,
    retentionDays: launch.retentionDays,
    sheetDetail: launch.sheetDetail,
    backupId: launch.backupId,
    otherDeviceVisits: other?.visits ?? [],
    ...answer,
  });
  const reply = parseMessage(SyncWorkReplySchema, raw) ?? { ok: false, error: "Sync did not start." };
  if (reply.ids) await writeAssistantSyncIds(reply.ids);
  if (reply.pagesFolderId && reply.pagesFolderId !== launch.pagesFolderId) {
    await storageLocalSet({ [ASSISTANT_SYNC_PAGES_FOLDER_ID]: reply.pagesFolderId });
  }
  if (other && reply.otherDeviceStored) await storageLocalSet({ [OTHER_DEVICE_CURSOR_KEY]: other.until });
  if (action !== "disable" && action !== "cleanup" && action !== "pages" && !reply.confirm) void recordFlush(action, reply);
  return reply;
}

let flushLogChain: Promise<unknown> = Promise.resolve();

function recordFlush(action: "alarm" | "now" | "enable", reply: SyncWorkReply): Promise<unknown> {
  const entry = flushLogEntry(action, reply, Date.now());
  devLog.info("[Cortex] sync pass", entry);
  flushLogChain = flushLogChain
    .then(async () => {
      const stored = await chrome.storage.local.get(FLUSH_LOG_KEY);
      await chrome.storage.local.set({ [FLUSH_LOG_KEY]: appendFlushLog(stored[FLUSH_LOG_KEY], entry) });
    })
    .catch(() => undefined);
  return flushLogChain;
}

function dropCachedToken(token: string): Promise<void> {
  return new Promise((resolve) => chrome.identity.removeCachedAuthToken({ token }, () => resolve()));
}

async function markAuthNeeded(): Promise<void> {
  const state = await readSyncEngineState();
  await writeSyncEngineState({ ...state, authNeeded: true });
}

/** Mirror of the sync switch in local storage, kept for readers outside the offscreen database. */
function mirrorSyncOn(on: boolean): void {
  void storageLocalSet({ [ASSISTANT_SYNC_ON_KEY]: on }).catch(() => undefined);
}

/** Tabs measure attention only where capture would run: never incognito, paused, blocked, or sensitive. */
async function dwellAllowed(url: string, sender: chrome.runtime.MessageSender): Promise<boolean> {
  if (!indexPayloadUrlMatchesTab(url, sender)) return false;
  return passesIndexGate(url, sender);
}

async function passesIndexGate(url: string, sender: chrome.runtime.MessageSender): Promise<boolean> {
  const gate = await shouldSkipIndexing(url, sender).catch(() => ({ skip: true as const }));
  return !gate.skip;
}

/** The page each tab was last cleared to measure, so its final report still counts after the address moves on. */
const DWELL_PAGES_KEY = "cortex_dwell_pages";

async function rememberDwellPage(tabId: number, url: string): Promise<void> {
  const stored = await chrome.storage.session.get(DWELL_PAGES_KEY);
  const pages = (stored[DWELL_PAGES_KEY] ?? {}) as Record<string, string>;
  pages[tabId] = url;
  await chrome.storage.session.set({ [DWELL_PAGES_KEY]: pages });
}

async function dwellReportAllowed(tabId: number, report: DwellMessage, sender: chrome.runtime.MessageSender): Promise<boolean> {
  const stored = await chrome.storage.session.get(DWELL_PAGES_KEY);
  const measured = ((stored[DWELL_PAGES_KEY] ?? {}) as Record<string, string>)[tabId];
  if (!dwellReportPageOk(report, sender.tab?.url, measured)) return false;
  return passesIndexGate(report.url, sender);
}

const LOCAL_DWELL_KEY = "cortex_local_dwell";
let localDwellChain: Promise<unknown> = Promise.resolve();

/**
 * Reports are handled one at a time in arrival order, so a final report never
 * lands before an earlier one and no time is counted twice. The new part of
 * each report goes to the page's reading time; session storage survives worker restarts.
 */
function handleDwellReport(tabId: number, report: DwellMessage, sender: chrome.runtime.MessageSender): void {
  localDwellChain = localDwellChain
    .then(async () => {
      if (!(await dwellReportAllowed(tabId, report, sender))) return;
      onDwellReport(tabId, report);
      const stored = await chrome.storage.session.get(LOCAL_DWELL_KEY);
      const ledger = (stored[LOCAL_DWELL_KEY] ?? {}) as DwellLedger;
      if (await applyDwellReport(ledger, tabId, report)) onIndexCommitted();
      await chrome.storage.session.set({ [LOCAL_DWELL_KEY]: ledger });
    })
    .catch(() => undefined);
}

function forgetLocalDwell(tabId: number): void {
  localDwellChain = localDwellChain
    .then(async () => {
      const stored = await chrome.storage.session.get(LOCAL_DWELL_KEY);
      const map = (stored[LOCAL_DWELL_KEY] ?? {}) as DwellLedger;
      const pages = ((await chrome.storage.session.get(DWELL_PAGES_KEY))[DWELL_PAGES_KEY] ?? {}) as Record<string, string>;
      delete pages[tabId];
      await chrome.storage.session.set({ [DWELL_PAGES_KEY]: pages });
      if (!(tabId in map)) return;
      delete map[tabId];
      await chrome.storage.session.set({ [LOCAL_DWELL_KEY]: map });
    })
    .catch(() => undefined);
}

/**
 * One pass in the offscreen document. On a 401 the cached token is dropped and the
 * pass runs once more with a fresh silent token; a second refusal pauses sync until
 * the user reconnects from Settings.
 */
async function forwardAssistantSync(
  action: SyncWorkAction,
  tokenFromPage?: string,
  answer: SyncWorkAnswer = {}
): Promise<SyncWorkReply> {
  try {
    if (action === "disable") {
      const reply = await sendSyncWork("disable", "");
      mirrorSyncOn(false);
      await chrome.alarms.clear(ASSISTANT_SYNC_SOON_ALARM);
      return reply.ok === false ? reply : { ok: true, status: "disabled" };
    }
    if (action === "cleanup" && answer.cleanup !== "trash") return sendSyncWork("cleanup", "", answer);
    if (action === "pages" && answer.pages !== "undo") return sendSyncWork("pages", "", answer);
    let token = action === "enable" ? tokenFromPage : await silentDriveToken().catch(() => "");
    if (!token) {
      if (action !== "enable" && action !== "cleanup" && action !== "pages") await markAuthNeeded();
      return { ok: false, status: "auth", error: "Sign in to Google is needed before Cortex can sync." };
    }
    if (action === "enable") mirrorSyncOn(true);
    let reply = await sendSyncWork(action, token, answer);
    if (reply.authFailed) {
      await dropCachedToken(token);
      token = await silentDriveToken().catch(() => "");
      reply = token ? await sendSyncWork(action, token, answer) : reply;
      if (reply.authFailed || !token) await markAuthNeeded();
    }
    if (reply.confirm) mirrorSyncOn((await readSyncEngineState()).syncEnabled);
    if (reply.retryAt) await scheduleFlushAlarm(reply.retryAt);
    return reply;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync did not start.";
    const state = await readSyncEngineState();
    await writeSyncEngineState({ ...state, lastError: message });
    return { ok: false, error: message };
  }
}

/** Moves the one-shot flush alarm earlier, never later. */
async function scheduleFlushAlarm(at: number): Promise<number> {
  const existing = await chrome.alarms.get(ASSISTANT_SYNC_SOON_ALARM);
  if (existing && existing.scheduledTime <= at && existing.scheduledTime > Date.now()) return existing.scheduledTime;
  await chrome.alarms.create(ASSISTANT_SYNC_SOON_ALARM, { when: Math.max(at, Date.now() + 1_000) });
  return at;
}

/** Sets the next flush for a reason. Returns its time, or null while sync cannot run. */
async function planAssistantFlush(reason: FlushReason): Promise<number | null> {
  const state = await readSyncEngineState();
  const at = plannedFlushAt(state, reason, Date.now());
  if (at == null) return null;
  return scheduleFlushAlarm(at);
}

let assistantSyncRunning: Promise<SyncWorkReply> | null = null;

/** One pass at a time. A second caller shares the pass already running. */
function runAssistantSyncPass(action: "alarm" | "now"): Promise<SyncWorkReply> {
  if (assistantSyncRunning) return assistantSyncRunning;
  assistantSyncRunning = (async () => {
    const state = await readSyncEngineState();
    if (!state.syncEnabled) return { ok: false, status: "disabled" };
    if (state.authNeeded) return { ok: false, status: "auth" };
    return forwardAssistantSync(action);
  })().finally(() => {
    assistantSyncRunning = null;
  });
  return assistantSyncRunning;
}

const OPEN_VISITS_KEY = "cortex_assist_open_visits";
/** A tab that has not reported for this long is treated as left. */
const OPEN_VISIT_STALE_MS = 60 * 60_000;

interface OpenVisit {
  id: string;
  url: string;
  /** The tab's address when the visit opened. A LinkedIn payload can name the profile by another URL. */
  tabUrl?: string;
  activeMs: number | null;
  maxScrollPct: number | null;
  seenAt: number;
}

let openVisitsChain: Promise<unknown> = Promise.resolve();

/** Serialized read-modify-write of the open visit map in session storage. */
function withOpenVisits<T>(edit: (visits: Record<string, OpenVisit>) => T): Promise<T> {
  const run = openVisitsChain.then(async () => {
    const stored = await chrome.storage.session.get(OPEN_VISITS_KEY);
    const visits = (stored[OPEN_VISITS_KEY] ?? {}) as Record<string, OpenVisit>;
    const out = edit(visits);
    await chrome.storage.session.set({ [OPEN_VISITS_KEY]: visits });
    return out;
  });
  openVisitsChain = run.catch(() => undefined);
  return run;
}

/** Ends visits in the offscreen database, then plans an activity flush when any row became final. */
async function finalizeVisits(ended: OpenVisit[], abandonedBefore?: number, keep: string[] = []): Promise<void> {
  if (!ended.length && abandonedBefore == null) return;
  await ensureOffscreen();
  const reply = await sendToOffscreen<{ ok?: boolean; finalized?: number }>({
    type: "CORTEX_ASSISTANT_SYNC_FINALIZE",
    visits: ended.map(({ id, activeMs, maxScrollPct }) => ({ id, activeMs, maxScrollPct })),
    keep,
    ...(abandonedBefore != null ? { abandonedBefore } : {}),
  });
  if ("finalized" in reply && (reply.finalized ?? 0) > 0) await planAssistantFlush("activity");
}

function endTabVisit(tabId: number): void {
  void withOpenVisits((visits) => {
    const visit = visits[tabId];
    delete visits[tabId];
    return visit;
  })
    .then((visit) => (visit ? finalizeVisits([visit]) : undefined))
    .catch(() => undefined);
}

/** Safety alarm housekeeping: ends visits whose tab is gone or silent, and rows left open by a restart. */
async function finalizeStaleVisits(): Promise<void> {
  const tabs = new Set((await chrome.tabs.query({})).map((tab) => String(tab.id)));
  const now = Date.now();
  const { ended, keep } = await withOpenVisits((visits) => {
    const out: OpenVisit[] = [];
    for (const [tabId, visit] of Object.entries(visits)) {
      if (tabs.has(tabId) && now - visit.seenAt < OPEN_VISIT_STALE_MS) continue;
      out.push(visit);
      delete visits[tabId];
    }
    return { ended: out, keep: Object.values(visits).map((visit) => visit.id) };
  });
  await finalizeVisits(ended, now - OPEN_VISIT_STALE_MS, keep);
}

function onDwellReport(tabId: number, report: { url: string; activeMs: number; maxScrollPct: number; final: boolean }): void {
  void withOpenVisits((visits) => {
    const visit = visits[tabId];
    if (!visit || !(samePage(visit.url, report.url) || (visit.tabUrl && samePage(visit.tabUrl, report.url)))) return null;
    visit.activeMs = Math.max(visit.activeMs ?? 0, report.activeMs);
    visit.maxScrollPct = Math.max(visit.maxScrollPct ?? 0, report.maxScrollPct);
    visit.seenAt = Date.now();
    if (!report.final) return null;
    delete visits[tabId];
    return visit;
  })
    .then((visit) => (visit ? finalizeVisits([visit]) : undefined))
    .catch(() => undefined);
}

/**
 * Stores the page as an open visit. A tab keeps one visit id per page, so re-indexing
 * the same page (LinkedIn capture retries, SPA re-reads) updates one row. Moving to a
 * new page ends the previous visit.
 */
async function captureAssistantSyncVisit(visit: {
  id: string;
  url: string;
  title: string;
  visitedAt: number;
  tabId?: number;
  tabUrl?: string;
  pageText?: string;
  linkedInFields?: Record<string, unknown> | null;
}): Promise<void> {
  const state = await readSyncEngineState();
  if (!state.syncEnabled) return;
  const { tabId, tabUrl, ...rest } = visit;
  const launch = await readAssistantSyncLaunch();
  const ownIds = { fileId: launch.fileId, folderId: launch.folderId, pagesFolderId: launch.pagesFolderId };
  let row: Record<string, unknown> = { ...rest, ownIds, open: false };
  let previous: OpenVisit | undefined;
  if (tabId != null) {
    // A hash or a dropped query key is the same page, not a new visit.
    const page = canonicalizeUrl(visit.url) ?? visit.url;
    const id = await withOpenVisits((visits) => {
      const current = visits[tabId];
      if (current && (canonicalizeUrl(current.url) ?? current.url) === page) {
        current.seenAt = Date.now();
        return current.id;
      }
      previous = current;
      visits[tabId] = {
        id: visit.id,
        url: visit.url,
        ...(tabUrl && tabUrl !== visit.url ? { tabUrl } : {}),
        activeMs: null,
        maxScrollPct: null,
        seenAt: Date.now(),
      };
      return visit.id;
    });
    row = { ...rest, ownIds, id, open: true };
  }
  await ensureOffscreen();
  await sendToOffscreen({ type: "CORTEX_ASSISTANT_SYNC_CAPTURE", visit: row });
  if (previous) await finalizeVisits([previous]);
  else if (tabId == null) await planAssistantFlush("activity");
}

chrome.tabs.onRemoved.addListener((tabId) => {
  setTimeout(() => {
    endTabVisit(tabId);
    forgetLocalDwell(tabId);
  }, FINAL_REPORT_GRACE_MS);
});

/** Page text sent with a visit. The read part is picked from it when the visit ends. */
const ASSISTANT_SYNC_DRAFT_CHARS = 24_000;

/**
 * A feed post that stayed on screen 2 seconds. Only with "Save text of LinkedIn posts I scroll past"
 * on, sync on, and the page passing the same gate as indexing (pause, block list, sensitive sites).
 */
async function captureFeedPost(post: FeedPostMessage, sender: chrome.runtime.MessageSender): Promise<void> {
  const tabId = sender.tab?.id;
  if (tabId == null) return;
  const stored = await storageLocalGet([ASSISTANT_SYNC_FEED_POSTS_KEY, ASSISTANT_SYNC_ON_KEY]);
  if (stored[ASSISTANT_SYNC_FEED_POSTS_KEY] !== true || stored[ASSISTANT_SYNC_ON_KEY] !== true) return;
  if (!(await dwellAllowed(post.url, sender))) return;
  const launch = await readAssistantSyncLaunch();
  const visitId = await withOpenVisits((visits) => {
    const visit = visits[tabId];
    return visit && samePage(visit.url, post.url) ? visit.id : "";
  });
  await ensureOffscreen();
  await sendToOffscreen({
    type: "CORTEX_ASSISTANT_SYNC_POST",
    post: {
      url: post.url,
      visitId,
      seenAt: post.seenAt,
      author: post.author,
      text: post.text,
      urn: post.urn,
      ownIds: { fileId: launch.fileId, folderId: launch.folderId, pagesFolderId: launch.pagesFolderId },
    },
  });
  await planAssistantFlush("activity");
}

/** The page's own final dwell report usually lands within this window after the URL changes. */
const FINAL_REPORT_GRACE_MS = 1_500;

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  setTimeout(() => {
    // Compare with the tab's address now, not the one in this event: a tab that moves twice inside
    // the grace window (about:blank then the page, a redirect) already has a visit for the new page.
    void chrome.tabs
      .get(tabId)
      .then((tab) => tab.url ?? "", () => "")
      .then((now) => {
        const page = (url: string) => canonicalizeUrl(url) ?? url.split("#")[0] ?? url;
        return withOpenVisits((visits) => {
          const visit = visits[tabId];
          if (!visit || (now && (page(visit.url) === page(now) || (visit.tabUrl && page(visit.tabUrl) === page(now))))) return null;
          delete visits[tabId];
          return visit;
        });
      })
      .then((visit) => (visit ? finalizeVisits([visit]) : undefined))
      .catch(() => undefined);
  }, FINAL_REPORT_GRACE_MS);
});

/** Browser start: session storage is empty, so every open row ends. The sheet is checked once a day. */
async function startAssistantSync(): Promise<void> {
  const state = await readSyncEngineState();
  mirrorSyncOn(state.syncEnabled);
  if (!state.syncEnabled) return;
  if (state.layout && Date.now() - state.layout.verifiedAt >= VERIFY_EVERY_MS) {
    await writeSyncEngineState({ ...state, verifyNext: true });
  }
  await finalizeVisits([], Date.now());
  await planAssistantFlush("startup");
}

async function assistantSyncStatus(): Promise<Record<string, unknown>> {
  const [state, pendingPages, alarm] = await Promise.all([
    readSyncEngineState(),
    countUnsyncedVisits(),
    chrome.alarms.get(ASSISTANT_SYNC_SOON_ALARM),
  ]);
  const now = Date.now();
  const { layout: _layout, ...publicState } = state;
  return {
    ok: true,
    state: publicState,
    pendingPages,
    statusLine: syncStatusLine(state, pendingPages, now),
    nextFlushAt: alarm?.scheduledTime ?? null,
    syncNowAt: state.lastFlushAt + 60_000,
  };
}

setDriveFolderTrashHandler(async () => {
  const launch = await readAssistantSyncLaunch();
  if (!launch.folderId && !launch.fileId) return;
  const token = await silentDriveToken();
  await ensureOffscreen();
  const res = await new Promise<{ ok?: boolean; error?: string; skipped?: boolean } | undefined>((resolve) => {
    chrome.runtime.sendMessage(
      { type: "CORTEX_ASSISTANT_SYNC_TRASH", token, folderId: launch.folderId, fileId: launch.fileId },
      (response) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
        else resolve(response as { ok?: boolean; error?: string; skipped?: boolean } | undefined);
      }
    );
  });
  if (!res?.ok) throw new Error(res?.error || "drive_trash_failed");
  if (!res.skipped) {
    await storageLocalSet({
      [ASSISTANT_SYNC_FOLDER_ID]: null,
      [ASSISTANT_SYNC_FILE_ID]: null,
      [ASSISTANT_SYNC_BACKUP_FILE_ID]: null,
      [ASSISTANT_SYNC_PAGES_FOLDER_ID]: null,
    });
  }
});

function embedViaOffscreen(text: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "CORTEX_EMBED_TEXT", text },
      (res: { ok?: boolean; vec?: number[]; error?: string } | undefined) => {
        if (chrome.runtime.lastError) {
          // #region agent log
          agentDebugLog({
            hypothesisId: "H4",
            location: "service-worker.ts:embedViaOffscreen",
            message: "embed_last_error",
            data: { msg: chrome.runtime.lastError.message },
          });
          // #endregion
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (res?.ok && Array.isArray(res.vec)) {
          resolve(res.vec);
          return;
        }
        // #region agent log
        agentDebugLog({
          hypothesisId: "H4",
          location: "service-worker.ts:embedViaOffscreen",
          message: "embed_bad_response",
          data: { error: res?.error ?? null },
        });
        // #endregion
        reject(new Error(res?.error ?? "embedding failed"));
      }
    );
  });
}

let embedChain = Promise.resolve();

function queueEmbeddingsForChunkIds(
  pairs: { chunkId: number; text: string }[]
): void {
  for (const { chunkId, text } of pairs) {
    embedChain = embedChain
      .then(async () => {
        await ensureOffscreen();
        const vec = await embedViaOffscreen(text.slice(0, 8000));
        await setChunkEmbedding(chunkId, vec, {
          modelId: CORTEX_EMBED_MODEL_ID,
        });
      })
      .catch(async (e) => {
        devLog.warn("[Cortex] chunk embed skipped:", e);
        try {
          await markChunkEmbedFailed(chunkId);
        } catch {
          /* ignore */
        }
      });
  }
}

/**
 * Optional on-device image descriptions (Phase 5.8): the offscreen document
 * asks the Prompt API (image input) about at most 5 images, then the image
 * chunk text gains the descriptions and is embedded again. Never sent to Gemini.
 */
/** One description run per document at a time; re-index passes join it. */
const describingDocs = new Set<number>();

async function describeImagesOnDevice(docId: number, baseText: string, images: ImageInput[]): Promise<void> {
  if (describingDocs.has(docId)) return;
  describingDocs.add(docId);
  try {
    await ensureOffscreen();
    const res = await new Promise<{ descriptions?: { src: string; description: string }[] } | undefined>((resolve) => {
      chrome.runtime.sendMessage({ type: "CORTEX_DESCRIBE_IMAGES", images }, (r) => {
        if (chrome.runtime.lastError) resolve(undefined);
        else resolve(r);
      });
    });
    const descs = Array.isArray(res?.descriptions) ? res.descriptions : [];
    if (!descs.length) return;
    const next = appendDescriptions(
      baseText,
      descs.map((d) => ({ src: d.src, description: redactPII(String(d.description)).redacted }))
    );
    // Later passes may have replaced the chunk: update the current image
    // chunk of this document, and only if its images are still the same.
    const current = (await db.chunks.where("documentId").equals(docId).toArray()).find((c) => c.kind === "image");
    if (current?.id == null || current.text !== baseText) return;
    await db.chunks.update(current.id, { text: next });
    queueEmbeddingsForChunkIds([{ chunkId: current.id, text: next }]);
  } catch (e) {
    devLog.warn("[Cortex] image descriptions skipped:", e);
  } finally {
    describingDocs.delete(docId);
  }
}

/**
 * Chunks restored from a backup (Phase 5.10) come back without embeddings.
 * A storage flag survives service worker restarts; each pass embeds a batch
 * and schedules the next until nothing is pending.
 */
const PENDING_EMBEDS_KEY = "cortex_pending_embeds";

async function drainPendingEmbeddings(): Promise<void> {
  const flag = (await storageLocalGet([PENDING_EMBEDS_KEY]))[PENDING_EMBEDS_KEY];
  if (flag !== true) return;
  const pending = await db.chunks.filter((c) => c.embedState === "pending").limit(500).toArray();
  if (!pending.length) {
    await storageLocalSet({ [PENDING_EMBEDS_KEY]: false });
    return;
  }
  queueEmbeddingsForChunkIds(pending.map((c) => ({ chunkId: c.id!, text: c.text })));
  void embedChain.then(() => drainPendingEmbeddings()).catch(() => undefined);
}

/**
 * Export and backup (Phase 6.7): the library work runs in the offscreen
 * document. Authorization cannot, because only the service worker sees the
 * original sender, so the forwarder below keeps the options-page check and the
 * rate limit, and the privacy gate answers from here too.
 *
 * A ticket is minted per authorized restore and accepted once: it is what
 * stops any other privileged context from driving the gate.
 */
const restoreGateTickets = new Set<string>();

function mintRestoreGateTicket(op: BackupRequestType): string {
  if (op !== "CORTEX_BACKUP_RESTORE") return "";
  const token = crypto.randomUUID();
  restoreGateTickets.add(token);
  return token;
}

function sendBackupWorkToOffscreen(message: BackupWorkMessage): Promise<unknown> {
  return ensureOffscreen()
    .then(
      () =>
        new Promise<unknown>((resolve) => {
          chrome.runtime.sendMessage(message, (r: unknown) => {
            resolve(chrome.runtime.lastError ? undefined : r);
          });
        })
    )
    .catch(() => undefined)
    .finally(() => {
      if (message.token) restoreGateTickets.delete(message.token);
    });
}

/** What the service worker still owns once the offscreen document has written the rows. */
async function finishRestore(): Promise<void> {
  const settings = await getEffectiveSettings();
  await applyRetention(settings.retentionDays);
  await db.digestCache.clear();
  await storageLocalSet({ [PENDING_EMBEDS_KEY]: true });
  void drainPendingEmbeddings();
  await refreshSnapshotNow({}).catch(() => undefined);
}

/** Persist document + chunks + embedding queue + visit log (shared by live indexing and history import). */
/**
 * "Seen this before" (Phase 5.5): after this page's embeddings finish, look
 * for a strongly similar older page and show a chip, at most once per page
 * per day. Only pages that passed the indexing gate get here.
 */
function scheduleResurface(tabId: number, documentId: number, url: string): void {
  void embedChain.then(() => maybeResurface(tabId, documentId, url)).catch(() => undefined);
}

async function maybeResurface(tabId: number, documentId: number, url: string): Promise<void> {
  const settings = await getEffectiveSettings();
  if (!settings.resurfacingEnabled) return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  const sensitive =
    looksSensitiveHostname(parsed.hostname, parsed.pathname) ||
    shouldAlwaysSkipUrl(url, { applyPathPatterns: true }) ||
    isBlockedDomain(parsed.hostname, settings.blocklist);
  const today = dayKey(Date.now());
  const stored = (await storageLocalGet([RESURFACE_SHOWN_KEY]))[RESURFACE_SHOWN_KEY];
  const shown = pruneShownMap((stored as Record<string, string>) ?? {}, today);
  if (sensitive || shown[url] === today) return;

  await ensureOffscreen();
  const res = await new Promise<{ ok?: boolean; best?: SimilarDocument | null } | undefined>((resolve) => {
    chrome.runtime.sendMessage({ type: "CORTEX_RESURFACE_RUN", documentId }, (r) => {
      if (chrome.runtime.lastError) resolve(undefined);
      else resolve(r);
    });
  });
  const best = res?.best;
  if (!best) return;
  if (
    !shouldResurface({
      enabled: settings.resurfacingEnabled,
      similarity: best.similarity,
      currentUrl: url,
      matchUrl: best.url,
      sensitive,
      lastShownDay: shown[url],
      today,
    })
  ) {
    return;
  }
  // The tab must still show this page.
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url || !indexPayloadUrlMatchesTab(url, { tab } as chrome.runtime.MessageSender)) return;
  shown[url] = today;
  await storageLocalSet({ [RESURFACE_SHOWN_KEY]: shown });
  await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ["resurface-chip.js"] });
  await chrome.tabs
    .sendMessage(tabId, { type: "CORTEX_RESURFACE_SHOW", title: best.title, url: best.url }, { frameId: 0 })
    .catch(() => undefined);
}

async function commitIndexPayload(
  p: IndexPayload,
  opts: { tabId?: number; tabUrl?: string; extraChunks?: NewChunk[]; imageInputs?: ImageInput[]; replaceKinds?: ChunkKind[] } = {}
): Promise<{
  id: number;
  chunks: number;
}> {
  const headroom = await ensureIndexingHeadroom();
  if (!headroom.ok) {
    throw new CortexError(ERROR_CODES.STORAGE_FULL);
  }

  const domain = hostnameFromUrl(p.url);
  const docId = await upsertDocument({
    url: p.url,
    domain,
    title: p.title,
    summary: p.summary,
    lastVisitedAt: p.visitedAt,
  });

  const parts: NewChunk[] = [
    ...chunkArticle(p.text).map((c) => ({ ord: c.ord, text: c.text })),
    ...(opts.extraChunks ?? []),
  ];
  // Image descriptions (Phase 5.8): keep stored ones when the images did not
  // change, so re-index passes do not ask the model again.
  const imageIdx = parts.findIndex((c) => c.kind === "image");
  let describe = imageIdx >= 0 && (opts.imageInputs?.length ?? 0) > 0;
  if (describe) {
    const prev = (await db.chunks.where("documentId").equals(docId).toArray()).find((c) => c.kind === "image");
    const kept = reuseDescribedText(prev?.text, parts[imageIdx]!.text);
    if (kept) {
      parts[imageIdx] = { ...parts[imageIdx]!, text: kept };
      describe = false;
    }
  }
  // Live page visits rewrite text, table and image chunks; transcript,
  // highlight and PDF chunks of the same document are kept.
  const chunkIds = await replaceChunksForDocument(
    docId,
    parts,
    opts.replaceKinds ? { kinds: opts.replaceKinds } : opts.extraChunks ? { kinds: ["text", "table", "image"] } : {}
  );

  const embedPairs = chunkIds.map((id, i) => ({
    chunkId: id,
    text: parts[i]?.text ?? "",
  }));
  queueEmbeddingsForChunkIds(embedPairs);
  if (opts.tabId != null) scheduleResurface(opts.tabId, docId, p.url);
  if (describe && opts.imageInputs) void describeImagesOnDevice(docId, parts[imageIdx]!.text, opts.imageInputs);

  await appendVisit({
    url: p.url,
    title: p.title,
    hostname: domain,
    visitedAt: p.visitedAt,
    textLength: p.text.length,
  });
  const detail = p.person ? sanitizePersonDetail(p.person) : null;
  const linkedInFields =
    p.person && (p.person.kind === "person" || p.person.kind === "company") && p.person.name.trim()
      ? {
          kind: p.person.kind,
          name: p.person.name,
          headline: p.person.headline,
          company: p.person.company,
          profileUrl: p.person.profileUrl,
          // Labeled profile fields for the Pages doc. Never the photo, contact info, or messages.
          ...(p.person.kind === "person"
            ? {
                location: detail?.location,
                about: detail?.about,
                aboutTruncated: detail?.aboutTruncated === true,
                experience: detail?.experience ?? [],
                education: detail?.education ?? [],
                schools: detail?.schools ?? [],
                skills: detail?.skills ?? [],
                publicView: detail?.publicView === true,
                detailsPage: detail?.detailsPage,
              }
            : {}),
        }
      : null;
  void captureAssistantSyncVisit({
    id: `doc:${docId}:${p.visitedAt}`,
    url: p.url,
    title: p.title,
    visitedAt: p.visitedAt,
    tabId: opts.tabId ?? undefined,
    tabUrl: opts.tabUrl,
    pageText: p.text.slice(0, ASSISTANT_SYNC_DRAFT_CHARS),
    linkedInFields,
  }).catch(() => undefined);

  onIndexCommitted();
  return { id: docId, chunks: chunkIds.length };
}

/** Readable text of a fetched history page. The offscreen document parses it; the worker has no DOM. */
async function extractHistoryHtmlViaOffscreen(html: string, url: string): Promise<{ title: string; text: string } | null> {
  await ensureOffscreen();
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "CORTEX_HISTORY_EXTRACT", html, url },
      (r: { ok?: boolean; title?: unknown; text?: unknown } | undefined) => {
        if (chrome.runtime.lastError || !r?.ok) resolve(null);
        else resolve({ title: String(r.title ?? ""), text: String(r.text ?? "") });
      }
    );
  });
}

let historyImportAbortRequested = false;

const HISTORY_IMPORT_SENDER = {} as chrome.runtime.MessageSender;

async function runHistoryImportJob(
  daysBack: number,
  maxAttempts: number
): Promise<void> {
  const startedAt = Date.now();
  historyImportAbortRequested = false;

  await writeHistoryImportProgress({
    ...HISTORY_IMPORT_IDLE,
    running: true,
    startedAt,
    finishedAt: undefined,
    total: maxAttempts,
    processed: 0,
    indexed: 0,
    skipped: 0,
    fetchFailed: 0,
    lastUrl: undefined,
    error: undefined,
  });

  try {
    const startTime = Date.now() - daysBack * 86400000;
    const raw = await historySearch({
      text: "",
      startTime,
      maxResults: Math.min(Math.max(maxAttempts * 20, 50), 2500),
    });
    const deduped = dedupeHistoryItems(raw);

    const slice = deduped.slice(0, maxAttempts);

    let processed = 0;
    let indexed = 0;
    let skipped = 0;
    let fetchFailed = 0;

    let nextIndex = 0;
    const concurrency = Math.min(
      HISTORY_IMPORT_FETCH_CONCURRENCY,
      Math.max(1, slice.length)
    );

    async function processHistoryItem(
      item: (typeof deduped)[number]
    ): Promise<void> {
      try {
        const gate = await shouldSkipIndexing(item.url, HISTORY_IMPORT_SENDER, {
          bypassIndexingPause: true,
          historyImport: true,
        });
        if (gate.skip) {
          skipped++;
          return;
        }

        let extractedTitle = "";
        let extractedText = "";
        if (!isHistoryFetchAllowedUrl(item.url)) {
          skipped++;
          return;
        }

        const html = await fetchHtmlForHistory(item.url);
        const rawExtract = html ? await extractHistoryHtmlViaOffscreen(html, item.url) : null;
        if (rawExtract) {
          const titleRed = redactPII(rawExtract.title);
          const textRed = redactPII(rawExtract.text);
          extractedTitle = titleRed.redacted;
          extractedText = textRed.redacted;
        } else {
          fetchFailed++;
        }

        const composed = composeHistoryIndexText(item, extractedText);
        const composedRed = redactPII(composed);
        const text = composedRed.redacted.trim();
        if (text.length < MIN_HISTORY_IMPORT_TEXT_CHARS) {
          skipped++;
          return;
        }

        let hostLabel = item.url;
        try {
          hostLabel = new URL(item.url).hostname;
        } catch {
          /* ignore */
        }
        const title =
          extractedTitle || item.title.trim() || hostLabel || item.url;

        const summary =
          extractedText.length >= minCharsForUrl(item.url)
            ? await summarizeBestEffort(extractedText)
            : title;

        const payload: IndexPayload = {
          url: item.url,
          title,
          text,
          summary,
          visitedAt: item.visitedAt,
        };

        await commitIndexPayload(payload);
        indexed++;
      } catch (e) {
        devLog.warn("[Cortex] history import row:", item.url, e);
        skipped++;
      }
    }

    async function historyWorker(): Promise<void> {
      while (!historyImportAbortRequested) {
        const i = nextIndex++;
        if (i >= slice.length) break;
        const item = slice[i]!;
        processed++;
        await processHistoryItem(item);
        await writeHistoryImportProgress({
          processed,
          indexed,
          skipped,
          fetchFailed,
          lastUrl: item.url,
        });
      }
    }

    await Promise.all(
      Array.from({ length: concurrency }, () => historyWorker())
    );

    await writeHistoryImportProgress({
      running: false,
      finishedAt: Date.now(),
      processed,
      indexed,
      skipped,
      fetchFailed,
      lastUrl: undefined,
    });
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    devLog.warn("[Cortex] history import job:", errMsg);
    await writeHistoryImportProgress({
      running: false,
      finishedAt: Date.now(),
      error: errMsg,
    });
  }
}

/** Runs BM25 + hybrid retrieval inside the offscreen document (stable lifetime). */
function searchViaOffscreen(
  query: string,
  opts?: { collectionId?: number; from?: number; to?: number; exact?: string; site?: string }
): Promise<
  | { ok: true; hits: SearchHitDTO[]; evidence?: string }
  | { ok: false; error: string }
> {
  return new Promise((resolve) => {
    void ensureOffscreen()
      .then(() => {
        chrome.runtime.sendMessage(
          {
            type: "CORTEX_SEARCH_RUN",
            query,
            ...(opts?.collectionId != null ? { collectionId: opts.collectionId } : {}),
            ...(opts?.from != null && opts.to != null ? { from: opts.from, to: opts.to } : {}),
            ...(opts?.exact ? { exact: opts.exact } : {}),
            ...(opts?.site ? { site: opts.site } : {}),
          },
          (
            res:
              | {
                  ok?: boolean;
                  hits?: SearchHitDTO[];
                  evidence?: string;
                  error?: string;
                }
              | undefined
          ) => {
            if (chrome.runtime.lastError) {
              resolve({
                ok: false,
                error:
                  chrome.runtime.lastError.message ??
                  "Could not reach search runtime.",
              });
              return;
            }
            if (res?.ok === false) {
              resolve({
                ok: false,
                error: res.error ?? "Search failed.",
              });
              return;
            }
            resolve({
              ok: true,
              hits: res?.hits ?? [],
              evidence: res?.evidence,
            });
          }
        );
      })
      .catch((e) => {
        resolve({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      });
  });
}

async function shouldSkipIndexing(
  urlStr: string,
  sender: chrome.runtime.MessageSender,
  opts?: { bypassIndexingPause?: boolean; historyImport?: boolean }
): Promise<{ skip: true; reason: string } | { skip: false }> {
  const settings = await getEffectiveSettings();
  // Policy indexingDisabled wins over every bypass (history import included).
  if (settings.policy.indexingDisabled === true) {
    return { skip: true, reason: "managed_indexing_disabled" };
  }
  // Affirmative consent required before any browsing-activity collection.
  if (!(await hasIndexingConsent())) {
    return { skip: true, reason: "no_indexing_consent" };
  }
  if (settings.indexingPaused && !opts?.bypassIndexingPause) {
    return { skip: true, reason: "paused" };
  }

  if (sender.tab?.incognito) {
    return { skip: true, reason: "incognito" };
  }

  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return { skip: true, reason: "bad_url" };
  }

  if (
    shouldAlwaysSkipUrl(urlStr, {
      applyPathPatterns: opts?.historyImport !== true,
    })
  ) {
    return { skip: true, reason: "always_skip_registry" };
  }

  const host = url.hostname.toLowerCase();

  if (settings.allowlistOnly) {
    const ok = settings.allowlist.some((h) => {
      const x = h.trim().toLowerCase();
      return x && (host === x || host.endsWith(`.${x}`));
    });
    if (!ok) return { skip: true, reason: "allowlist" };
  }

  if (isBlockedDomain(host, settings.blocklist)) {
    return { skip: true, reason: "blocklist" };
  }

  if (looksSensitiveHostname(host, url.pathname)) {
    return { skip: true, reason: "sensitive_heuristic" };
  }

  return { skip: false };
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deliverOpenSearchMessage(
  tabId: number,
  docked = false
): Promise<boolean> {
  const msg = { type: "CORTEX_OPEN_SEARCH" as const, docked };
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, (res) => {
      if (chrome.runtime.lastError) {
        resolve(false);
        return;
      }
      resolve((res as { ok?: boolean } | undefined)?.ok === true);
    });
  });
}

/** Injects overlay.js on demand, then opens it. content.js stays extraction-only. */
async function openSearchOnTab(
  tabId: number,
  options?: { docked?: boolean }
): Promise<boolean> {
  const docked = options?.docked === true;
  return openOverlayOnTab(tabId, {
    deliverOpen: (id) => deliverOpenSearchMessage(id, docked),
    inject: async (id, files) => {
      await chrome.scripting.executeScript({ target: { tabId: id }, files });
    },
    sleep: sleepMs,
    isInjectableUrl: isInjectableWebUrl,
    getTabUrl: async (id) => {
      try {
        const tab = await chrome.tabs.get(id);
        return tab.url ?? "";
      } catch {
        return null;
      }
    },
  });
}

function queryActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        resolve(undefined);
        return;
      }
      resolve(tabs[0]);
    });
  });
}

/** Popup “Open search” and keyboard shortcut. */
let openCortexSearchInFlight = false;
let openCortexSearchUnlockTimer: ReturnType<typeof setTimeout> | undefined;

async function withOpenCortexSearchGuard(
  fn: () => Promise<void>
): Promise<void> {
  if (openCortexSearchInFlight) return;
  openCortexSearchInFlight = true;
  try {
    await fn();
  } finally {
    clearTimeout(openCortexSearchUnlockTimer);
    openCortexSearchUnlockTimer = setTimeout(() => {
      openCortexSearchInFlight = false;
    }, 450);
  }
}

async function openCortexSearchFromShortcut(): Promise<void> {
  const tab = await queryActiveTab();
  if (!tab) return;
  setActiveTabSnapshot(tab);
  await openCortexSearchForTab(tab, openSearchOnTab, {
    // Apps that pull the caret back into their own editor (claude.ai and
    // friends) get the side panel, where typing always works.
    userPreference: (await getEffectiveSettings()).panelPreference,
    userGesture: true,
  });
}

addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const message = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
  // Chrome answers in-flight extension API calls with this after the worker stops.
  if (message === "No SW") event.preventDefault();
});

installActiveTabCacheListeners();
// Side panel setup waits for onInstalled / onStartup. Calling it while this
// script is still evaluating rejects with "No SW" because Chrome has not
// registered the worker yet.

/** Toolbar icon — open search immediately (no stats popup). */
function openCortexSearchFromToolbarClick(tab: chrome.tabs.Tab): void {
  void withOpenCortexSearchGuard(async () => {
    if (tab.windowId == null) {
      await openCortexSearchFromShortcut();
      return;
    }
    setActiveTabSnapshot(tab);
    await openCortexSearchForTab(tab, openSearchOnTab, {
      // Apps that pull the caret back into their own editor (claude.ai and
      // friends) get the side panel, where typing always works.
      userPreference: (await getEffectiveSettings()).panelPreference,
      userGesture: true,
    });
  });
}

chrome.action.onClicked.addListener((tab) => {
  openCortexSearchFromToolbarClick(tab);
});

/** Stagger tab kicks to stay under per-domain index rate limits (~30/min). */
const FIRST_INSTALL_OPEN_TAB_STAGGER_MS = 2200;
const FIRST_INSTALL_MAX_OPEN_TABS = 28;

function tabSendMessage(tabId: number, message: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message as object, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

async function primeOpenTabsAfterInstall(): Promise<void> {
  let tabs: chrome.tabs.Tab[];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }

  const eligible = tabs.filter((t) => {
    if (t.id == null || t.discarded) return false;
    if (t.incognito) return false;
    const u = t.url ?? "";
    return u.startsWith("http://") || u.startsWith("https://");
  });

  let kicked = 0;
  for (const tab of eligible) {
    if (kicked >= FIRST_INSTALL_MAX_OPEN_TABS) break;
    const tabId = tab.id!;
    kicked++;

    try {
      await tabSendMessage(tabId, { type: "CORTEX_FORCE_INDEX_NOW" });
    } catch {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["content.js"],
        });
        await tabSendMessage(tabId, { type: "CORTEX_FORCE_INDEX_NOW" });
      } catch {
        /* chrome://, PDF viewer, blocked pages, etc. */
      }
    }

    await new Promise<void>((resolve) =>
      setTimeout(resolve, FIRST_INSTALL_OPEN_TAB_STAGGER_MS)
    );
  }
}

function isConsentUiSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== undefined && sender.id !== chrome.runtime.id) return false;
  const u = sender.url ?? "";
  return (
    u.startsWith(chrome.runtime.getURL("onboarding.html")) ||
    u.startsWith(chrome.runtime.getURL("options.html")) ||
    u.startsWith(chrome.runtime.getURL("popup.html")) ||
    isPrivilegedExtensionSender(sender)
  );
}

async function hasIndexingConsent(): Promise<boolean> {
  try {
    const r = await storageLocalGet([INDEXING_CONSENT_KEY]);
    return Boolean(r[INDEXING_CONSENT_KEY]);
  } catch {
    return false;
  }
}

/** Existing installs already indexed before the consent gate shipped. */
async function grandfatherIndexingConsentIfNeeded(): Promise<void> {
  try {
    const r = await storageLocalGet([
      INDEXING_CONSENT_KEY,
      FIRST_INSTALL_BACKFILL_DONE_KEY,
      ONBOARDING_DONE_KEY,
    ]);
    if (r[INDEXING_CONSENT_KEY]) return;
    if (r[FIRST_INSTALL_BACKFILL_DONE_KEY] || r[ONBOARDING_DONE_KEY]) {
      await storageLocalSet({ [INDEXING_CONSENT_KEY]: Date.now() });
    }
  } catch {
    /* ignore */
  }
}

async function grantIndexingConsent(): Promise<void> {
  await storageLocalSet({ [INDEXING_CONSENT_KEY]: Date.now() });
}

/**
 * Runs only after affirmative UI consent. History backfill + open-tab priming
 * are one-shot (FIRST_INSTALL_BACKFILL_DONE_KEY).
 */
async function maybeRunFirstInstallBackfill(): Promise<void> {
  try {
    if (!(await hasIndexingConsent())) return;

    const r = await storageLocalGet([FIRST_INSTALL_BACKFILL_DONE_KEY]);
    if (r[FIRST_INSTALL_BACKFILL_DONE_KEY]) return;

    await storageLocalSet({
      [FIRST_INSTALL_BACKFILL_DONE_KEY]: Date.now(),
    });

    notifyFirstInstallHistoryScanStarted();

    void primeOpenTabsAfterInstall().catch((err: unknown) => {
      devLog.warn("[Cortex] first-install open-tab indexing:", err);
    });

    try {
      await runHistoryImportJob(
        FIRST_INSTALL_HISTORY_DAYS,
        FIRST_INSTALL_HISTORY_MAX_URLS
      );
    } catch (err: unknown) {
      devLog.warn("[Cortex] first-install history import:", err);
    }

    const progress = await readHistoryImportProgress();
    notifyFirstInstallHistoryScanFinished(progress);
  } catch {
    /* ignore */
  }
}

async function writeInitialStatsSnapshot(): Promise<void> {
  try {
    const snap = await computeFreshSnapshot();
    await writeSnapshot(snap);
  } catch (e: unknown) {
    devLog.warn("[Cortex] initial stats snapshot:", e);
  }
}

const CONTENT_SCRIPT_PING_MS = 150;

function pingContentScript(tabId: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), CONTENT_SCRIPT_PING_MS);
    chrome.tabs.sendMessage(tabId, { type: "CORTEX_PING" }, (res) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        resolve(false);
        return;
      }
      const ok =
        typeof res === "object" &&
        res !== null &&
        (res as { ok?: boolean }).ok === true;
      resolve(ok);
    });
  });
}

async function warmContentScriptOnTab(tabId: number, url: string): Promise<void> {
  if (!isInjectableWebUrl(url)) return;
  if (await pingContentScript(tabId)) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  } catch {
    /* chrome://, PDF viewer, restricted pages */
  }
}

/**
 * Tabs whose side panel shows the setup guide. The restricted-page handlers below would
 * otherwise point a new tab's panel back at search. Session storage keeps them across restarts.
 */
const guideTabs = new Set<number>();
void chrome.storage.session
  .get(GUIDE_KEY)
  .then((got) => {
    for (const key of Object.keys((got[GUIDE_KEY] as Record<string, unknown> | undefined) ?? {})) {
      const id = Number(key.replace(/^tab:/, ""));
      if (Number.isInteger(id)) guideTabs.add(id);
    }
  })
  .catch(() => undefined);
chrome.tabs.onRemoved.addListener((tabId) => guideTabs.delete(tabId));

function panelForRestrictedTab(tabId: number, url: string | undefined): void {
  if (!guideTabs.has(tabId)) enableSidePanelForRestrictedTab(tabId, url);
}

chrome.tabs.onActivated.addListener((activeInfo) => {
  void chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (chrome.runtime.lastError || tab?.id == null) return;
    const url = tab.url ?? "";
    panelForRestrictedTab(tab.id, url);
    void warmContentScriptOnTab(activeInfo.tabId, url);
  });
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (tab.id == null) return;
  if (changeInfo.url != null || changeInfo.status === "complete") {
    panelForRestrictedTab(tab.id, tab.url ?? changeInfo.url);
  }
  if (
    tab.id != null &&
    isInjectableWebUrl(tab.url ?? changeInfo.url) &&
    changeInfo.status === "complete"
  ) {
    void warmContentScriptOnTab(tab.id, tab.url ?? "");
  }
});

/**
 * PDFs (Phase 5.9): content scripts do not run in Chrome's PDF viewer, so PDF
 * tabs are picked up here. indexPdfTab runs the toggle and the full privacy
 * gate before the offscreen document fetches anything.
 */
async function pdfAlreadyIndexed(url: string): Promise<boolean> {
  const doc = await db.documents.where("url").equals(url).first();
  if (doc?.id == null) return false;
  return (await db.chunks.where("documentId").equals(doc.id).filter((c) => c.kind === "pdf").count()) > 0;
}

function extractPdfViaOffscreen(url: string): Promise<PdfExtractResult> {
  return ensureOffscreen().then(
    () =>
      new Promise<PdfExtractResult>((resolve) => {
        chrome.runtime.sendMessage({ type: "CORTEX_PDF_EXTRACT", url }, (r: PdfExtractResult | undefined) => {
          if (chrome.runtime.lastError || !r) resolve({ ok: false, reason: "offscreen_unavailable" });
          else resolve(r);
        });
      })
  );
}

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url || !isPdfUrl(tab.url)) return;
  void indexPdfTab(
    { url: tab.url, incognito: tab.incognito === true },
    {
      pdfEnabled: async () => (await getEffectiveSettings()).pdfEnabled,
      gate: (url, incognito) => shouldSkipIndexing(url, { tab: { incognito } } as chrome.runtime.MessageSender),
      alreadyIndexed: pdfAlreadyIndexed,
      extract: extractPdfViaOffscreen,
      commit: (payload, chunks) =>
        commitIndexPayload(payload as IndexPayload, { extraChunks: chunks, replaceKinds: ["pdf"] }),
    }
  )
    .then((r) => devLog.info("[Cortex] pdf:", r))
    .catch((e) => devLog.warn("[Cortex] pdf index failed:", e));
});

chrome.runtime.onInstalled.addListener((details) => {
  void getUserSettings().catch(() => undefined);
  void import("../shared/gemini-api-key")
    .then((m) => m.ensureGeminiKeyTrustedAccess().then(() => m.migrateLegacyGeminiApiKey()))
    .catch(() => undefined);
  devLog.info("[Cortex] installed: local-only indexing (chunk-level)");
  scheduleStorageMaintenanceAlarm();

  configureSidePanelBehavior();
  enableGlobalSidePanel();

  if (details.reason === "install" || details.reason === "update") {
    void closeOffscreenDocument();
    void writeInitialStatsSnapshot();
  }
  void startAssistantSync().catch(() => undefined);

  if (details.reason === "update") {
    void grandfatherIndexingConsentIfNeeded();
  }

  if (details.reason === "install") {
    // Do not start history backfill or live indexing until the user agrees
    // on the welcome page (INDEXING_CONSENT_KEY).
    void storageLocalGet("cortex_installed_at")
      .then((r) => {
        if (typeof r.cortex_installed_at === "number") return;
        return storageLocalSet({ cortex_installed_at: Date.now() });
      })
      .catch(() => undefined);
    void storageLocalGet([ONBOARDING_DONE_KEY])
      .then((r) => {
        if (r[ONBOARDING_DONE_KEY]) return;
        return chrome.tabs.create({
          url: chrome.runtime.getURL("onboarding.html"),
          active: true,
        });
      })
      .catch(() => undefined);
  }
});

chrome.runtime.onStartup.addListener(() => {
  void getUserSettings().catch(() => undefined);
  void import("../shared/gemini-api-key")
    .then((m) => m.ensureGeminiKeyTrustedAccess().then(() => m.migrateLegacyGeminiApiKey()))
    .catch(() => undefined);
  void grandfatherIndexingConsentIfNeeded();
  scheduleStorageMaintenanceAlarm();
  configureSidePanelBehavior();
  enableGlobalSidePanel();
  void startAssistantSync().catch(() => undefined);
});

function quietChrome(result: unknown): void {
  const pending = result as { catch?: (onReject: () => void) => unknown } | null | undefined;
  if (pending && typeof pending.catch === "function") void pending.catch(() => undefined);
}

function scheduleStorageMaintenanceAlarm(): void {
  void syncContextMenus().catch(() => undefined);
  quietChrome(chrome.alarms.create(ASSISTANT_SYNC_ALARM, { periodInMinutes: ASSISTANT_SYNC_ALARM_PERIOD_MIN }));
  quietChrome(chrome.alarms.create("cortex-evict-storage", { periodInMinutes: 360 }));
  // Phase 4.2: daily retention sweep (no-op while retention is off).
  quietChrome(chrome.alarms.create(RETENTION_ALARM, { delayInMinutes: 2, periodInMinutes: 24 * 60 }));
  // Phase 3.4: upgrade pages chunked with an older profile, a few per tick.
  quietChrome(
    chrome.alarms.create(RECHUNK_ALARM, {
      delayInMinutes: 1,
      periodInMinutes: RECHUNK_ALARM_PERIOD_MIN,
    })
  );
}

const RETENTION_ALARM = "cortex-retention";

async function runRetentionSweep(): Promise<void> {
  try {
    const settings = await getEffectiveSettings({ fresh: true });
    if (settings.retentionDays < 1) return;
    const res = await applyRetention(settings.retentionDays);
    if (res.documents || res.visits || res.conversations || res.pages) {
      devLog.info("[Cortex] retention removed", res);
      await refreshSnapshotNow({}).catch(() => undefined);
    }
  } catch (e) {
    devLog.warn("[Cortex] retention sweep:", e);
  }
}

/** True while the previous re-chunk batch still has embeddings in the queue. */
let rechunkBusy = false;

async function runRechunkTick(): Promise<void> {
  if (rechunkBusy) return;
  const settings = await getEffectiveSettings();
  if (settings.indexingPaused) return;
  rechunkBusy = true;
  try {
    const res = await runRechunkBatch({
      queueEmbeddings: async (chunkIds) => {
        const rows = await db.chunks.bulkGet(chunkIds);
        queueEmbeddingsForChunkIds(
          rows
            .filter((r): r is NonNullable<typeof r> => r != null && r.id != null)
            .map((r) => ({ chunkId: r.id as number, text: r.text }))
        );
      },
    });
    if (res.remaining === 0) {
      await chrome.alarms.clear(RECHUNK_ALARM);
    }
  } catch (e) {
    devLog.warn("[Cortex] rechunk batch:", e);
  } finally {
    // Release only after this batch's embeddings drain, so batches never pile up.
    void embedChain.finally(() => {
      rechunkBusy = false;
    });
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ASSISTANT_SYNC_ALARM) {
    void finalizeStaleVisits()
      .catch(() => undefined)
      .then(() => planAssistantFlush("safety"))
      .catch(() => undefined);
    return;
  }
  if (alarm.name === ASSISTANT_SYNC_SOON_ALARM) {
    void runAssistantSyncPass("alarm").catch(() => undefined);
    return;
  }
  if (alarm.name === RECHUNK_ALARM) {
    void runRechunkTick().catch(() => undefined);
    return;
  }
  if (alarm.name === RETENTION_ALARM) {
    void runRetentionSweep().catch(() => undefined);
    return;
  }
  if (alarm.name !== "cortex-evict-storage") return;
  void ensureIndexingHeadroom().catch(() => {
    /* ignore */
  });
});

/** Gate, then inject extract.js if needed and ask it to extract (Phase 5 task 0.2). */
async function requestTabExtraction(
  tabId: number,
  url: string,
  sender: chrome.runtime.MessageSender,
  gateOpts?: { bypassIndexingPause?: boolean }
) {
  const settings = await getEffectiveSettings();
  // YouTube transcripts (Phase 5.6): only on watch pages, only when enabled.
  const youtube = settings.youtubeTranscriptsEnabled && videoIdFromUrl(url) != null;
  const result = await requestExtraction(tabId, {
    gate: () => shouldSkipIndexing(url, sender, gateOpts),
    deliver: (id) =>
      new Promise<boolean>((resolve) => {
        chrome.tabs.sendMessage(id, { type: "CORTEX_EXTRACT_NOW", youtube, tables: settings.tablesEnabled, images: settings.imagesEnabled, imageDescriptions: settings.imagesEnabled && settings.imageDescriptionsEnabled }, { frameId: 0 }, (res) => {
          if (chrome.runtime.lastError) {
            resolve(false);
            return;
          }
          resolve((res as { ok?: boolean } | undefined)?.ok === true);
        });
      }),
    inject: async (id, files) => {
      await chrome.scripting.executeScript({ target: { tabId: id, frameIds: [0] }, files });
    },
  });
  if (result.ok && youtube) {
    // Reads the player response in the page's own world (idempotent).
    await chrome.scripting
      .executeScript({ target: { tabId, frameIds: [0] }, files: ["youtube-bridge.js"], world: "MAIN" })
      .catch(() => undefined);
  }
  return result;
}

/**
 * Explicit "add this page to a collection" (overlay button or context menu).
 * Runs the privacy gate (the user's own pause does not block an explicit
 * action; policy, incognito, blocklist and sensitive sites do).
 */
async function addTabPageToCollection(
  collectionId: number,
  tab: chrome.tabs.Tab
): Promise<{ ok: boolean; error?: string }> {
  if (tab.id == null || !tab.url) return { ok: false, error: "no_page" };
  const sender = { tab } as chrome.runtime.MessageSender;
  const gate = await shouldSkipIndexing(tab.url, sender, { bypassIndexingPause: true });
  if (gate.skip) return { ok: false, error: gate.reason };
  const res = await addPageToCollection(collectionId, tab.url, tab.title ?? "");
  if (res.created) {
    void requestTabExtraction(tab.id, tab.url, sender, { bypassIndexingPause: true });
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Context menus (Phase 5.3 highlights, 5.4 collections). Rebuilt from settings.
// ---------------------------------------------------------------------------
const HIGHLIGHT_MENU_ID = "cortex-save-highlight";
const WEB_PATTERNS = ["http://*/*", "https://*/*"];

async function syncContextMenus(): Promise<void> {
  if (!chrome.contextMenus) return;
  const settings = await getEffectiveSettings();
  await new Promise<void>((resolve) => chrome.contextMenus.removeAll(() => resolve()));
  if (settings.highlightsEnabled) {
    chrome.contextMenus.create(
      {
        id: HIGHLIGHT_MENU_ID,
        title: "Save to Cortex",
        contexts: ["selection"],
        documentUrlPatterns: WEB_PATTERNS,
      },
      () => {
        void chrome.runtime.lastError;
      }
    );
  }
}

function flashBadge(tabId: number, text: string): void {
  void chrome.action.setBadgeText({ tabId, text }).catch(() => undefined);
  setTimeout(() => void chrome.action.setBadgeText({ tabId, text: "" }).catch(() => undefined), 2500);
}

async function handleSaveHighlight(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): Promise<void> {
  if (tab?.id == null || !tab.url) return;
  const settings = await getEffectiveSettings();
  if (!settings.highlightsEnabled) return;
  // Explicit user action: the user's own pause does not block it, but policy,
  // incognito, blocklist, allowlist and sensitive sites do.
  const gate = await shouldSkipIndexing(tab.url, { tab } as chrome.runtime.MessageSender, {
    bypassIndexingPause: true,
  });
  if (gate.skip) {
    flashBadge(tab.id, "!");
    return;
  }
  const quote = String(info.selectionText ?? "");
  let note: string | null = "";
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (q: string) =>
        window.prompt(`Save to Cortex:\n"${q.slice(0, 140)}"\n\nAdd a note (optional):`, ""),
      args: [quote],
    });
    // prompt() returns null on Cancel; executeScript reports that as a missing
    // result. A string (possibly empty) means OK.
    const value = r?.result;
    note = typeof value === "string" ? value : null;
  } catch {
    // The prompt could not run (restricted frame): save without a note.
    note = "";
  }
  if (note === null) return; // cancelled
  const saved = await saveHighlight({ url: tab.url, title: tab.title ?? "", quote, note });
  const chunk = await db.chunks.get(saved.chunkId);
  if (chunk) queueEmbeddingsForChunkIds([{ chunkId: saved.chunkId, text: chunk.text }]);
  flashBadge(tab.id, "+");
}

chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (info.menuItemId === HIGHLIGHT_MENU_ID) {
    void handleSaveHighlight(info, tab).catch((e) => devLog.warn("[Cortex] highlight:", e));
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === "local" && changes.cortex_user_settings) || area === "managed") {
    void syncContextMenus().catch(() => undefined);
  }
});

// ---------------------------------------------------------------------------
// Address bar: keyword "cx" (Phase 5.2). Local search only.
// ---------------------------------------------------------------------------
const OMNIBOX_DEFAULT = "Search your Cortex library for <match>%s</match>";
let omniboxSeq = 0;
let omniboxLast: { query: string; bestUrl: string | null } = { query: "", bestUrl: null };

quietChrome(chrome.omnibox?.setDefaultSuggestion({ description: OMNIBOX_DEFAULT }));

chrome.omnibox?.onInputChanged.addListener((text, suggest) => {
  const seq = ++omniboxSeq;
  void (async () => {
    const settings = await getEffectiveSettings();
    if (!settings.omniboxEnabled) {
      chrome.omnibox.setDefaultSuggestion({
        description: "Cortex address bar search is off. Turn it on in Cortex settings.",
      });
      suggest([]);
      return;
    }
    chrome.omnibox.setDefaultSuggestion({ description: OMNIBOX_DEFAULT });
    const q = text.trim();
    if (q.length < 2) {
      suggest([]);
      return;
    }
    await sleepMs(150);
    if (seq !== omniboxSeq) return;
    const res = await searchViaOffscreen(q);
    if (seq !== omniboxSeq) return;
    const hits = res.ok ? res.hits : [];
    omniboxLast = { query: q, bestUrl: hits[0]?.url ?? null };
    suggest(toSuggestions(hits, q));
  })().catch((e) => devLog.warn("[Cortex] omnibox:", e));
});

chrome.omnibox?.onInputEntered.addListener((text, disposition) => {
  void (async () => {
    const settings = await getEffectiveSettings();
    if (!settings.omniboxEnabled) return;
    const q = text.trim();
    let best = omniboxLast.query === q ? omniboxLast.bestUrl : null;
    if (!best && !/^https?:\/\//i.test(q)) {
      const res = await searchViaOffscreen(q);
      best = res.ok ? res.hits[0]?.url ?? null : null;
    }
    const url = resolveEnteredUrl(q, best);
    if (!url) return;
    if (disposition === "currentTab") {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab?.id != null) await chrome.tabs.update(tab.id, { url });
      else await chrome.tabs.create({ url });
    } else {
      await chrome.tabs.create({ url, active: disposition === "newForegroundTab" });
    }
  })().catch((e) => devLog.warn("[Cortex] omnibox enter:", e));
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse): boolean => {
  if (!msg || typeof msg !== "object") return false;

  if (sender.id !== undefined && sender.id !== chrome.runtime.id) {
    return false;
  }

  const msgType = (msg as { type?: string }).type;
  if (
    msgType === "CORTEX_EMBED_TEXT" ||
    msgType === "CORTEX_SEARCH_RUN" ||
    msgType === BACKUP_WORK_MESSAGE
  ) {
    if (!isPrivilegedExtensionSender(sender)) {
      sendResponse({
        ok: false,
        error: ERROR_CODES.FOREIGN_SENDER,
        ...payloadFromCode(ERROR_CODES.FOREIGN_SENDER),
      });
      return true;
    }
    return false;
  }

  const type = (msg as { type: string }).type;

  if (type === "CORTEX_KEEPALIVE") {
    sendResponse({ ok: true });
    return false;
  }

  if (type === "CORTEX_CHAT_WARM") {
    void ensureOffscreen().then(() => cortexBus.postMessage({ kind: "chat-warm" } satisfies CortexBusInbound)).catch(() => undefined);
    sendResponse({ ok: true });
    return false;
  }

  if (type === "CORTEX_INDEX_REQUEST") {
    const tabId = sender.tab?.id;
    const url = String((msg as { url?: unknown }).url ?? "");
    const tabUrl = sender.tab?.url ?? "";
    if (tabId == null || (!indexPayloadUrlMatchesTab(url, sender) && !sameLinkedInProfile(url, tabUrl))) {
      sendResponse({ ok: false, error: "bad_index_request" });
      return true;
    }
    const entityPage = /linkedin\.com\/(?:in|company|school|showcase)\//i.test(url);
    if (!rateLimitHit(`extract:${tabId}`, entityPage ? 60 : 20, sendResponse)) return true;
    void requestTabExtraction(tabId, url, sender).then(sendResponse);
    return true;
  }

  if (type === "CORTEX_INDEX_TRANSCRIPT") {
    const tab = sender.tab;
    const p = tab?.url ? sanitizeTranscriptPayload((msg as { payload?: unknown }).payload, tab.url) : null;
    if (!tab || !p) {
      sendResponse({ ok: false, error: "bad_transcript" });
      return true;
    }
    // Two messages per video now (identity first, then the transcript), so a
    // user moving quickly through videos needs more headroom than 6 a minute.
    if (!rateLimitHit(`transcript:${tab.id}`, 20, sendResponse)) return true;
    void (async () => {
      const settings = await getEffectiveSettings();
      if (!settings.youtubeTranscriptsEnabled) {
        sendResponse({ ok: false, reason: "disabled" });
        return;
      }
      const gate = await shouldSkipIndexing(p.url, sender);
      if (gate.skip) {
        sendResponse({ ok: false, reason: gate.reason });
        return;
      }
      const docId = await upsertDocument({
        url: p.url,
        domain: hostnameFromUrl(p.url),
        title: p.title || "YouTube video",
        summary: redactPII(p.metadata).redacted.slice(0, 500),
        lastVisitedAt: Date.now(),
      });
      // No captions yet: store the video's identity (title, channel,
      // description) so the video is findable, and mark the chunk as such so
      // citations read "Video details" rather than "Video at 0:00".
      const identityOnly = p.windows.length === 0;
      const windows = identityOnly
        ? [{ startSec: 0, endSec: Math.max(60, p.lengthSeconds), text: p.metadata }]
        : p.windows;
      const chunks = transcriptChunks(
        p.videoId,
        windows.map((w) => ({ ...w, text: redactPII(w.text).redacted }))
      ).map((c) =>
        identityOnly ? { ...c, locator: { ...(c.locator as object), meta: true } as typeof c.locator } : c
      );
      const ids = await replaceChunksForDocument(docId, chunks, { kinds: ["transcript"] });
      queueEmbeddingsForChunkIds(ids.map((id, i) => ({ chunkId: id, text: chunks[i]!.text })));
      sendResponse({ ok: true, chunks: ids.length, fromCaptions: p.windows.length > 0 });
    })().catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (type === "CORTEX_COLLECTIONS_LIST") {
    void listCollections()
      .then((collections) => sendResponse({ ok: true, collections }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (type === "CORTEX_COLLECTION_CREATE") {
    if (!rateLimitHit("collection_create", 20, sendResponse)) return true;
    void createCollection(String((msg as { name?: unknown }).name ?? ""))
      .then(async (id) => {
        await syncContextMenus().catch(() => undefined);
        sendResponse({ ok: true, id });
      })
      .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    return true;
  }

  if (type === "CORTEX_COLLECTION_DELETE") {
    const id = (msg as { id?: unknown }).id;
    if (typeof id !== "number" || !Number.isFinite(id)) {
      sendResponse({ ok: false, error: "bad_id" });
      return true;
    }
    void deleteCollection(id)
      .then(async () => {
        await syncContextMenus().catch(() => undefined);
        sendResponse({ ok: true });
      })
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (type === "CORTEX_COLLECTION_ADD_PAGE") {
    // From the in-page overlay: the page is always the sender's own tab.
    const cid = (msg as { collectionId?: unknown }).collectionId;
    if (!sender.tab || typeof cid !== "number" || !Number.isFinite(cid)) {
      sendResponse({ ok: false, error: "bad_request" });
      return true;
    }
    void addTabPageToCollection(cid, sender.tab)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    return true;
  }

  if (type === "CORTEX_INDEX") {
    const p = (msg as { payload: IndexPayload }).payload;
    const domainKey = `index:${hostnameFromUrl(p.url)}`;
    // A profile or company page still gets saved when the text index is
    // rate limited. LinkedIn retries would otherwise drop the person.
    const indexAllowed = p?.person
      ? SW_RATE_LIMITER.check(domainKey, 30)
      : rateLimitHit(domainKey, 30, sendResponse);
    if (!p?.person && !indexAllowed) return true;

    void (async () => {
      try {
        const gate = await shouldSkipIndexing(p.url, sender);
        if (gate.skip) {
          sendResponse({ ok: false, reason: gate.reason });
          return;
        }

        const tabUrl = sender.tab?.url ?? "";
        if (!indexPayloadUrlMatchesTab(p.url, sender) && !sameLinkedInProfile(p.url, tabUrl)) {
          sendResponse({
            ok: false,
            error: ERROR_CODES.INDEX_URL_MISMATCH,
            ...payloadFromCode(ERROR_CODES.INDEX_URL_MISMATCH),
          });
          return;
        }

        // A captcha, Cloudflare check, or login wall is not the page. Its real title triggers a new capture.
        if (isChallengePage({ url: p.url, title: p.title, text: p.text })) {
          sendResponse({ ok: false, reason: "challenge" });
          return;
        }

        const personRecorded = p.person ? await maybeRecordPerson(p.person, p.url) : false;
        if (!indexAllowed) {
          sendResponse({ ok: personRecorded, reason: "rate_limited", person: personRecorded });
          return;
        }

        const settingsForExtras = await getEffectiveSettings();
        const extraChunks = sanitizeExtraChunks(p.extraChunks, {
          tables: settingsForExtras.tablesEnabled,
          images: settingsForExtras.imagesEnabled,
        });

        const minLen = minCharsForUrl(p.url);
        const text = typeof p.text === "string" ? p.text : "";
        // A page that is mostly a data table still counts (Phase 5.7).
        if (text.length < minLen && !extraChunks.length) {
          sendResponse({ ok: personRecorded, reason: "too_short", minLen, person: personRecorded });
          return;
        }
        if (text.length < minLen) p.text = "";

        if (p.text.length > STORAGE_LIMITS.MAX_DOCUMENT_TEXT_BYTES) {
          sendResponse({
            ok: false,
            error: ERROR_CODES.INDEX_TEXT_TOO_LARGE,
            ...payloadFromCode(ERROR_CODES.INDEX_TEXT_TOO_LARGE),
          });
          return;
        }

        const imageChunk = extraChunks.find((c) => c.kind === "image");
        const imageSrcs =
          (imageChunk?.locator as { images?: { src: string }[] } | undefined)?.images?.map((i) => i.src) ?? [];
        const imageInputs = planImageDescriptions(
          {
            enabled: settingsForExtras.imageDescriptionsEnabled,
            policyAllows: settingsForExtras.policy.imageDescriptionsAllowed !== false,
          },
          sanitizeImageInputs(p.imageInputs, imageSrcs)
        );
        delete p.imageInputs;
        const { id: docId, chunks } = await commitIndexPayload(p, {
          tabId: sender.tab?.id,
          tabUrl: sender.tab?.url,
          extraChunks,
          imageInputs,
        });
        sendResponse({ ok: true, id: docId, chunks });
      } catch (e) {
        // #region agent log
        agentDebugLog({
          hypothesisId: "H5",
          location: "service-worker.ts:CORTEX_INDEX",
          message: "index_caught",
          data: {
            err: e instanceof Error ? e.message : String(e),
          },
        });
        // #endregion
        devLog.warn("[Cortex] index error:", e);
        if (e instanceof CortexError) {
          sendResponse({
            ok: false,
            error: e.code,
            ...e.toPayload(),
          });
          return;
        }
        sendResponse({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return true;
  }

  if (type === "CORTEX_CHAT_START") {
    const tabId = resolveOverlayTabId(
      sender,
      Boolean((msg as { shell?: boolean }).shell)
    );
    if (tabId == null) {
      sendResponse({ ok: false, error: "no_tab" });
      return true;
    }
    const question = String((msg as { question?: string }).question ?? "");
    if (question.length > CHAT_LIMITS.MAX_QUESTION_CHARS) {
      sendResponse({
        ok: false,
        error: ERROR_CODES.QUESTION_TOO_LONG,
        maxLen: CHAT_LIMITS.MAX_QUESTION_CHARS,
        ...payloadFromCode(ERROR_CODES.QUESTION_TOO_LONG),
      });
      return true;
    }
    if (!rateLimitHit(`chat:${tabId}`, 10, sendResponse)) return true;
    void (async () => {
      try {
        await ensureOffscreen();
        const settings = await getEffectiveChatSettings();
        const conversationIdRaw = (msg as { conversationId?: unknown })
          .conversationId;
        const conversationId =
          typeof conversationIdRaw === "number" &&
          Number.isFinite(conversationIdRaw)
            ? conversationIdRaw
            : null;
        const requestIdRaw = (msg as { requestId?: unknown }).requestId;
        const requestId =
          typeof requestIdRaw === "number" && Number.isFinite(requestIdRaw)
            ? requestIdRaw
            : 0;
        const cidRaw = (msg as { collectionId?: unknown }).collectionId;
        const inbound: CortexBusInbound = {
          kind: "chat-run",
          tabId,
          requestId,
          ...(typeof cidRaw === "number" && Number.isFinite(cidRaw) ? { collectionId: cidRaw } : {}),
          conversationId,
          question,
          settings,
        };
        cortexBus.postMessage(inbound);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return true;
  }

  if (type === "CORTEX_CHAT_ABORT") {
    const tabId = resolveOverlayTabId(
      sender,
      Boolean((msg as { shell?: boolean }).shell)
    );
    const requestIdRaw = (msg as { requestId?: unknown }).requestId;
    if (
      tabId == null ||
      typeof requestIdRaw !== "number" ||
      !Number.isFinite(requestIdRaw)
    ) {
      sendResponse({ ok: false, error: "bad_abort" });
      return true;
    }
    const abortMsg: CortexBusInbound = {
      kind: "chat-abort",
      tabId,
      requestId: requestIdRaw,
    };
    cortexBus.postMessage(abortMsg);
    sendResponse({ ok: true });
    return true;
  }

  if (type === "CORTEX_PHOTO_GET") {
    // The saved copy only. Nothing here talks to LinkedIn.
    if (!rateLimitHit(`photo:${sender.tab?.id ?? 0}`, 300, sendResponse)) return true;
    const profileUrl = String((msg as { profileUrl?: unknown }).profileUrl ?? "").slice(0, 2048);
    void (async () => {
      const settings = await getEffectiveSettings();
      const photo = settings.profilePhotosEnabled && profileUrl ? await getProfilePhoto(profileUrl) : undefined;
      if (!photo) {
        sendResponse({ ok: false });
        return;
      }
      const bytes = new Uint8Array(photo.bytes);
      let bin = "";
      for (let i = 0; i < bytes.length; i += 8192) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192) as unknown as number[]);
      }
      sendResponse({ ok: true, mime: photo.mime, b64: btoa(bin) });
    })().catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (type === "CORTEX_PEOPLE_LIST") {
    void (async () => {
      const q = String((msg as { q?: unknown }).q ?? "").slice(0, 200);
      const [rows, settings] = await Promise.all([listPeople({ q, limit: 200 }), getEffectiveSettings()]);
      const saved = settings.profilePhotosEnabled ? await profilesWithPhotos() : new Set<string>();
      const people = rows.map((p) => ({ ...p, hasPhoto: saved.has(p.profileUrl) }));
      sendResponse({ ok: true as const, people });
    })().catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (type === "CORTEX_PEOPLE_DELETE") {
    const id = (msg as { id?: unknown }).id;
    if (typeof id !== "number" || !Number.isFinite(id)) {
      sendResponse({ ok: false, error: "bad_id" });
      return true;
    }
    void deletePerson(id)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (type === "CORTEX_CHAT_LIST") {
    void (async () => {
      try {
        const conversations = await listRecentConversations(48);
        sendResponse({ ok: true as const, conversations });
      } catch (e: unknown) {
        sendResponse({
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return true;
  }

  if (type === "CORTEX_CHAT_LOAD") {
    const conversationIdRaw = (msg as { conversationId?: unknown })
      .conversationId;
    const conversationId =
      typeof conversationIdRaw === "number" &&
      Number.isFinite(conversationIdRaw)
        ? conversationIdRaw
        : null;
    if (conversationId == null) {
      sendResponse({ ok: false, error: "bad_conversation_id" });
      return true;
    }
    void (async () => {
      try {
        const messages = await getConversationMessages(conversationId);
        sendResponse({ ok: true as const, conversationId, messages });
      } catch (e: unknown) {
        sendResponse({
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return true;
  }

  if (type === "CORTEX_CHAT_DROP_TURN") {
    const conversationIdRaw = (msg as { conversationId?: unknown }).conversationId;
    const conversationId =
      typeof conversationIdRaw === "number" && Number.isFinite(conversationIdRaw)
        ? conversationIdRaw
        : null;
    if (conversationId == null) {
      sendResponse({ ok: false, error: "bad_conversation_id" });
      return true;
    }
    const includeUser = (msg as { includeUser?: unknown }).includeUser !== false;
    void dropLastTurn(conversationId, includeUser)
      .then(() => sendResponse({ ok: true as const }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (type === "CORTEX_CHAT_DELETE") {
    const conversationIdRaw = (msg as { conversationId?: unknown })
      .conversationId;
    const conversationId =
      typeof conversationIdRaw === "number" &&
      Number.isFinite(conversationIdRaw)
        ? conversationIdRaw
        : null;
    if (conversationId == null) {
      sendResponse({ ok: false, error: "bad_conversation_id" });
      return true;
    }
    void (async () => {
      try {
        await deleteConversation(conversationId);
        sendResponse({ ok: true as const, conversationId });
      } catch (e: unknown) {
        sendResponse({
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return true;
  }

  if (type === "CORTEX_DIGEST_START") {
    const tabId = resolveOverlayTabId(
      sender,
      Boolean((msg as { shell?: boolean }).shell)
    );
    if (tabId == null) {
      sendResponse({ ok: false, error: "no_tab" });
      return true;
    }
    const rangeRaw = (msg as { range?: string }).range;
    const range =
      rangeRaw === "today" ||
      rangeRaw === "yesterday" ||
      rangeRaw === "last_7_days"
        ? rangeRaw
        : "yesterday";
    if (!rateLimitHit(`digest:${tabId}`, 5, sendResponse)) return true;
    void (async () => {
      try {
        await ensureOffscreen();
        const settings = await getEffectiveChatSettings();
        const inbound: CortexBusInbound = {
          kind: "digest-run",
          tabId,
          range,
          forceRegenerate: Boolean(
            (msg as { forceRegenerate?: boolean }).forceRegenerate
          ),
          settings,
        };
        cortexBus.postMessage(inbound);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return true;
  }

  if (type === "CORTEX_SEARCH") {
    const tabPart = sender.tab?.id ?? 0;
    if (!rateLimitHit(`search:${tabPart}`, 60, sendResponse)) return true;
    void (async () => {
      try {
        const q = String((msg as { query?: string }).query || "");
        if (q.length > SEARCH_LIMITS.MAX_QUERY_CHARS) {
          sendResponse({
            ok: false,
            error: ERROR_CODES.QUERY_TOO_LONG,
            maxLen: SEARCH_LIMITS.MAX_QUERY_CHARS,
            ...payloadFromCode(ERROR_CODES.QUERY_TOO_LONG),
          });
          return;
        }
        const cidRaw = (msg as { collectionId?: unknown }).collectionId;
        const collectionId =
          typeof cidRaw === "number" && Number.isFinite(cidRaw) ? cidRaw : undefined;
        const from = Number((msg as { from?: unknown }).from);
        const to = Number((msg as { to?: unknown }).to);
        const exact = String((msg as { exact?: unknown }).exact ?? "").slice(0, 120);
        const site = String((msg as { site?: unknown }).site ?? "").slice(0, 80);
        const result = await searchViaOffscreen(q, {
          collectionId,
          ...(Number.isFinite(from) && Number.isFinite(to) ? { from, to } : {}),
          ...(exact.trim() ? { exact: exact.trim() } : {}),
          ...(site.trim() ? { site: site.trim() } : {}),
        });
        if (result.ok) {
          const read = await readingTimeFor(result.hits.map((h) => h.url)).catch(() => new Map<string, number>());
          sendResponse({
            ok: true,
            hits: result.hits.map((h) => (read.has(h.url) ? { ...h, readMs: read.get(h.url) } : h)),
            evidence: result.evidence,
          });
        } else {
          sendResponse({ ok: false, error: result.error });
        }
      } catch (e) {
        devLog.error("[Cortex] CORTEX_SEARCH:", e);
        sendResponse({
          ok: false,
          error:
            e instanceof Error
              ? e.message
              : typeof e === "string"
                ? e
                : "Search failed",
        });
      }
    })();
    return true;
  }

  /**
   * @deprecated Prefer `readSnapshot()` in the popup. Kept for options and legacy callers.
   */
  if (type === "CORTEX_RECENT_VISITS") {
    void (async () => {
      try {
        const rows = await getRecentVisits(12);
        sendResponse({
          ok: true as const,
          recent: rows.map((r) => ({
            title: r.title,
            hostname: r.hostname,
            visitedAt: r.visitedAt,
          })),
        });
      } catch (e: unknown) {
        sendResponse({
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return true;
  }

  if (type === "CORTEX_STATS") {
    void (async () => {
      try {
        const tabUrl =
          typeof (msg as { tabUrl?: string }).tabUrl === "string"
            ? (msg as { tabUrl?: string }).tabUrl
            : undefined;
        const tabIncognito = Boolean(
          (msg as { tabIncognito?: boolean }).tabIncognito
        );

        const snap = await computeFreshSnapshot({
          tabUrl,
          tabIncognito,
        });

        sendResponse({
          ok: true,
          pageCount: snap.pageCount,
          chunkCount: snap.chunkCount,
          visitCount: snap.visitCount,
          storageBytes: snap.storageBytes,
          storageQuotaBytes: snap.storageQuotaBytes,
          indexingPaused: snap.indexingPaused,
          currentTab: snap.currentTab
            ? { line: snap.currentTab.line, badge: snap.currentTab.badge }
            : undefined,
          recent: snap.recent,
        });
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        devLog.warn("[Cortex] CORTEX_STATS failed:", errMsg);
        try {
          sendResponse({
            ok: false,
            error: errMsg,
          });
        } catch (sendErr: unknown) {
          devLog.warn("[Cortex] CORTEX_STATS sendResponse failed:", sendErr);
        }
      }
    })();
    return true;
  }

  if (type === "CORTEX_STATS_REFRESH") {
    void (async () => {
      try {
        const tabUrl =
          typeof (msg as { tabUrl?: string }).tabUrl === "string"
            ? (msg as { tabUrl?: string }).tabUrl
            : undefined;
        const tabIncognito = Boolean(
          (msg as { tabIncognito?: boolean }).tabIncognito
        );

        const snapshot = await refreshSnapshotNow({
          tabUrl,
          tabIncognito,
        });

        sendResponse({ ok: true as const, snapshot });
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        sendResponse({ ok: false as const, error: errMsg });
      }
    })();
    return true;
  }

  // Export and backup (Phase 5.10, moved out in 6.7): options page only. The
  // library leaves the device only as a file the user saves; restore goes
  // through the privacy gate below. The work itself runs in the offscreen
  // document — everything before the forward is the unchanged authorization.
  if (isBackupRequestType(type)) {
    return forwardBackupRequest(type, msg as { text?: unknown }, sendResponse, {
      isOptionsPage: () => isOptionsPageSender(sender),
      foreignSender: () => ({
        ok: false,
        error: ERROR_CODES.FOREIGN_SENDER,
        ...payloadFromCode(ERROR_CODES.FOREIGN_SENDER),
      }),
      rateLimit: (respond) => rateLimitHit("export", 10, respond),
      newToken: mintRestoreGateTicket,
      forward: sendBackupWorkToOffscreen,
      afterRestore: finishRestore,
      onError: (e) => devLog.warn("[Cortex] export/backup:", e),
    });
  }

  // The offscreen document asks back mid-restore, because the gate needs the
  // effective settings and the managed policy, which only live here. The
  // one-time ticket proves this is the restore the options page authorized.
  if (type === BACKUP_GATE_MESSAGE) {
    const token = String((msg as { token?: unknown }).token ?? "");
    if (!isPrivilegedExtensionSender(sender) || !token || !restoreGateTickets.has(token)) {
      sendResponse({
        ok: false,
        error: ERROR_CODES.FOREIGN_SENDER,
        ...payloadFromCode(ERROR_CODES.FOREIGN_SENDER),
      });
      return true;
    }
    void (async () => {
      try {
        const settings = await getEffectiveSettings();
        if (settings.policy.indexingDisabled === true) {
          sendResponse({ ok: false, error: "Your administrator has turned off indexing, so backups cannot be restored." });
          return;
        }
        const urls = (msg as { urls?: unknown }).urls;
        const list = Array.isArray(urls) ? urls : [];
        const allowed: boolean[] = [];
        for (const u of list) {
          // Restoring is an explicit user action: it bypasses the user's own
          // pause, never the policy, blocklist, allowlist or sensitive hosts.
          allowed.push(
            typeof u === "string" &&
              !(await shouldSkipIndexing(u, {} as chrome.runtime.MessageSender, { bypassIndexingPause: true })).skip
          );
        }
        sendResponse({ ok: true, allowed });
      } catch (e) {
        devLog.warn("[Cortex] backup gate:", e);
        sendResponse({ ok: false, error: "Could not finish. Try again." });
      }
    })();
    return true;
  }

  if (type === "CORTEX_CLEAR_ALL_DATA") {
    if (!isOptionsPageSender(sender)) {
      sendResponse({
        ok: false,
        error: ERROR_CODES.FOREIGN_SENDER,
        ...payloadFromCode(ERROR_CODES.FOREIGN_SENDER),
      });
      return true;
    }
    void (async () => {
      try {
        await forgetAll();
        await refreshSnapshotNow({}).catch(() => undefined);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return true;
  }

  if (type === "CORTEX_FORGET") {
    const decision = resolveForgetRequest(
      msg as { scope?: unknown; hostname?: unknown },
      sender,
      chrome.runtime.getURL("")
    );
    if (!decision.ok) {
      sendResponse({ ok: false, error: decision.error });
      return true;
    }
    if (!rateLimitHit("forget", 20, sendResponse)) return true;
    void (async () => {
      try {
        let counts: unknown = null;
        if (decision.scope === "site") counts = await forgetSite(decision.site);
        else if (decision.scope === "hour") counts = await forgetSince(Date.now() - FORGET_WINDOWS_MS.hour);
        else if (decision.scope === "day") counts = await forgetSince(Date.now() - FORGET_WINDOWS_MS.day);
        else await forgetAll();
        await refreshSnapshotNow({}).catch(() => undefined);
        sendResponse({
          ok: true,
          scope: decision.scope,
          site: decision.scope === "site" ? decision.site : undefined,
          counts,
        });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return true;
  }

  if (type === "CORTEX_HISTORY_IMPORT_START") {
    // Settings-only: content scripts must not grant consent or scan history.
    if (!isOptionsPageSender(sender)) {
      sendResponse({
        ok: false,
        error: ERROR_CODES.FOREIGN_SENDER,
        ...payloadFromCode(ERROR_CODES.FOREIGN_SENDER),
      });
      return true;
    }
    if (!rateLimitHit("history_import_start", 3, sendResponse)) return true;
    void (async () => {
      const daysRaw = Number((msg as { daysBack?: number }).daysBack);
      const maxRaw = Number((msg as { maxUrls?: number }).maxUrls);
      const daysBack = Number.isFinite(daysRaw)
        ? Math.min(365, Math.max(1, Math.floor(daysRaw)))
        : 30;
      const maxAttempts = Number.isFinite(maxRaw)
        ? Math.min(500, Math.max(5, Math.floor(maxRaw)))
        : 300;

      const cur = await readHistoryImportProgress();
      if (cur.running) {
        sendResponse({ ok: false as const, error: "already_running" });
        return;
      }

      // Settings "Scan history" is affirmative consent for indexing + this import.
      await grantIndexingConsent();
      sendResponse({ ok: true as const });
      await runHistoryImportJob(daysBack, maxAttempts);
    })();
    return true;
  }

  if (type === "CORTEX_INDEXING_CONSENT_GRANT") {
    if (!isConsentUiSender(sender)) {
      sendResponse({ ok: false, error: "This action is only available from Cortex." });
      return true;
    }
    const runBackfill =
      (msg as { runFirstInstallBackfill?: unknown }).runFirstInstallBackfill === true;
    void (async () => {
      try {
        await grantIndexingConsent();
        sendResponse({ ok: true as const });
        // One-time history + open-tab seed only when welcome page asks for it.
        if (runBackfill) void maybeRunFirstInstallBackfill();
      } catch (e: unknown) {
        sendResponse({
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return true;
  }

  if (type === "CORTEX_INDEXING_CONSENT_STATUS") {
    void hasIndexingConsent().then((granted) => {
      sendResponse({ ok: true as const, granted });
    });
    return true;
  }

  if (type === "CORTEX_HISTORY_IMPORT_STATUS") {
    void readHistoryImportProgress().then((progress) => {
      sendResponse({ ok: true as const, progress });
    });
    return true;
  }

  if (type === "CORTEX_HISTORY_IMPORT_CANCEL") {
    if (!isOptionsPageSender(sender)) {
      sendResponse({
        ok: false,
        error: ERROR_CODES.FOREIGN_SENDER,
        ...payloadFromCode(ERROR_CODES.FOREIGN_SENDER),
      });
      return true;
    }
    historyImportAbortRequested = true;
    sendResponse({ ok: true as const });
    return true;
  }

  if (type === "CORTEX_OPEN_TAB") {
    const raw = String((msg as { url?: string }).url || "");
    const href = safeHttpHttpsHref(raw);
    const active = (msg as { active?: boolean }).active !== false;
    if (!href) {
      sendResponse({
        ok: false,
        error: ERROR_CODES.INVALID_URL,
        ...payloadFromCode(ERROR_CODES.INVALID_URL),
      });
      return true;
    }
    void chrome.tabs.create({ url: href, active }).catch(() => {
      /* ignore */
    });
    sendResponse({ ok: true });
    return true;
  }

  // Double tap of Shift with the panel already open: relay the close back to
  // the tab it came from (content scripts cannot message each other).
  if (type === "CORTEX_CLOSE_SEARCH") {
    const tabId = sender.tab?.id;
    if (tabId != null) {
      chrome.tabs.sendMessage(tabId, { type: "CORTEX_CLOSE_SEARCH" }, { frameId: 0 }, () => {
        void chrome.runtime.lastError;
      });
    }
    sendResponse({ ok: true as const });
    return true;
  }

  if (type === "CORTEX_POPUP_OPEN_SEARCH") {
    void (async () => {
      // From a page (the double Shift gesture): open on the tab the keys came
      // from. From the popup, there is no tab, so use the active one.
      const fromTab = sender.tab;
      if (fromTab?.id != null) {
        setActiveTabSnapshot(fromTab);
        await withOpenCortexSearchGuard(async () => {
          await openCortexSearchForTab(fromTab, openSearchOnTab, {
            userPreference: (await getEffectiveSettings()).panelPreference,
            // A content-script keydown (double Shift) does not carry a
            // user gesture into the worker, so chrome.sidePanel.open()
            // would fail and fall back to a popup window.
            userGesture: false,
          });
        });
      } else {
        await openCortexSearchFromShortcut();
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (type === "CORTEX_SYNC_LABEL") {
    if (sender.id !== chrome.runtime.id) {
      sendResponse({ on: false });
      return true;
    }
    void readSyncEngineState().then((state) => {
      const phase = !state.syncEnabled
        ? "wave"
        : state.lastError
          ? "lost"
          : state.backfillPhase === "reading" || state.backfillPhase === "writing" || !state.lastSyncedAt
            ? "syncing"
            : "connected";
      sendResponse({ on: state.syncEnabled, phase });
    });
    return true;
  }

  if (type === "CORTEX_ASSISTANT_SYNC") {
    const parsed = parseMessage(AssistantSyncMessageSchema, msg);
    // Status: any Cortex page, including the Connect frame inside the panel. Content scripts report the web page URL.
    if (parsed?.action === "status" && isExtensionPageSender(sender)) {
      void assistantSyncStatus().then(sendResponse, () => sendResponse({ ok: false, error: "status_failed" }));
      return true;
    }
    // Options opens in a tab, so sender.tab is set. A web page still cannot send this.
    if (!isPrivilegedExtensionSender(sender) && !isOptionsPageSender(sender)) {
      sendResponse({ ok: false, error: "This action is only available from Cortex settings." });
      return true;
    }
    if (!parsed) {
      sendResponse({ ok: false, error: "bad_action" });
      return true;
    }
    const action = parsed.action;
    if (action === "status") {
      void assistantSyncStatus().then(sendResponse, () => sendResponse({ ok: false, error: "status_failed" }));
      return true;
    }
    // Interactive Enable comes from the Enable click in Settings or the setup side panel.
    if (action === "enable" && !isOptionsPageSender(sender) && !isGuidePanelSender(sender)) {
      sendResponse({ ok: false, error: "This action is only available from Cortex settings." });
      return true;
    }
    if (action === "pages" && !isOptionsPageSender(sender)) {
      sendResponse({ ok: false, error: "This action is only available from Cortex settings." });
      return true;
    }
    if (action === "now") {
      void readSyncEngineState().then(async (state) => {
        if (!state.syncEnabled) {
          sendResponse({ ok: false, error: "Turn Assistant Sync on before syncing." });
          return;
        }
        // One flush a minute, Sync now included. Inside the minute the page counts down.
        const waitMs = state.lastFlushAt + 60_000 - Date.now();
        if (waitMs > 0) {
          await planAssistantFlush("now");
          sendResponse({ ok: true, status: "waiting", waitMs });
          return;
        }
        sendResponse(await runAssistantSyncPass("now"));
      });
      return true;
    }
    void forwardAssistantSync(action, parsed.token, { choice: parsed.choice, cleanup: parsed.cleanup, pages: parsed.pages }).then(async (result) => {
      if (action === "enable" && result.more) await planAssistantFlush("now");
      // Restored days upload on the next pass.
      if (action === "pages" && parsed.pages === "undo" && result.ok) await planAssistantFlush("now");
      sendResponse(result);
    });
    return true;
  }

  if (type === "CORTEX_GUIDE_PANEL") {
    const tabId = (msg as { tabId?: unknown }).tabId;
    if (!isExtensionPageSender(sender) || typeof tabId !== "number" || !Number.isInteger(tabId)) {
      sendResponse({ ok: false });
      return true;
    }
    // Recorded before the write, so a restricted-page event for this tab cannot undo it.
    guideTabs.add(tabId);
    void chrome.sidePanel
      .setOptions({ tabId, path: GUIDE_PANEL_PATH, enabled: true })
      .then(
        () => sendResponse({ ok: true }),
        () => sendResponse({ ok: false })
      );
    return true;
  }

  if (type === "CORTEX_SYNC_WARNINGS") {
    if (!isOptionsPageSender(sender)) {
      sendResponse({ ok: false, error: "This action is only available from Cortex settings." });
      return true;
    }
    void listSyncWarnings().then(
      (warnings) => sendResponse({ ok: true, warnings }),
      () => sendResponse({ ok: false, error: "warnings_failed" })
    );
    return true;
  }

  if (type === "CORTEX_DWELL_ALLOWED") {
    const ask = parseMessage(DwellAllowedMessageSchema, msg);
    if (sender.id !== chrome.runtime.id || sender.tab?.id == null || !ask) return false;
    const tabId = sender.tab.id;
    void dwellAllowed(ask.url, sender)
      .then(async (ok) => {
        if (ok) await rememberDwellPage(tabId, ask.url).catch(() => undefined);
        sendResponse({ ok });
      })
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (type === "CORTEX_FEED_POST") {
    const post = parseMessage(FeedPostMessageSchema, msg);
    if (sender.id !== chrome.runtime.id || sender.tab?.id == null || !post) return false;
    void captureFeedPost(post, sender).catch(() => undefined);
    return false;
  }

  if (type === "CORTEX_DWELL") {
    const tabId = sender.tab?.id;
    const report = parseMessage(DwellMessageSchema, msg);
    if (sender.id !== chrome.runtime.id || tabId == null || !report) return false;
    handleDwellReport(tabId, report, sender);
    return false;
  }

  if (type === "CORTEX_OPEN_OPTIONS") {
    void (async () => {
      try {
        const section = String((msg as { section?: unknown }).section ?? "");
        // Whitelist only known options sections (Assist Sync deep link from Agents tab).
        if (section === "cx-sec-assistant" || section === "cx-sec-capture" || section === "cx-sec-connect") {
          await chrome.tabs.create({
            url: chrome.runtime.getURL(`options.html#${section}`),
            active: true,
          });
        } else {
          await chrome.runtime.openOptionsPage();
        }
        sendResponse({ ok: true as const });
      } catch (e: unknown) {
        sendResponse({
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return true;
  }

  return false;
});

// Resume re-embedding restored chunks after a service worker restart (Phase 5.10).
void drainPendingEmbeddings().catch(() => undefined);
