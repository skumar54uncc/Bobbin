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
  type SyncedRecord,
  type SyncEngineState,
  type SyncPersonRecord,
  type SyncSearchRecord,
  type SyncVisitRecord,
} from "./db";
import { syncDenyReason } from "./denylist";
import {
  findLegacyFiles,
  googleErrorDetail,
  googleStatus,
  inspectMemory,
  resolveMemory,
  syncedKey,
  type DriveApi,
  type DriveMemoryStatus,
  type GoogleErrorDetail,
  type MemoryChoice,
  type StoredMemoryIds,
} from "./drive-api";
import {
  addSheetRequest,
  appendCellsRequest,
  appendRuns,
  copyColumnRequest,
  dailyRowIndex,
  deleteRowsRequest,
  fillColumnRequest,
  rowCount,
  rowIndexOf,
  rowsOnDate,
  runsFromDates,
  staleRanges,
  updateCellsRequest,
} from "./flush-plan";
import { localVisitStamp } from "./local-time";
import { mergeDailyRepeats } from "./merge";
import { pageTypeForUrl } from "./page-type";
import { redactForSync, syncTitle } from "./redact-sync";
import {
  MIN_FLUSH_GAP_MS,
  retryDelayMs,
  SLOW_AFTER_429,
  SLOW_MODE_MS,
} from "./schedule";
import { parseSearchQuery } from "./search-capture";
import {
  cellWarning,
  DATE_COLUMN,
  dataTabs,
  protectTabRequest,
  SCHEMA_VERSION,
  SHEET_TABS,
  sizedAbout,
  TAB_HEADERS,
  VISIT_HEADERS,
  THIS_DEVICE,
  type SheetTabName,
} from "./sheet";
import { csvLineBytes, planTrim, SHEET_DETAIL, trimNote, type SheetDetail, type TrimTab } from "./sheet-detail";

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
export const SYNC_FORBIDDEN_MESSAGE = "Google did not allow Cortex to create or edit the sheet.";

/** The 403 message, with Google's own words when the reply had them. */
export function forbiddenMessage(error: unknown): string {
  const said = googleErrorDetail(error)?.message.trim();
  return said ? `${SYNC_FORBIDDEN_MESSAGE} Google said: ${said}` : SYNC_FORBIDDEN_MESSAGE;
}

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
  /** The failed Google call, for the flush log. */
  errorDetail?: GoogleErrorDetail;
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

type SyncedMap = Map<string, SyncedRecord>;

async function syncedMap(): Promise<SyncedMap> {
  const rows = await assistantSyncDb.synced.toArray();
  return new Map(rows.map((row) => [row.key, row]));
}

async function markSynced(records: SyncedRecord[]): Promise<void> {
  if (!records.length) return;
  await assistantSyncDb.synced.bulkPut(records);
}

async function dropKeys(keys: string[]): Promise<void> {
  if (!keys.length) return;
  await assistantSyncDb.synced.bulkDelete(keys);
}

/** Short hash of a row's cells. A changed hash means the row needs rewriting. */
function signature(cells: string[]): string {
  const text = cells.join("\u001f");
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ cells.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b ^ c, 2246822507);
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

export type TabCutoffDates = Record<DataTab, string>;

/**
 * Per tab, rows dated before this date leave the sheet and local memory.
 * Retention bounds every tab. Sheet detail tightens Content, and in compact
 * mode the row tabs. Daily follows retention only.
 */
export function tabCutoffs(now: number, timeZone: string, retentionDays: number, detail: SheetDetail): TabCutoffDates {
  const at = (days: number) => dateOf(now - days * DAY_MS, timeZone);
  const later = (a: string, b: string) => (a > b ? a : b);
  const retention = dateOf(retentionCutoffMs(now, retentionDays), timeZone);
  const rules = SHEET_DETAIL[detail];
  const rows = rules.rowDays == null ? retention : later(retention, at(rules.rowDays));
  return {
    Visits: rows,
    Content: later(rows, at(rules.contentDays)),
    Searches: rows,
    People: rows,
    Companies: rows,
    Daily: retention,
  };
}

/**
 * Two Sheets reads: the tab ids, then column A (ids) and B (dates) of every tab.
 * Rebuilds the cached layout and returns the rows already in the sheet, each
 * with its date and place among that date's rows. Hashes already known are kept.
 */
async function readLayout(
  api: DriveApi,
  fileId: string,
  now: number,
  known: SyncedMap
): Promise<{ layout: SheetLayout; found: SyncedRecord[] }> {
  const { sheetIds, protectedIds } = await api.getSheetInfo(fileId);
  const present = DATA_TABS.filter((tab) => sheetIds[tab] != null);
  const withAbout = sheetIds.About != null;
  const ranges = [
    ...(withAbout ? ["About!A:A"] : []),
    ...present.map((tab) => (tab === "Daily" ? "Daily!A:A" : `${tab}!A:B`)),
    ...(sheetIds.Visits != null ? ["Visits!1:1"] : []),
  ];
  const columns = await api.readColumns(fileId, ranges);
  const offset = withAbout ? 1 : 0;
  const runs: SheetLayout["runs"] = {};
  const headers: Record<string, boolean> = {};
  const found: SyncedRecord[] = [];
  present.forEach((tab, i) => {
    const rows = columns[i + offset] ?? [];
    headers[tab] = rows.length > 0;
    const data = rows.slice(1);
    const dates = data.map((row) => (tab === "Daily" ? row[0] : row[1]) ?? "");
    runs[tab] = runsFromDates(dates);
    const ords = new Map<string, number>();
    data.forEach((row, j) => {
      const date = dates[j] ?? "";
      const ord = ords.get(date) ?? 0;
      ords.set(date, ord + 1);
      if (!row[0]) return;
      const key = syncedKey(tab, row[0]);
      const sig = known.get(key)?.sig;
      found.push(tab === "Daily" ? { key } : { key, date, ord, ...(sig ? { sig } : {}) });
    });
  });
  const header = sheetIds.Visits != null ? (columns[columns.length - 1]?.[0] ?? []) : [];
  const schema = !headers.Visits || header.includes("device") ? SCHEMA_VERSION : header.includes("last_time") ? 4 : 3;
  return {
    layout: {
      fileId,
      sheetIds,
      runs,
      headers,
      aboutRows: offset ? (columns[0] ?? []).length : 0,
      verifiedAt: now,
      schema,
      visitColumns: header.length,
      protectedIds,
    },
    found,
  };
}

/** Local rows before each tab's cutoff go, along with their sync keys. The sheet rows go in the same flush. */
async function purgeLocal(cutoffs: TabCutoffDates, timeZone: string): Promise<void> {
  const memory = await loadMemory();
  const old = <T extends { id: string; visitedAt: number }>(rows: T[], before: string) =>
    rows.filter((row) => dateOf(row.visitedAt, timeZone) < before).map((row) => row.id);
  const visits = old(memory.visits, cutoffs.Visits);
  const content = old(memory.content, cutoffs.Content);
  const searches = old(memory.searches, cutoffs.Searches);
  const people = old(memory.people, cutoffs.People);
  const companies = old(memory.companies, cutoffs.Companies);
  const days = (await assistantSyncDb.synced.where("key").startsWith("Daily:").primaryKeys())
    .map((key) => String(key).slice("Daily:".length))
    .filter((date) => date < cutoffs.Daily);
  await assistantSyncDb.visits.bulkDelete(visits);
  await assistantSyncDb.content.bulkDelete(content);
  await assistantSyncDb.searches.bulkDelete(searches);
  await assistantSyncDb.people.bulkDelete(people);
  await assistantSyncDb.companies.bulkDelete(companies);
  await assistantSyncDb.drafts.bulkDelete(visits);
  await assistantSyncDb.warnings.where("visitId").anyOf([...visits, ...content]).delete();
  await dropKeys([
    ...visits.map((id) => syncedKey("Visits", id)),
    ...content.map((id) => syncedKey("Content", id)),
    ...searches.map((id) => syncedKey("Searches", id)),
    ...people.map((id) => syncedKey("People", id)),
    ...companies.map((id) => syncedKey("Companies", id)),
    ...days.map((date) => syncedKey("Daily", date)),
  ]);
}

function rowBytes(cells: string[]): number {
  return cells.reduce((n, cell) => n + cell.length + 48, 16);
}

/** Tabs whose rows are rewritten in place when a merge changes them. Content and Searches keep their first row. */
const UPDATABLE: ReadonlySet<DataTab> = new Set(["Visits", "People", "Companies"]);
const TRIM_TABS: TrimTab[] = ["Content", "Visits", "Searches", "People", "Companies"];

interface Plan {
  requests: object[];
  records: SyncedRecord[];
  layout: SheetLayout;
  /** Sheet rows written: appended or rewritten. */
  appended: number;
  more: boolean;
  /** CSV size estimate of the sheet after this flush. */
  bytes: number;
  trim: string;
  /** A row could not be located. The next flush reads the sheet first. */
  stale: boolean;
}

type Tabs = ReturnType<typeof dataTabs>;

function bytesByDate(tabs: Tabs): Partial<Record<TrimTab, Map<string, number>>> {
  const out: Partial<Record<TrimTab, Map<string, number>>> = {};
  for (const tab of TRIM_TABS) {
    const sizes = new Map<string, number>();
    for (const row of tabs[tab].slice(1)) {
      const date = row[DATE_COLUMN[tab]] ?? "";
      sizes.set(date, (sizes.get(date) ?? 0) + csvLineBytes(row));
    }
    out[tab] = sizes;
  }
  return out;
}

async function planFlush(
  layoutIn: SheetLayout,
  state: SyncEngineState,
  deps: FlushDeps,
  synced: SyncedMap
): Promise<Plan> {
  const layout: SheetLayout = structuredClone(layoutIn);
  layout.headers ??= {};
  const adds: object[] = [];
  const deletes: object[] = [];
  const appends: object[] = [];
  const updates: object[] = [];
  const records: SyncedRecord[] = [];
  const tz = deps.timeZone;
  const detail = state.sheetDetail;
  const rules = SHEET_DETAIL[detail];

  let nextSheetId = Math.max(-1, ...Object.values(layout.sheetIds)) + 1;
  for (const tab of SHEET_TABS) {
    if (layout.sheetIds[tab] != null) continue;
    layout.sheetIds[tab] = nextSheetId;
    adds.push(addSheetRequest(nextSheetId, tab, SHEET_TABS.indexOf(tab)), protectTabRequest(nextSheetId));
    layout.protectedIds = [...(layout.protectedIds ?? []), nextSheetId];
    layout.runs[tab] = [];
    layout.headers[tab] = false;
    nextSheetId += 1;
  }

  // Retention and sheet detail first, then trim whole days until the estimate fits the target.
  const cutoffs = tabCutoffs(deps.now, tz, state.retentionDays, detail);
  await purgeLocal(cutoffs, tz);
  const rowIds = new Set(
    [...synced.values()].filter((r) => r.key.startsWith("Visits:") && !r.of).map((r) => r.key.slice("Visits:".length))
  );
  const build = async () => {
    const merged = mergeDailyRepeats(finalOnly(await loadMemory()), tz, rowIds);
    return { merged, tabs: dataTabs(merged, { timeZone: tz, detail }) };
  };
  let { merged, tabs } = await build();
  const sizeOf = (t: Tabs) => sizedAbout(t, { timeZone: tz, syncedAt: syncedAtLabel(deps.now, tz), detail });
  const trim = planTrim({
    bytes: sizeOf(tabs).bytes,
    targetBytes: rules.targetBytes,
    today: dateOf(deps.now, tz),
    bytesByDate: bytesByDate(tabs),
  });
  for (const [tab, date] of Object.entries(trim.cutoffs) as [TrimTab, string][]) {
    if (date > cutoffs[tab]) cutoffs[tab] = date;
  }
  // An excerpt never outlives its visit row.
  if (cutoffs.Visits > cutoffs.Content) cutoffs.Content = cutoffs.Visits;
  if (Object.keys(trim.cutoffs).length) {
    await purgeLocal(cutoffs, tz);
    ({ merged, tabs } = await build());
  }

  for (const tab of DATA_TABS) {
    const { ranges, kept } = staleRanges(layout.runs[tab] ?? [], cutoffs[tab]);
    for (const range of ranges) deletes.push(deleteRowsRequest(layout.sheetIds[tab]!, range));
    layout.runs[tab] = kept;
  }

  // Every row the sheet lacks, and every merged row whose cells changed.
  interface Out {
    tab: (typeof ROW_TABS)[number];
    cells: string[];
    record: SyncedRecord;
    update: boolean;
    /** Merged visits that now live in this row. */
    members: SyncedRecord[];
  }
  const members = new Map(merged.visits.map((v) => [v.id, v.memberIds.slice(1)]));
  const out: Out[] = [];
  const adopt: SyncedRecord[] = [];
  for (const tab of ROW_TABS) {
    for (const cells of tabs[tab].slice(1)) {
      const id = cells[0] ?? "";
      if (!id) continue;
      const key = syncedKey(tab, id);
      const sig = signature(cells);
      const merges = (tab === "Visits" ? (members.get(id) ?? []) : [])
        .filter((m) => synced.get(syncedKey("Visits", m))?.of !== id)
        .map((m) => ({ key: syncedKey("Visits", m), of: id }));
      const prior = synced.get(key);
      if (prior && !prior.of) {
        if (!UPDATABLE.has(tab) || prior.sig === sig) continue;
        if (prior.sig == null && !merges.length && !(members.get(id)?.length)) {
          // Written before hashes were kept, and nothing merged into it since.
          adopt.push({ ...prior, sig });
          continue;
        }
        if (prior.date == null || prior.ord == null) continue;
        out.push({ tab, cells, record: { key, sig, date: prior.date, ord: prior.ord }, update: true, members: merges });
      } else {
        out.push({ tab, cells, record: { key, sig }, update: false, members: merges });
      }
    }
  }
  await markSynced(adopt);

  out.sort((a, b) => `${a.cells[1]} ${a.cells[3]}`.localeCompare(`${b.cells[1]} ${b.cells[3]}`));
  let budget = FLUSH_BYTE_BUDGET;
  const chosen: Out[] = [];
  for (const row of out) {
    const size = rowBytes(row.cells);
    if (chosen.length && size > budget) break;
    chosen.push(row);
    budget -= size;
  }
  const more = chosen.length < out.length;

  // Old Visits headers end at topics. Add visit_count (1 for every row already there) and
  // last_time (a copy of time, since each old row is one visit), device ("this device": only this
  // device was captured before), and the edit warning on every tab.
  const visitsId = layout.sheetIds.Visits!;
  const schema = layout.schema ?? (layout.headers.Visits ? 3 : SCHEMA_VERSION);
  if (layout.headers.Visits && schema < SCHEMA_VERSION) {
    updates.push(updateCellsRequest(visitsId, 0, [[...VISIT_HEADERS]]));
    const rows = rowCount(layout.runs.Visits);
    const width = layout.visitColumns ?? VISIT_HEADERS.indexOf("visit_count");
    const count = VISIT_HEADERS.indexOf("visit_count");
    const last = VISIT_HEADERS.indexOf("last_time");
    if (rows && width <= count) updates.push(fillColumnRequest(visitsId, count, 1, 1 + rows, "1"));
    if (rows && width <= last) updates.push(copyColumnRequest(visitsId, VISIT_HEADERS.indexOf("time"), last, 1, 1 + rows));
    const device = VISIT_HEADERS.indexOf("device");
    if (rows && width <= device) updates.push(fillColumnRequest(visitsId, device, 1, 1 + rows, THIS_DEVICE));
    const already = new Set(layout.protectedIds ?? []);
    for (const tab of SHEET_TABS) {
      const id = layout.sheetIds[tab]!;
      if (!already.has(id)) adds.push(protectTabRequest(id));
    }
    layout.protectedIds = SHEET_TABS.map((tab) => layout.sheetIds[tab]!);
  }
  layout.schema = SCHEMA_VERSION;
  layout.visitColumns = VISIT_HEADERS.length;

  let written = 0;
  let stale = false;
  const touchedDates = new Set<string>();
  for (const tab of ROW_TABS) {
    const sheetId = layout.sheetIds[tab]!;
    for (const row of chosen.filter((r) => r.tab === tab && r.update)) {
      const at = rowIndexOf(layout.runs[tab] ?? [], row.record.date!, row.record.ord!);
      if (at == null) {
        stale = true;
        continue;
      }
      updates.push(updateCellsRequest(sheetId, at, [row.cells]));
      records.push(row.record, ...row.members);
      written += 1;
      touchedDates.add(row.record.date!);
    }
    const rows = chosen.filter((r) => r.tab === tab && !r.update);
    const withHeader = !layout.headers[tab] && (rows.length > 0 || deps.mode === "enable");
    if (!rows.length && !withHeader) continue;
    const next = new Map<string, number>();
    for (const row of rows) {
      const date = row.cells[1] ?? "";
      const ord = next.get(date) ?? rowsOnDate(layout.runs[tab] ?? [], date);
      next.set(date, ord + 1);
      records.push({ ...row.record, date, ord }, ...row.members);
      if (date) touchedDates.add(date);
    }
    const cells = rows.map((row) => row.cells);
    appends.push(appendCellsRequest(sheetId, withHeader ? [[...TAB_HEADERS[tab]], ...cells] : cells));
    layout.headers[tab] = true;
    layout.runs[tab] = appendRuns(layout.runs[tab] ?? [], rows.map((row) => row.cells[1] ?? ""));
    written += rows.length;
  }

  if (touchedDates.size || (deps.mode === "enable" && !layout.headers.Daily)) {
    const daily = new Map(tabs.Daily.slice(1).map((row) => [row[0] ?? "", row]));
    const fresh: string[][] = [];
    for (const date of [...touchedDates].sort()) {
      const row = daily.get(date);
      if (!row || date < cutoffs.Daily) continue;
      const at = dailyRowIndex(layout.runs.Daily ?? [], date);
      if (at != null) updates.push(updateCellsRequest(layout.sheetIds.Daily!, at, [row]));
      else fresh.push(row);
      records.push({ key: syncedKey("Daily", date) });
      written += 1;
    }
    if (fresh.length || !layout.headers.Daily) {
      const rows = layout.headers.Daily ? fresh : [[...TAB_HEADERS.Daily], ...fresh];
      appends.push(appendCellsRequest(layout.sheetIds.Daily!, rows));
      layout.headers.Daily = true;
      layout.runs.Daily = appendRuns(layout.runs.Daily ?? [], fresh.map((row) => row[0] ?? ""));
    }
  }

  const { about, bytes } = sizeOf(tabs);
  const changed = adds.length + deletes.length + appends.length + updates.length > 0;
  if (changed) {
    const padded = [...about];
    while (padded.length < layout.aboutRows) padded.push([""]);
    updates.push(updateCellsRequest(layout.sheetIds.About!, 0, padded));
    layout.aboutRows = about.length;
  }

  return {
    requests: [...adds, ...deletes, ...appends, ...updates],
    records,
    layout,
    appended: written,
    more,
    bytes,
    trim: trimNote(trim.cutoffs, rules.targetBytes),
    stale,
  };
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
    // A layout saved before row positions were kept (no schema) needs one read to locate rows.
    const verify =
      deps.mode === "enable" ||
      state.verifyNext ||
      inflight != null ||
      !state.layout ||
      state.layout.fileId !== fileId ||
      state.layout.schema == null;
    const synced = await syncedMap();
    let layout = state.layout;
    if (verify) {
      const status = await inspectMemory(deps.api, deps.ids);
      if (status !== "ready") {
        state.lastError = statusMessage(status);
        await writeSyncEngineState(state);
        return result({ status, appended: 0, error: state.lastError });
      }
      counts.reads += 2;
      const read = await readLayout(deps.api, fileId, deps.now, synced);
      layout = read.layout;
      for (const record of read.found) synced.set(record.key, record);
      await markSynced(read.found);
      await assistantSyncDb.pending.clear();
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
      state.sheetBytes = plan.bytes;
      if (plan.stale) state.verifyNext = true;
      await writeSyncEngineState(state);
      return result({ status: "ready", appended: 0 });
    }

    await assistantSyncDb.inflight.put({ id: "inflight", fileId, keys: plan.records.map((r) => r.key), startedAt: deps.now });
    state.lastFlushAt = deps.now;
    await writeSyncEngineState(state);
    sent = true;
    counts.writes += 1;
    await deps.api.batchUpdate(fileId, plan.requests);

    await markSynced(plan.records);
    await assistantSyncDb.inflight.delete("inflight");
    Object.assign(state, {
      layout: plan.layout,
      lastSyncedAt: deps.now,
      lastError: "",
      backoffFailures: 0,
      consecutive429: 0,
      nextAttemptAt: 0,
      sheetBytes: plan.bytes,
      ...(plan.trim ? { trimNote: plan.trim, trimmedAt: deps.now } : {}),
      ...(plan.stale ? { verifyNext: true } : {}),
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
      ? forbiddenMessage(error)
      : status === 404
        ? SYNC_MISSING_MESSAGE
        : status === 400
          ? SYNC_REJECTED_MESSAGE
          : "";
  await writeSyncEngineState(state);
  const detail = googleErrorDetail(error);
  return {
    status: "error",
    appended: 0,
    retryAt: state.nextAttemptAt,
    ...(state.lastError ? { error: state.lastError } : {}),
    ...(detail ? { errorDetail: detail } : {}),
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
  /** The Cortex Memory sheet and folder. Visits to them are skipped. */
  ownIds?: StoredMemoryIds;
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
    const denied =
      !canonical ||
      syncDenyReason(visit.url, { userDomains: input.userDenylist, title: visit.title, ownIds: input.ownIds }) != null;
    const duplicate = canonical != null && seen.has(`${canonical}\t${visit.visitedAt}`);
    if (denied || duplicate || !canonical) {
      skipped += 1;
    } else {
      const title = syncTitle(visit.title);
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
  /** The user's answer when the stored sheet is trashed or deleted. */
  choice?: MemoryChoice;
}): Promise<
  | { ids: StoredMemoryIds; created: boolean; backfill: { stored: number; skipped: number; total: number }; flush: FlushResult }
  | { confirm: "missing" | "trashed" }
> {
  const previous = await readSyncEngineState();
  const retentionDays = clampRetentionDays(input.retentionDays ?? previous.retentionDays);
  const emptyTabs = Object.fromEntries(DATA_TABS.map((tab) => [tab, [[...TAB_HEADERS[tab]]]])) as Tabs;
  const { about } = sizedAbout(emptyTabs, {
    timeZone: input.timeZone,
    syncedAt: syncedAtLabel(input.now, input.timeZone),
    detail: previous.sheetDetail,
  });
  const resolved = await resolveMemory(input.api, input.ids, input.choice, about);
  if ("confirm" in resolved) {
    await writeSyncEngineState({ ...previous, lastError: statusMessage(resolved.confirm) });
    return resolved;
  }
  const { ids } = resolved;
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
  const created = ids.fileId !== input.ids.fileId || ids.folderId !== input.ids.folderId;
  if (created) {
    // A different file. The rows it has are found by the read on the first flush.
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
    ownIds: ids,
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
  return { ids, created: resolved.created, backfill, flush };
}

/**
 * Looks once for JSON backups and archives older builds left in the folder.
 * One Drive list call, the first time sync runs on this build. Never trashes anything.
 */
export async function checkLegacyFiles(api: DriveApi, ids: StoredMemoryIds, backupId?: string | null): Promise<void> {
  const state = await readSyncEngineState();
  if (state.legacyCleanup !== "unchecked" || !ids.folderId || ids.folderId === ids.fileId) return;
  const files = await findLegacyFiles(api, ids.folderId, backupId);
  await writeSyncEngineState({
    ...(await readSyncEngineState()),
    legacyCleanup: files.length ? "ask" : "none",
    legacyFiles: files.map(({ id, name }) => ({ id, name })),
  });
}

/** The user's answer to the cleanup prompt. Trash moves the listed files to the Drive trash. */
export async function answerLegacyCleanup(api: DriveApi | null, answer: "trash" | "keep"): Promise<SyncEngineState> {
  const state = await readSyncEngineState();
  if (state.legacyCleanup !== "ask") return state;
  if (answer === "trash") {
    if (!api) throw new Error("google_401");
    for (const file of state.legacyFiles) {
      const info = await api.getFile(file.id);
      if (info && !info.trashed) await api.trashFile(file.id);
    }
  }
  const next: SyncEngineState = { ...state, legacyCleanup: answer === "trash" ? "trashed" : "kept", legacyFiles: [] };
  await writeSyncEngineState(next);
  return next;
}
