/// <reference types="chrome"/>
import { storeOtherDeviceVisits, type OtherDeviceVisit } from "./other-device";
import {
  FetchDriveApi,
  googleErrorDetail,
  googleStatus,
  trashMemory,
  type DriveApi,
  type GoogleErrorDetail,
  type MemoryChoice,
  type StoredMemoryIds,
} from "./drive-api";
import {
  answerLegacyCleanup,
  checkLegacyFiles,
  disableAssistantSync,
  enableAssistantSync,
  forbiddenMessage,
  runFlush,
  type FlushResult,
  type HistoryPerson,
  type HistoryVisit,
} from "./sync-engine";
import { readSyncEngineState, writeSyncEngineState } from "./db";
import { applyAssistantSyncPreferences } from "./preferences";
import { ASSISTANT_SYNC_FILE_ID, ASSISTANT_SYNC_FOLDER_ID } from "./preference-keys";
import { loadTopicVectors } from "./topics";

export { ASSISTANT_SYNC_FILE_ID, ASSISTANT_SYNC_FOLDER_ID };

export interface MemoryIdStore {
  getIds(): Promise<StoredMemoryIds>;
  setIds(ids: StoredMemoryIds): Promise<void>;
  clearIds(): Promise<void>;
}

/** Pulls the int8 label chunk. Called when a visit needs topics. */
export function preloadTopicVectors(): Promise<unknown> {
  return loadTopicVectors();
}

export async function trashStoredMemory(store: MemoryIdStore, api: DriveApi): Promise<{ ok: true; skipped?: boolean }> {
  const ids = await store.getIds();
  if (!ids.folderId && !ids.fileId) return { ok: true, skipped: true };
  await trashMemory(api, ids);
  await store.clearIds();
  return { ok: true };
}

function memoryIdStore(initial: StoredMemoryIds): MemoryIdStore & { current: () => StoredMemoryIds } {
  let ids: StoredMemoryIds = { folderId: initial.folderId, fileId: initial.fileId };
  return {
    async getIds() {
      return ids;
    },
    async setIds(next) {
      ids = { folderId: next.folderId, fileId: next.fileId };
    },
    async clearIds() {
      ids = { folderId: null, fileId: null };
    },
    current: () => ids,
  };
}

/** Offscreen entry. The service worker supplies the token and the stored ids. */
export async function trashStoredMemoryFromChrome(
  token: string,
  ids: StoredMemoryIds
): Promise<{ ok: true; skipped?: boolean }> {
  return trashStoredMemory(memoryIdStore(ids), new FetchDriveApi(token));
}

async function loadCortexHistory(cutoffMs: number): Promise<{ visits: HistoryVisit[]; people: HistoryPerson[] }> {
  const { db } = await import(/* webpackChunkName: "assistant-sync-history" */ "../db/schema");
  const rows = await db.visitLog.where("visitedAt").aboveOrEqual(cutoffMs).toArray();
  const people = await db.people.toArray();
  return {
    visits: rows
      .filter((row) => row.id != null)
      .map((row) => ({
        id: `visit:${row.id}`,
        url: row.url,
        title: row.title,
        visitedAt: row.visitedAt,
      })),
    people: people.map((person) => ({
      profileUrl: person.profileUrl,
      name: person.name,
      headline: person.headline,
      company: person.company,
      kind: person.kind,
      seenAt: person.lastSeen,
    })),
  };
}

export interface AssistantSyncWorkResult {
  ok: boolean;
  error?: string;
  status?: string;
  appended?: number;
  created?: boolean;
  warning?: string;
  ids?: StoredMemoryIds;
  /** Google returned 401. The service worker refreshes the token once and retries. */
  authFailed?: boolean;
  /** Epoch ms when the service worker should schedule the next attempt. */
  retryAt?: number;
  more?: boolean;
  /** Sheets requests this pass made, for the flush log. */
  reads?: number;
  writes?: number;
  confirm?: "missing" | "trashed";
  /** The failed Google call, for the flush log. */
  errorDetail?: GoogleErrorDetail;
  otherDeviceStored?: boolean;
}

export interface AssistantSyncLaunch {
  ids: StoredMemoryIds;
  retentionDays?: number;
  sheetDetail?: string;
  /** Drive id of the JSON backup older builds wrote, for the one-time cleanup check. */
  backupId?: string | null;
  choice?: MemoryChoice;
  cleanup?: "trash" | "keep";
  /** Visits Chrome synced from the user's other devices, read by the service worker. */
  otherDeviceVisits?: OtherDeviceVisit[];
}

function plainSyncError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (googleStatus(error) === 403) return forbiddenMessage(error);
  if (message === "google_401") {
    return "Google did not accept the sign-in. Press Enable to reconnect Google Drive.";
  }
  if (message === "google_bad_response") {
    return "Google sent a reply Cortex could not read. Cortex will try again.";
  }
  if (/failed to fetch/i.test(message)) {
    return "Cortex could not reach Google. Reload the extension and press Enable again.";
  }
  return message || "Sync did not start.";
}

function workResult(flush: FlushResult, created = false): AssistantSyncWorkResult {
  return {
    ok: flush.status === "ready",
    status: flush.status,
    appended: flush.appended,
    created,
    ...(flush.status === "auth" ? { authFailed: true } : {}),
    ...(flush.error ? { error: flush.error } : {}),
    ...(flush.errorDetail ? { errorDetail: flush.errorDetail } : {}),
    ...(flush.warning ? { warning: flush.warning } : {}),
    ...(flush.retryAt ? { retryAt: flush.retryAt } : {}),
    ...(flush.more ? { more: true } : {}),
    reads: flush.reads,
    writes: flush.writes,
  };
}

/** Token comes from the service worker. This function performs the Google fetches. */
export async function runAssistantSyncFromChrome(
  action: "alarm" | "now" | "enable" | "disable" | "cleanup",
  token: string,
  launch: AssistantSyncLaunch
): Promise<AssistantSyncWorkResult> {
  const store = memoryIdStore(launch.ids);
  try {
    if (action === "disable") {
      await disableAssistantSync();
      return { ok: true, status: "disabled", ids: store.current() };
    }
    if (action === "cleanup") {
      const answer = launch.cleanup ?? "keep";
      await answerLegacyCleanup(answer === "trash" ? new FetchDriveApi(token) : null, answer);
      return { ok: true, status: "ready", ids: store.current() };
    }
    const api = new FetchDriveApi(token);
    await applyAssistantSyncPreferences({ retentionDays: launch.retentionDays, sheetDetail: launch.sheetDetail });
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const now = Date.now();
    const loadLibraryPeople = async () => (await loadCortexHistory(0)).people;
    const legacy = async (ids: StoredMemoryIds) => {
      await checkLegacyFiles(api, ids, launch.backupId).catch(() => undefined);
    };
    if (action === "enable") {
      const result = await enableAssistantSync({
        api,
        ids: launch.ids,
        now,
        timeZone,
        saveIds: (next) => store.setIds(next),
        loadHistory: loadCortexHistory,
        loadLibraryPeople,
        choice: launch.choice,
      });
      if ("confirm" in result) {
        return { ok: false, status: "confirm", confirm: result.confirm, ids: store.current() };
      }
      if (result.flush.status === "ready") await legacy(result.ids);
      return { ...workResult(result.flush, result.created), ids: store.current() };
    }
    // Stored before the flush so they go out in this pass. Duplicates are skipped by id.
    await storeOtherDeviceVisits(launch.otherDeviceVisits ?? [], launch.ids);
    const flush = await runFlush({
      api,
      ids: launch.ids,
      now,
      timeZone,
      mode: action === "now" ? "user" : "scheduled",
      loadLibraryPeople,
    });
    if (flush.status === "ready") await legacy(launch.ids);
    return { ...workResult(flush), otherDeviceStored: true, ids: store.current() };
  } catch (error) {
    const message = plainSyncError(error);
    try {
      const state = await readSyncEngineState();
      await writeSyncEngineState({ ...state, lastError: message });
    } catch {
      /* The page still receives the message below. */
    }
    const detail = googleErrorDetail(error);
    return { ok: false, error: message, ...(detail ? { errorDetail: detail } : {}), ids: store.current() };
  }
}

/**
 * Live visit hook. An open visit waits for the tab to leave the page; the service
 * worker then calls finalizeVisit with the measured dwell.
 */
export async function captureVisitFromChrome(visit: {
  id: string;
  url: string;
  title: string;
  visitedAt: number;
  pageText?: string | null;
  open?: boolean;
  linkedInFields?: {
    kind: "person" | "company";
    name: string;
    headline?: string;
    company?: string;
    profileUrl: string;
  } | null;
  ownIds?: StoredMemoryIds | null;
}, embed?: (text: string) => Promise<number[] | null>): Promise<{ ok: true; stored: boolean }> {
  const state = await readSyncEngineState();
  if (!state.syncEnabled) return { ok: true, stored: false };
  const { captureFinalizedVisit } = await import(/* webpackChunkName: "assistant-sync-capture" */ "./capture");
  const result = await captureFinalizedVisit({
    id: visit.id,
    visitedAt: visit.visitedAt,
    title: visit.title,
    url: visit.url,
    dwellMinutes: null,
    maxScrollPct: null,
    pageText: visit.pageText ?? null,
    pageEmbedding: null,
    hasPasswordInput: false,
    userDenylist: state.userDenylist,
    referrer: null,
    linkedInDocument: null,
    linkedInFields: visit.linkedInFields ?? null,
    syncEnabled: true,
    open: visit.open === true,
    ownIds: visit.ownIds ?? null,
    embed,
  });
  return { ok: true, stored: result.stored };
}
