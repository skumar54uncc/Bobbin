import Dexie, { type EntityTable } from "dexie";
import type { PageType } from "./page-type";
import type { CompanySection, HowFound } from "./linkedin-selectors";
import type { SearchEngine } from "./search-capture";
import type { SheetDetail } from "./sheet-detail";

export interface SyncVisitRecord {
  id: string;
  visitedAt: number;
  title: string;
  url: string;
  domain: string;
  dwellMinutes: number | null;
  maxScrollPct: number | null;
  pageType: PageType;
  topics: string[];
  /**
   * Epoch ms when the visit ended (tab closed or navigated away). Unset while the
   * page is still open. Backfilled history rows are final on arrival.
   */
  finalizedAt?: number;
}

/** Page text kept until the visit ends, so the excerpt can depend on real dwell. Never synced. */
export interface SyncDraftRecord {
  id: string;
  text: string;
}

/** Where each tab's rows sit in the sheet, so a flush needs no reads. */
export interface SheetLayout {
  fileId: string;
  sheetIds: Record<string, number>;
  /** Data rows per tab, in sheet order, run-length encoded by date. The header row is not counted. */
  runs: Record<string, { date: string; count: number }[]>;
  /** Tabs whose header row is in the sheet. */
  headers?: Record<string, boolean>;
  aboutRows: number;
  verifiedAt: number;
  /** Visits header version: 4 has visit_count and last_time. Unset on layouts saved before it, which forces one read. */
  schema?: number;
  /** Columns in the Visits header when it was last read. Tells the migration which columns to fill. */
  visitColumns?: number;
  /** Tabs that carry Cortex's warning-only protection. */
  protectedIds?: number[];
}

/**
 * A row the sheet has. `date` and `ord` (its place among that date's rows, in
 * sheet order) locate it for an in-place update with no read. `sig` is a hash of
 * the cells last written. `of` marks a visit merged into another visit's row.
 */
export interface SyncedRecord {
  key: string;
  sig?: string;
  date?: string;
  ord?: number;
  of?: string;
}

/** A flush that was sent but not confirmed. Its presence after a restart triggers a recovery read. */
export interface InflightFlush {
  id: "inflight";
  fileId: string;
  keys: string[];
  startedAt: number;
}

export interface SyncContentRecord {
  id: string;
  visitedAt: number;
  title: string;
  url: string;
  topics: string[];
  excerpt: string;
}

export interface SyncSearchRecord {
  id: string;
  visitedAt: number;
  engine: SearchEngine;
  query: string;
}

export interface SyncPersonRecord {
  id: string;
  visitedAt: number;
  name: string;
  headline: string;
  company: string;
  profileUrl: string;
  howFound: HowFound | "";
  dwellMinutes: number | null;
  maxScrollPct: number | null;
}

export interface SyncCompanyRecord {
  id: string;
  visitedAt: number;
  company: string;
  sectionViewed: CompanySection | "";
  linkedinUrl: string;
  dwellMinutes: number | null;
}

/** One unsynced sheet row. Survives a restart until the append succeeds. */
export interface PendingSyncRow {
  key: string;
  tab: string;
  rowId: string;
  cells: string[];
  enqueuedAt: number;
}

export const SYNC_ENGINE_STATE_ID = "engine";
export const DEFAULT_RETENTION_DAYS = 90;
export const MIN_RETENTION_DAYS = 7;
export const MAX_RETENTION_DAYS = 365;
/** Safety alarm. Flushes anything still pending. */
export const ASSISTANT_SYNC_ALARM = "cortex-assistant-sync";
export const ASSISTANT_SYNC_ALARM_PERIOD_MIN = 15;
/** One-shot alarm for the next scheduled flush (activity, Sync now countdown, backoff). */
export const ASSISTANT_SYNC_SOON_ALARM = "cortex-assistant-sync-soon";
export type BackfillPhase = "idle" | "reading" | "writing" | "done";

export interface SyncEngineState {
  id: typeof SYNC_ENGINE_STATE_ID;
  syncEnabled: boolean;
  retentionDays: number;
  userDenylist: string[];
  lastError: string;
  /** Epoch ms of the last successful sync. 0 until the first one finishes. */
  lastSyncedAt: number;
  backfillDone: number;
  backfillTotal: number;
  backfillPhase: BackfillPhase;
  /** Epoch ms when the last flush request was sent, successful or not. Enforces one flush a minute. */
  lastFlushAt: number;
  /** Earliest epoch ms for the next attempt after a 429 or 5xx. 0 when no backoff is active. */
  nextAttemptAt: number;
  /** Failed flushes in a row (429 or 5xx). Drives the backoff exponent. */
  backoffFailures: number;
  /** Flushes in a row that ended in 429. Three of them start slow mode. */
  consecutive429: number;
  /** Until this epoch ms, flush only on the 15 minute cadence. */
  slowUntil: number;
  /** Google refused the token twice. Only Enable clears it. */
  authNeeded: boolean;
  /** The next flush reads the sheet first (startup check, recovery). */
  verifyNext: boolean;
  layout: SheetLayout | null;
  sheetDetail: SheetDetail;
  /** CSV size estimate of the sheet after the last flush. */
  sheetBytes: number;
  /** What the last trim removed. Shown for a week. */
  trimNote: string;
  trimmedAt: number;
  /** Old Drive JSON backups and monthly archives: not checked yet, none, waiting for the user, or the user's answer. */
  legacyCleanup: "unchecked" | "none" | "ask" | "trashed" | "kept";
  legacyFiles: { id: string; name: string }[];
}

export function clampRetentionDays(days: number): number {
  if (!Number.isFinite(days)) return DEFAULT_RETENTION_DAYS;
  return Math.max(MIN_RETENTION_DAYS, Math.min(MAX_RETENTION_DAYS, Math.round(days)));
}

export function defaultSyncEngineState(): SyncEngineState {
  return {
    id: SYNC_ENGINE_STATE_ID,
    syncEnabled: false,
    retentionDays: DEFAULT_RETENTION_DAYS,
    userDenylist: [],
    lastError: "",
    lastSyncedAt: 0,
    backfillDone: 0,
    backfillTotal: 0,
    backfillPhase: "idle",
    lastFlushAt: 0,
    nextAttemptAt: 0,
    backoffFailures: 0,
    consecutive429: 0,
    slowUntil: 0,
    authNeeded: false,
    verifyNext: false,
    layout: null,
    sheetDetail: "standard",
    sheetBytes: 0,
    trimNote: "",
    trimmedAt: 0,
    legacyCleanup: "unchecked",
    legacyFiles: [],
  };
}

class AssistantSyncDB extends Dexie {
  visits!: EntityTable<SyncVisitRecord, "id">;
  content!: EntityTable<SyncContentRecord, "id">;
  searches!: EntityTable<SyncSearchRecord, "id">;
  people!: EntityTable<SyncPersonRecord, "id">;
  companies!: EntityTable<SyncCompanyRecord, "id">;
  /** Keys are `Tab:id`. Cleared on a full local delete. */
  synced!: EntityTable<SyncedRecord, "key">;
  pending!: EntityTable<PendingSyncRow, "key">;
  state!: EntityTable<SyncEngineState, "id">;
  drafts!: EntityTable<SyncDraftRecord, "id">;
  inflight!: EntityTable<InflightFlush, "id">;

  constructor() {
    super("cortex-assistant-sync");
    this.version(1).stores({
      visits: "id, visitedAt, domain",
      content: "id, visitedAt",
      searches: "id, visitedAt",
      people: "id, visitedAt",
      companies: "id, visitedAt",
    });
    this.version(2).stores({
      visits: "id, visitedAt, domain",
      content: "id, visitedAt",
      searches: "id, visitedAt",
      people: "id, visitedAt",
      companies: "id, visitedAt",
      synced: "key",
    });
    this.version(3).stores({
      visits: "id, visitedAt, domain",
      content: "id, visitedAt",
      searches: "id, visitedAt",
      people: "id, visitedAt",
      companies: "id, visitedAt",
      synced: "key",
      pending: "key, tab, enqueuedAt",
      state: "id",
    });
    this.version(4)
      .stores({
        visits: "id, visitedAt, domain, finalizedAt",
        content: "id, visitedAt",
        searches: "id, visitedAt",
        people: "id, visitedAt",
        companies: "id, visitedAt",
        synced: "key",
        pending: "key, tab, enqueuedAt",
        state: "id",
        drafts: "id",
        inflight: "id",
      })
      .upgrade(async (tx) => {
        // Rows captured before dwell tracking are final as they are.
        await tx.table("visits").toCollection().modify((visit: SyncVisitRecord) => {
          if (visit.finalizedAt == null) visit.finalizedAt = visit.visitedAt;
        });
      });
  }
}

export const assistantSyncDb = new AssistantSyncDB();

export async function clearAssistantSyncDatabase(): Promise<void> {
  await assistantSyncDb.transaction(
    "rw",
    [
      assistantSyncDb.visits,
      assistantSyncDb.content,
      assistantSyncDb.searches,
      assistantSyncDb.people,
      assistantSyncDb.companies,
      assistantSyncDb.synced,
      assistantSyncDb.pending,
      assistantSyncDb.state,
      assistantSyncDb.drafts,
      assistantSyncDb.inflight,
    ],
    async () => {
      await assistantSyncDb.drafts.clear();
      await assistantSyncDb.inflight.clear();
      await assistantSyncDb.visits.clear();
      await assistantSyncDb.content.clear();
      await assistantSyncDb.searches.clear();
      await assistantSyncDb.people.clear();
      await assistantSyncDb.companies.clear();
      await assistantSyncDb.synced.clear();
      await assistantSyncDb.pending.clear();
      await assistantSyncDb.state.clear();
    }
  );
}

export async function readSyncEngineState(): Promise<SyncEngineState> {
  const row = await assistantSyncDb.state.get(SYNC_ENGINE_STATE_ID);
  return { ...defaultSyncEngineState(), ...row, id: SYNC_ENGINE_STATE_ID };
}

export async function writeSyncEngineState(state: SyncEngineState): Promise<void> {
  await assistantSyncDb.state.put({ ...state, id: SYNC_ENGINE_STATE_ID });
}

/** Finished page visits the sheet does not have yet. The status line counts these. */
export async function countUnsyncedVisits(): Promise<number> {
  const synced = new Set((await assistantSyncDb.synced.toCollection().primaryKeys()).map(String));
  return assistantSyncDb.visits.filter((row) => row.finalizedAt != null && !synced.has(`Visits:${row.id}`)).count();
}

/** The service worker points this at the offscreen Drive client. Tests replace it. */
export type DriveFolderTrash = () => Promise<void>;

let trashDriveFolder: DriveFolderTrash = async () => {};

export function setDriveFolderTrashHandler(handler: DriveFolderTrash): void {
  trashDriveFolder = handler;
}

/**
 * Full local delete. Clears synced id tracking, then trashes the Drive folder
 * when a handler is registered. If the trash call fails, the local rows are
 * already gone and the error propagates so the caller can say Drive may remain.
 */
export async function wipeAssistantSyncOnLocalDelete(): Promise<void> {
  await clearAssistantSyncDatabase();
  await trashDriveFolder();
}
