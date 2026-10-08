import { canonicalizeUrl, domainFromUrl } from "./canonical-url";
import {
  assistantSyncDb,
  clampRetentionDays,
  readSyncEngineState,
  writeSyncEngineState,
  type BackfillPhase,
  type SheetLayout,
  type SyncCompanyRecord,
  type SyncContentRecord,
  type SyncEngineState,
  type SyncPersonRecord,
  type SyncSearchRecord,
  type SyncVisitRecord,
} from "./db";
import { syncDenyReason } from "./denylist";
import {
  googleStatus,
  inspectMemory,
  reenableMemory,
  syncedKey,
  type DriveApi,
  type DriveMemoryStatus,
  type StoredMemoryIds,
} from "./drive-api";
import {
  addSheetRequest,
  appendCellsRequest,
  appendRuns,
  dailyRowIndex,
  deleteRowsRequest,
  rowCount,
  runsFromDates,
  staleRanges,
  updateCellsRequest,
} from "./flush-plan";
import { localVisitStamp } from "./local-time";
import { pageTypeForUrl } from "./page-type";
import { redactForSync } from "./redact-sync";
import {
  MIN_FLUSH_GAP_MS,
  retryDelayMs,
  SLOW_AFTER_429,
  SLOW_MODE_MS,
} from "./schedule";
import { parseSearchQuery } from "./search-capture";
import {
  aboutRows,
  cellWarning,
  companyRows,
  contentRows,
  dailyRows,
  peopleRows,
  searchRows,
  SHEET_TABS,
  TAB_HEADERS,
  visitRows,
  type SheetTabName,
} from "./sheet";

export const DAY_MS = 86_400_000;
/** Google recommends request bodies under 2 MB. A backlog larger than this goes out over several flushes. */
export const FLUSH_BYTE_BUDGET = 1_500_000;

export const SYNC_MISSING_MESSAGE =
  "The Cortex Memory file is missing from Drive. Sync will stay paused until you turn it on again.";
export const SYNC_TRASHED_MESSAGE =
  "The Cortex Memory file is in the trash. Sync will stay paused until you turn it on again.";
export const SYNC_ABSENT_MESSAGE =
  "Cortex Memory has not been created in Drive yet. Turn sync on to create it.";
export const SYNC_REJECTED_MESSAGE =
  "Google did not accept the last update. Cortex will check the sheet and try again.";
export const SYNC_FORBIDDEN_MESSAGE =
  "Google refused the Drive call. Enable the Google Drive API and the Google Sheets API in this Cloud project, then press Enable again.";

type DataTab = Exclude<SheetTabName, "About">;
const DATA_TABS: DataTab[] = ["Visits", "Content", "Searches", "People", "Companies", "Daily"];
const ROW_TABS: Exclude<DataTab, "Daily">[] = ["Visits", "Content", "Searches", "People", "Companies"];

export interface HistoryVisit {
  id: string;
  url: string;
  title: string;
  visitedAt: number;
}

export interface HistoryPerson {
  profileUrl: string;
  name: string;
  headline: string;
  company: string;
  kind: "person" | "company";
  seenAt: number;
}

export interface BackfillProgress {
  done: number;
  total: number;
  phase: BackfillPhase;
}

/** scheduled: alarms. user: Sync now. enable: the Enable click (always reads the sheet first). */
export type FlushMode = "scheduled" | "user" | "enable";

export interface FlushDeps {
  api: DriveApi;
  ids: StoredMemoryIds;
  now: number;
  timeZone: string;
  mode: FlushMode;
  random?: () => number;
  /** LinkedIn people/companies already in the local Cortex library. */
  loadLibraryPeople?: () => Promise<HistoryPerson[]>;
}

export interface FlushResult {
  status: DriveMemoryStatus | "disabled" | "auth" | "throttled" | "error";
  appended: number;
  /** Sheets read and write requests this flush made. Drive file checks are not counted. */
  reads: number;
  writes: number;
  /** More rows are waiting than fit in one request. */
  more?: boolean;
  /** Earliest epoch ms for the next attempt. */
  retryAt?: number;
  error?: string;
  warning?: string;
}

export function retentionCutoffMs(now: number, retentionDays: number): number {
  return now - clampRetentionDays(retentionDays) * DAY_MS;
}

function statusMessage(status: DriveMemoryStatus): string {
  if (status === "missing") return SYNC_MISSING_MESSAGE;
  if (status === "trashed") return SYNC_TRASHED_MESSAGE;
  return SYNC_ABSENT_MESSAGE;
}

function dateOf(visitedAt: number, timeZone: string): string {
  return localVisitStamp(visitedAt, timeZone).date;
}

function syncedAtLabel(now: number, timeZone: string): string {
  const stamp = localVisitStamp(now, timeZone);
  return `${stamp.date} ${stamp.time}`;
}

interface Memory {
  visits: SyncVisitRecord[];
  content: SyncContentRecord[];
  searches: SyncSearchRecord[];
  people: SyncPersonRecord[];
  companies: SyncCompanyRecord[];
}

async function loadMemory(): Promise<Memory> {
  const [visits, content, searches, people, companies] = await Promise.all([
    assistantSyncDb.visits.toArray(),
    assistantSyncDb.content.toArray(),
    assistantSyncDb.searches.toArray(),
    assistantSyncDb.people.toArray(),
    assistantSyncDb.companies.toArray(),
  ]);
  return { visits, content, searches, people, companies };
}

/** Only rows of visits that have ended. An open page is still collecting dwell. */
function finalOnly(memory: Memory): Memory {
  const open = new Set(memory.visits.filter((row) => row.finalizedAt == null).map((row) => row.id));
  const keep = <T extends { id: string }>(rows: T[]) => rows.filter((row) => !open.has(row.id));
  return {
    visits: keep(memory.visits),
    content: keep(memory.content),
    searches: keep(memory.searches),
    people: keep(memory.people),
    companies: keep(memory.companies),
  };
}

async function syncedSet(): Promise<Set<string>> {
  const keys = await assistantSyncDb.synced.toCollection().primaryKeys();
  return new Set(keys.map(String));
}

async function markSynced(keys: string[]): Promise<void> {
  if (!keys.length) return;
  await assistantSyncDb.synced.bulkPut(keys.map((key) => ({ key })));
  await assistantSyncDb.pending.bulkDelete(keys);
}

async function dropKeys(keys: string[]): Promise<void> {
  if (!keys.length) return;
  await assistantSyncDb.synced.bulkDelete(keys);
  await assistantSyncDb.pending.bulkDelete(keys);
}

/**
 * Two Sheets reads: the tab ids, then column A (ids) and B (dates) of every tab.
 * Rebuilds the cached layout and returns the ids already in the sheet.
 */
async function readLayout(api: DriveApi, fileId: string, now: number): Promise<{ layout: SheetLayout; found: string[] }> {
  const sheetIds = await api.getSheetIds(fileId);
  const present = DATA_TABS.filter((tab) => sheetIds[tab] != null);
  const ranges = ["About!A:A", ...present.map((tab) => (tab === "Daily" ? "Daily!A:A" : `${tab}!A:B`))];
  const columns = await api.readColumns(fileId, sheetIds.About != null ? ranges : ranges.slice(1));
  const offset = sheetIds.About != null ? 1 : 0;
  const runs: SheetLayout["runs"] = {};
  const headers: Record<string, boolean> = {};
  const found: string[] = [];
  present.forEach((tab, i) => {
    const rows = columns[i + offset] ?? [];
    headers[tab] = rows.length > 0;
    const data = rows.slice(1);
    runs[tab] = runsFromDates(data.map((row) => (tab === "Daily" ? row[0] : row[1]) ?? ""));
    for (const row of data) if (row[0]) found.push(syncedKey(tab, row[0]));
  });
  return {
    layout: { fileId, sheetIds, runs, headers, aboutRows: offset ? (columns[0] ?? []).length : 0, verifiedAt: now },
    found,
  };
}

/** Local rows past retention go, along with their sync keys. The sheet rows go in the same flush. */
async function purgeLocal(cutoffDate: string, timeZone: string): Promise<void> {
  const memory = await loadMemory();
  const old = <T extends { id: string; visitedAt: number }>(rows: T[]) =>
    rows.filter((row) => dateOf(row.visitedAt, timeZone) < cutoffDate).map((row) => row.id);
  const visits = old(memory.visits);
  const content = old(memory.content);
  const searches = old(memory.searches);
  const people = old(memory.people);
  const companies = old(memory.companies);
  const days = new Set(memory.visits.filter((row) => dateOf(row.visitedAt, timeZone) < cutoffDate).map((row) => dateOf(row.visitedAt, timeZone)));
  await assistantSyncDb.visits.bulkDelete(visits);
  await assistantSyncDb.content.bulkDelete(content);
  await assistantSyncDb.searches.bulkDelete(searches);
  await assistantSyncDb.people.bulkDelete(people);
  await assistantSyncDb.companies.bulkDelete(companies);
  await assistantSyncDb.drafts.bulkDelete(visits);
  await dropKeys([
    ...visits.map((id) => syncedKey("Visits", id)),
    ...content.map((id) => syncedKey("Content", id)),
    ...searches.map((id) => syncedKey("Searches", id)),
    ...people.map((id) => syncedKey("People", id)),
    ...companies.map((id) => syncedKey("Companies", id)),
    ...[...days].map((date) => syncedKey("Daily", date)),
  ]);
}

/** Queues every finalized row the sheet does not have yet. */
async function enqueueUnsynced(timeZone: string, now: number, synced: Set<string>): Promise<void> {
  const memory = finalOnly(await loadMemory());
  const queued = new Set((await assistantSyncDb.pending.toCollection().primaryKeys()).map(String));
  const rows: { key: string; tab: string; rowId: string; cells: string[]; enqueuedAt: number }[] = [];
  const consider = (tab: SheetTabName, built: string[][]) => {
    for (const cells of built.slice(1)) {
      const rowId = cells[0] ?? "";
      const key = syncedKey(tab, rowId);
      if (!rowId || synced.has(key) || queued.has(key)) continue;
      queued.add(key);
      rows.push({ key, tab, rowId, cells, enqueuedAt: now });
    }
  };
  consider("Visits", visitRows(memory.visits, timeZone));
  consider("Content", contentRows(memory.content, timeZone));
  consider("Searches", searchRows(memory.searches, timeZone));
  consider("People", peopleRows(memory.people, timeZone));
  consider("Companies", companyRows(memory.companies, timeZone));
  if (rows.length) await assistantSyncDb.pending.bulkPut(rows);
}

function rowBytes(cells: string[]): number {
  return cells.reduce((n, cell) => n + cell.length + 48, 16);
}

interface Plan {
  requests: object[];
  keys: string[];
  layout: SheetLayout;
  appended: number;
  more: boolean;
}

async function planFlush(
  layoutIn: SheetLayout,
  state: SyncEngineState,
  deps: FlushDeps,
  synced: Set<string>
): Promise<Plan> {
  const layout: SheetLayout = structuredClone(layoutIn);
  layout.headers ??= {};
  const adds: object[] = [];
  const deletes: object[] = [];
  const appends: object[] = [];
  const updates: object[] = [];
  const keys: string[] = [];

  let nextSheetId = Math.max(-1, ...Object.values(layout.sheetIds)) + 1;
  for (const tab of SHEET_TABS) {
    if (layout.sheetIds[tab] != null) continue;
    layout.sheetIds[tab] = nextSheetId;
    adds.push(addSheetRequest(nextSheetId, tab, SHEET_TABS.indexOf(tab)));
    layout.runs[tab] = [];
    layout.headers[tab] = false;
    nextSheetId += 1;
  }

  const cutoffDate = dateOf(retentionCutoffMs(deps.now, state.retentionDays), deps.timeZone);
  await purgeLocal(cutoffDate, deps.timeZone);
  for (const tab of DATA_TABS) {
    const { ranges, kept } = staleRanges(layout.runs[tab] ?? [], cutoffDate);
    for (const range of ranges) deletes.push(deleteRowsRequest(layout.sheetIds[tab]!, range));
    layout.runs[tab] = kept;
  }

  await enqueueUnsynced(deps.timeZone, deps.now, synced);
  const pending = (await assistantSyncDb.pending.toArray())
    .filter((row) => !synced.has(row.key) && (ROW_TABS as string[]).includes(row.tab))
    .sort((a, b) => `${a.cells[1]} ${a.cells[3]}`.localeCompare(`${b.cells[1]} ${b.cells[3]}`));
  let budget = FLUSH_BYTE_BUDGET;
  const chosen: typeof pending = [];
  for (const row of pending) {
    const size = rowBytes(row.cells);
    if (chosen.length && size > budget) break;
    chosen.push(row);
    budget -= size;
  }
  const more = chosen.length < pending.length;

  const touchedDates = new Set<string>();
  for (const tab of ROW_TABS) {
    const rows = chosen.filter((row) => row.tab === tab);
    const withHeader = !layout.headers[tab] && (rows.length > 0 || deps.mode === "enable");
    if (!rows.length && !withHeader) continue;
    const out = withHeader ? [[...TAB_HEADERS[tab]], ...rows.map((row) => row.cells)] : rows.map((row) => row.cells);
    appends.push(appendCellsRequest(layout.sheetIds[tab]!, out));
    layout.headers[tab] = true;
    layout.runs[tab] = appendRuns(layout.runs[tab] ?? [], rows.map((row) => row.cells[1] ?? ""));
    for (const row of rows) {
      keys.push(row.key);
      if (row.cells[1]) touchedDates.add(row.cells[1]);
    }
  }

  const memory = finalOnly(await loadMemory());
  if (touchedDates.size || (deps.mode === "enable" && !layout.headers.Daily)) {
    const daily = new Map(dailyRows(memory, deps.timeZone).slice(1).map((row) => [row[0] ?? "", row]));
    const fresh: string[][] = [];
    for (const date of [...touchedDates].sort()) {
      const row = daily.get(date);
      if (!row) continue;
      const at = dailyRowIndex(layout.runs.Daily ?? [], date);
      if (at != null) updates.push(updateCellsRequest(layout.sheetIds.Daily!, at, [row]));
      else fresh.push(row);
      keys.push(syncedKey("Daily", date));
    }
    if (fresh.length || !layout.headers.Daily) {
      const out = layout.headers.Daily ? fresh : [[...TAB_HEADERS.Daily], ...fresh];
      appends.push(appendCellsRequest(layout.sheetIds.Daily!, out));
      layout.headers.Daily = true;
      layout.runs.Daily = appendRuns(layout.runs.Daily ?? [], fresh.map((row) => row[0] ?? ""));
    }
  }

  const changed = adds.length + deletes.length + appends.length + updates.length > 0;
  if (changed) {
    const dates = memory.visits.map((row) => dateOf(row.visitedAt, deps.timeZone)).sort();
    const about = aboutRows({
      firstDate: dates[0] ?? "",
      lastDate: dates[dates.length - 1] ?? "",
      syncedAt: syncedAtLabel(deps.now, deps.timeZone),
      timeZone: deps.timeZone,
      visits: memory.visits.length,
      content: memory.content.length,
      searches: memory.searches.length,
      people: memory.people.length,
      companies: memory.companies.length,
    });
    const padded = [...about];
    while (padded.length < layout.aboutRows) padded.push([""]);
    updates.push(updateCellsRequest(layout.sheetIds.About!, 0, padded));
    layout.aboutRows = about.length;
  }

  return { requests: [...adds, ...deletes, ...appends, ...updates], keys, layout, appended: keys.length, more };
}

function cellEstimate(layout: SheetLayout): number {
  let cells = 0;
  for (const tab of DATA_TABS) cells += (rowCount(layout.runs[tab]) + 1) * TAB_HEADERS[tab].length;
  return cells;
}

/**
 * One flush. A normal flush makes no Sheets reads and exactly one write.
 * Reads happen on Enable, on the daily startup check (`verifyNext`), and after a
 * flush whose outcome is unknown. Never creates a Drive file.
 */
export async function runFlush(deps: FlushDeps): Promise<FlushResult> {
  const state = await readSyncEngineState();
  const counts = { reads: 0, writes: 0 };
  const result = (out: Omit<FlushResult, "reads" | "writes">): FlushResult => ({ ...out, ...counts });
  if (!state.syncEnabled) return result({ status: "disabled", appended: 0 });
  if (state.authNeeded && deps.mode !== "enable") return result({ status: "auth", appended: 0 });
  if (deps.mode !== "enable") {
    const floor = state.lastFlushAt + MIN_FLUSH_GAP_MS;
    const gate = deps.mode === "user" ? floor : Math.max(floor, state.nextAttemptAt);
    if (gate > deps.now) return result({ status: "throttled", appended: 0, retryAt: gate });
  }
  const fileId = deps.ids.fileId;
  if (!fileId || !deps.ids.folderId) {
    state.lastError = SYNC_ABSENT_MESSAGE;
    await writeSyncEngineState(state);
    return result({ status: "absent", appended: 0, error: SYNC_ABSENT_MESSAGE });
  }

  let sent = false;
  const priorFlushAt = state.lastFlushAt;
  try {
    const inflight = await assistantSyncDb.inflight.get("inflight");
    const verify =
      deps.mode === "enable" || state.verifyNext || inflight != null || !state.layout || state.layout.fileId !== fileId;
    const synced = await syncedSet();
    let layout = state.layout;
    if (verify) {
      const status = await inspectMemory(deps.api, deps.ids);
      if (status !== "ready") {
        state.lastError = statusMessage(status);
        await writeSyncEngineState(state);
        return result({ status, appended: 0, error: state.lastError });
      }
      counts.reads += 2;
      const read = await readLayout(deps.api, fileId, deps.now);
      layout = read.layout;
      for (const key of read.found) synced.add(key);
      await markSynced(read.found);
      await assistantSyncDb.inflight.delete("inflight");
      state.verifyNext = false;
      state.layout = layout;
      await writeSyncEngineState(state);
    }

    if (deps.loadLibraryPeople) {
      await seedPeopleFromLibrary({
        people: await deps.loadLibraryPeople(),
        now: deps.now,
        retentionDays: state.retentionDays,
      });
    }

    const plan = await planFlush(layout!, state, deps, synced);
    if (!plan.requests.length) {
      state.lastError = "";
      await writeSyncEngineState(state);
      return result({ status: "ready", appended: 0 });
    }

    await assistantSyncDb.inflight.put({ id: "inflight", fileId, keys: plan.keys, startedAt: deps.now });
    state.lastFlushAt = deps.now;
    await writeSyncEngineState(state);
    sent = true;
    counts.writes += 1;
    await deps.api.batchUpdate(fileId, plan.requests);

    await markSynced(plan.keys);
    await assistantSyncDb.inflight.delete("inflight");
    Object.assign(state, {
      layout: plan.layout,
      lastSyncedAt: deps.now,
      lastError: "",
      backoffFailures: 0,
      consecutive429: 0,
      nextAttemptAt: 0,
    });
    await writeSyncEngineState(state);
    const warning = cellWarning(cellEstimate(plan.layout));
    return result({
      status: "ready",
      appended: plan.appended,
      ...(plan.more ? { more: true, retryAt: deps.now + MIN_FLUSH_GAP_MS } : {}),
      ...(warning ? { warning } : {}),
    });
  } catch (error) {
    return result(await recordFailure(state, deps, error, sent, priorFlushAt));
  }
}

/**
 * A 429 or 4xx means Google applied nothing. A 5xx or a lost connection after the
 * request left leaves the outcome unknown, so the next flush reads the sheet first.
 */
async function recordFailure(
  state: SyncEngineState,
  deps: FlushDeps,
  error: unknown,
  sent: boolean,
  priorFlushAt: number
): Promise<Omit<FlushResult, "reads" | "writes">> {
  const status = googleStatus(error);
  const unknownOutcome = sent && (status == null || status >= 500);
  if (sent && !unknownOutcome) await assistantSyncDb.inflight.delete("inflight");
  if (unknownOutcome || status === 400 || status === 404) state.verifyNext = true;
  if (status === 401) {
    // Nothing was applied, so the retry with a fresh token is not held to the one-a-minute floor.
    state.lastFlushAt = priorFlushAt;
    await writeSyncEngineState(state);
    return { status: "auth", appended: 0 };
  }
  state.backoffFailures += 1;
  state.consecutive429 = status === 429 ? state.consecutive429 + 1 : 0;
  if (state.consecutive429 >= SLOW_AFTER_429) state.slowUntil = deps.now + SLOW_MODE_MS;
  state.nextAttemptAt = deps.now + retryDelayMs(state.backoffFailures, deps.random);
  state.lastError =
    status === 403
      ? SYNC_FORBIDDEN_MESSAGE
      : status === 404
        ? SYNC_MISSING_MESSAGE
        : status === 400
          ? SYNC_REJECTED_MESSAGE
          : "";
  await writeSyncEngineState(state);
  return {
    status: "error",
    appended: 0,
    retryAt: state.nextAttemptAt,
    ...(state.lastError ? { error: state.lastError } : {}),
  };
}

/**
 * Copy LinkedIn people/companies already stored in Cortex onto Assist Sync
 * People/Companies rows when that profile URL was visited inside retention.
 * Does not call Google.
 */
export async function seedPeopleFromLibrary(input: {
  people: HistoryPerson[];
  now: number;
  retentionDays: number;
}): Promise<number> {
  if (!input.people.length) return 0;
  const cutoff = retentionCutoffMs(input.now, input.retentionDays);
  const peopleByUrl = new Map(
    input.people.map((person) => [canonicalizeUrl(person.profileUrl) ?? person.profileUrl, person])
  );
  const visits = await assistantSyncDb.visits.where("visitedAt").aboveOrEqual(cutoff).toArray();
  let added = 0;
  for (const visit of visits) {
    const linked = peopleByUrl.get(visit.url);
    if (!linked) continue;
    if (linked.kind === "person" && linked.name.trim()) {
      const existing = await assistantSyncDb.people.get(visit.id);
      if (existing) continue;
      await assistantSyncDb.people.put({
        id: visit.id,
        visitedAt: visit.visitedAt,
        name: redactForSync(linked.name),
        headline: redactForSync(linked.headline),
        company: redactForSync(linked.company),
        profileUrl: canonicalizeUrl(linked.profileUrl) ?? linked.profileUrl,
        howFound: "",
        dwellMinutes: visit.dwellMinutes,
        maxScrollPct: visit.maxScrollPct,
      });
      added += 1;
    } else if (linked.kind === "company" && (linked.company.trim() || linked.name.trim())) {
      const existing = await assistantSyncDb.companies.get(visit.id);
      if (existing) continue;
      await assistantSyncDb.companies.put({
        id: visit.id,
        visitedAt: visit.visitedAt,
        company: redactForSync(linked.company.trim() || linked.name),
        sectionViewed: "",
        linkedinUrl: canonicalizeUrl(linked.profileUrl) ?? linked.profileUrl,
        dwellMinutes: visit.dwellMinutes,
      });
      added += 1;
    }
  }
  return added;
}

/** Turn sync off. Leaves Drive files in place unless the user chooses Delete all. */
export async function disableAssistantSync(): Promise<SyncEngineState> {
  const state = await readSyncEngineState();
  const next: SyncEngineState = {
    ...state,
    syncEnabled: false,
    lastError: "",
    backoffFailures: 0,
    nextAttemptAt: 0,
    backfillPhase: "idle",
  };
  await writeSyncEngineState(next);
  return next;
}

export async function backfillHistory(input: {
  history: HistoryVisit[];
  people: HistoryPerson[];
  now: number;
  retentionDays: number;
  timeZone: string;
  userDenylist?: string[];
  onProgress?: (progress: BackfillProgress) => Promise<void> | void;
}): Promise<{ stored: number; skipped: number; total: number }> {
  const cutoff = retentionCutoffMs(input.now, input.retentionDays);
  const inWindow = input.history.filter((visit) => visit.visitedAt >= cutoff);
  const progress: BackfillProgress = { done: 0, total: inWindow.length, phase: "reading" };
  const report = async (phase: BackfillPhase) => {
    progress.phase = phase;
    const state = await readSyncEngineState();
    state.backfillDone = progress.done;
    state.backfillTotal = progress.total;
    state.backfillPhase = phase;
    await writeSyncEngineState(state);
    await input.onProgress?.({ ...progress });
  };
  await report("reading");
  const existing = await assistantSyncDb.visits.toArray();
  const seen = new Set(existing.map((row) => `${row.url}\t${row.visitedAt}`));
  const peopleByUrl = new Map(input.people.map((person) => [canonicalizeUrl(person.profileUrl) ?? person.profileUrl, person]));
  let stored = 0;
  let skipped = 0;
  for (const visit of inWindow) {
    const canonical = canonicalizeUrl(visit.url);
    const denied = !canonical || syncDenyReason(visit.url, { userDomains: input.userDenylist }) != null;
    const duplicate = canonical != null && seen.has(`${canonical}\t${visit.visitedAt}`);
    if (denied || duplicate || !canonical) {
      skipped += 1;
    } else {
      const title = redactForSync(visit.title.replace(/\s+/g, " ").trim());
      // History has no dwell. The visit is final as it is; dwell stays blank, never invented.
      await assistantSyncDb.visits.put({
        id: visit.id,
        visitedAt: visit.visitedAt,
        title,
        url: canonical,
        domain: domainFromUrl(canonical),
        dwellMinutes: null,
        maxScrollPct: null,
        pageType: pageTypeForUrl(canonical),
        topics: [],
        finalizedAt: visit.visitedAt,
      });
      const search = parseSearchQuery(visit.url);
      if (search) {
        await assistantSyncDb.searches.put({
          id: visit.id,
          visitedAt: visit.visitedAt,
          engine: search.engine,
          query: redactForSync(search.query),
        });
      }
      const linked = peopleByUrl.get(canonical);
      if (linked?.kind === "person" && linked.name.trim()) {
        await assistantSyncDb.people.put({
          id: visit.id,
          visitedAt: visit.visitedAt,
          name: redactForSync(linked.name),
          headline: redactForSync(linked.headline),
          company: redactForSync(linked.company),
          profileUrl: canonical,
          howFound: "",
          dwellMinutes: null,
          maxScrollPct: null,
        });
      } else if (linked?.kind === "company" && (linked.company.trim() || linked.name.trim())) {
        await assistantSyncDb.companies.put({
          id: visit.id,
          visitedAt: visit.visitedAt,
          company: redactForSync(linked.company.trim() || linked.name),
          sectionViewed: "",
          linkedinUrl: canonical,
          dwellMinutes: null,
        });
      }
      seen.add(`${canonical}\t${visit.visitedAt}`);
      stored += 1;
    }
    progress.done += 1;
    await report("writing");
  }
  await report("done");
  return { stored, skipped, total: inWindow.length };
}

export async function enableAssistantSync(input: {
  api: DriveApi;
  ids: StoredMemoryIds;
  now: number;
  timeZone: string;
  retentionDays?: number;
  history?: HistoryVisit[];
  people?: HistoryPerson[];
  loadHistory?: (cutoffMs: number) => Promise<{ visits: HistoryVisit[]; people: HistoryPerson[] }>;
  loadLibraryPeople?: () => Promise<HistoryPerson[]>;
  saveIds: (ids: StoredMemoryIds) => Promise<void>;
  random?: () => number;
  onProgress?: (progress: BackfillProgress) => Promise<void> | void;
}): Promise<{ ids: StoredMemoryIds; created: boolean; backfill: { stored: number; skipped: number; total: number }; flush: FlushResult }> {
  const previous = await readSyncEngineState();
  const retentionDays = clampRetentionDays(input.retentionDays ?? previous.retentionDays);
  const state: SyncEngineState = {
    ...previous,
    syncEnabled: true,
    retentionDays,
    authNeeded: false,
    backoffFailures: 0,
    consecutive429: 0,
    nextAttemptAt: 0,
    lastError: "",
  };
  await writeSyncEngineState(state);
  const ids = await reenableMemory(input.api, input.ids);
  const created = ids.fileId !== input.ids.fileId || ids.folderId !== input.ids.folderId;
  if (created) {
    // A new file has nothing in it yet. Every row goes again.
    await assistantSyncDb.synced.clear();
    await writeSyncEngineState({ ...(await readSyncEngineState()), layout: null });
  }
  await input.saveIds(ids);
  const loaded = input.history
    ? { visits: input.history, people: input.people ?? [] }
    : await input.loadHistory?.(retentionCutoffMs(input.now, retentionDays)) ?? { visits: [], people: [] };
  const backfill = await backfillHistory({
    history: loaded.visits,
    people: loaded.people,
    now: input.now,
    retentionDays,
    timeZone: input.timeZone,
    userDenylist: previous.userDenylist,
    onProgress: input.onProgress,
  });
  const flush = await runFlush({
    api: input.api,
    ids,
    now: input.now,
    timeZone: input.timeZone,
    mode: "enable",
    random: input.random,
    loadLibraryPeople: input.loadLibraryPeople,
  });
  return { ids, created, backfill, flush };
}
