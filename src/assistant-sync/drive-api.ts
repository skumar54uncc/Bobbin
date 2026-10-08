import * as v from "valibot";
import { headerFormatRequests, PROTECTED_DESCRIPTION, protectTabRequest, SHEET_TABS } from "./sheet";

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export interface DriveFileInfo {
  id: string;
  name: string;
  trashed: boolean;
  parents?: string[];
}

/** Name of the Drive JSON backup that older builds wrote. Kept so the cleanup can find it. */
export const DRIVE_JSON_BACKUP_NAME = "Cortex Memory Backup.json";
/** Monthly archive spreadsheets older builds wrote: "Cortex Memory Archive 2026-09". */
export const DRIVE_ARCHIVE_NAME = /^Cortex Memory Archive \d{4}-\d{2}$/;
const MEMORY_SHEET_NAME = "Cortex Memory";
const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";

/**
 * Every Google call Cortex makes. Sheets reads are `getSheetInfo` and `readColumns`;
 * the only Sheets write after creation is `batchUpdate`.
 */
export interface DriveApi {
  createFolder(name: string): Promise<string>;
  createSpreadsheet(name: string, parentId: string): Promise<string>;
  getFile(id: string): Promise<DriveFileInfo | null>;
  trashFile(id: string): Promise<void>;
  untrashFile(id: string): Promise<void>;
  /**
   * One files.list. With the drive.file scope Google returns only files this
   * app created or the user opened with it, so this never sees other files.
   */
  listFiles(query: string): Promise<DriveFileInfo[]>;
  formatHeaders(fileId: string): Promise<void>;
  /** One spreadsheets.batchUpdate. Google applies it atomically and counts it as one write. */
  batchUpdate(fileId: string, requests: object[]): Promise<void>;
  /** One spreadsheets.get for tab titles, ids, and which tabs carry Cortex's edit warning. One read. */
  getSheetInfo(fileId: string): Promise<SheetInfo>;
  /** One values.batchGet. One read. Returns one row list per range, in order. */
  readColumns(fileId: string, ranges: string[]): Promise<string[][][]>;
}

export interface SheetInfo {
  sheetIds: Record<string, number>;
  /** Tabs that already have the warning-only protection Cortex adds. */
  protectedIds: number[];
}

export interface RowRange {
  startIndex: number;
  endIndex: number;
}

export type DriveMemoryStatus = "absent" | "ready" | "missing" | "trashed";

export interface StoredMemoryIds {
  folderId: string | null;
  fileId: string | null;
}

/** Never creates a file. A missing or trashed id stays missing until the user asks. */
export async function inspectMemory(api: DriveApi, ids: StoredMemoryIds): Promise<DriveMemoryStatus> {
  if (!ids.folderId || !ids.fileId) return "absent";
  const folder = await api.getFile(ids.folderId);
  const file = await api.getFile(ids.fileId);
  if (!folder || !file) return "missing";
  if (folder.trashed || file.trashed) return "trashed";
  return "ready";
}

/** Explicit create. Used on first enable and on re-enable after a delete. Not used by a timer. */
export async function createMemoryFile(
  api: DriveApi,
  title: string,
  folderName = "Cortex Memory"
): Promise<StoredMemoryIds> {
  const folderId = await api.createFolder(folderName);
  const fileId = await api.createSpreadsheet(title, folderId);
  await api.formatHeaders(fileId);
  return { folderId, fileId };
}

export function syncedKey(tab: string, id: string): string {
  return `${tab}:${id}`;
}

/** Quotes a value for a Drive query string. */
function q(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** The Cortex Memory sheet this app made earlier, if Drive still has it outside the trash. */
export async function findMemoryFile(api: DriveApi): Promise<StoredMemoryIds | null> {
  const files = await api.listFiles(`name = ${q(MEMORY_SHEET_NAME)} and mimeType = ${q(SPREADSHEET_MIME)} and trashed = false`);
  const file = files[0];
  if (!file) return null;
  // A sheet with no parent folder stands in as its own folder; trashMemory handles that.
  return { fileId: file.id, folderId: file.parents?.[0] ?? file.id };
}

/** Restore from trash, or create a new sheet after the old one was deleted. Only ever from a click. */
export type MemoryChoice = "restore" | "create";
export type ResolvedMemory = { ids: StoredMemoryIds; created: boolean } | { confirm: "missing" | "trashed" };

/**
 * Enable. Uses the stored sheet when it is there, or the sheet this app made
 * earlier. Asks before restoring a trashed sheet or replacing a deleted one,
 * so there is never a second Cortex Memory file.
 */
export async function resolveMemory(api: DriveApi, previous: StoredMemoryIds, choice?: MemoryChoice): Promise<ResolvedMemory> {
  const status = await inspectMemory(api, previous);
  if (status === "ready") return { ids: previous, created: false };
  if (status === "absent") {
    const found = await findMemoryFile(api);
    if (found) return { ids: found, created: false };
    return { ids: await createMemoryFile(api, MEMORY_SHEET_NAME), created: true };
  }
  if (status === "trashed") {
    if (choice !== "restore") return { confirm: "trashed" };
    for (const id of new Set([previous.fileId, previous.folderId])) {
      if (id && (await api.getFile(id))?.trashed) await api.untrashFile(id);
    }
    const after = await inspectMemory(api, previous);
    return after === "ready" ? { ids: previous, created: false } : { confirm: "missing" };
  }
  if (choice !== "create") return { confirm: "missing" };
  const folder = previous.folderId ? await api.getFile(previous.folderId) : null;
  if (folder && !folder.trashed && folder.id !== previous.fileId) {
    const fileId = await api.createSpreadsheet(MEMORY_SHEET_NAME, folder.id);
    await api.formatHeaders(fileId);
    return { ids: { folderId: folder.id, fileId }, created: true };
  }
  return { ids: await createMemoryFile(api, MEMORY_SHEET_NAME), created: true };
}

/** JSON backups and monthly archives older builds left in the Cortex Memory folder. */
export async function findLegacyFiles(api: DriveApi, folderId: string, backupId?: string | null): Promise<DriveFileInfo[]> {
  const inFolder = await api.listFiles(`${q(folderId)} in parents and trashed = false`);
  const found = inFolder.filter((file) => file.name === DRIVE_JSON_BACKUP_NAME || DRIVE_ARCHIVE_NAME.test(file.name));
  if (backupId && !found.some((file) => file.id === backupId)) {
    const backup = await api.getFile(backupId);
    if (backup && !backup.trashed) found.push(backup);
  }
  return found.map(({ id, name, trashed }) => ({ id, name, trashed }));
}

export async function trashMemory(api: DriveApi, ids: StoredMemoryIds): Promise<void> {
  if (ids.fileId) await api.trashFile(ids.fileId);
  if (ids.folderId && ids.folderId !== ids.fileId) await api.trashFile(ids.folderId);
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const IdResponse = v.object({ id: v.string() });
const FileResponse = v.object({
  id: v.string(),
  name: v.optional(v.string(), ""),
  trashed: v.optional(v.boolean(), false),
  parents: v.optional(v.array(v.string())),
});
const FileList = v.object({ files: v.optional(v.array(FileResponse), []) });
const SpreadsheetCreated = v.object({ spreadsheetId: v.string() });
const SheetsList = v.object({
  sheets: v.optional(
    v.array(
      v.object({
        properties: v.object({ sheetId: v.number(), title: v.string() }),
        protectedRanges: v.optional(v.array(v.object({ description: v.optional(v.string(), "") })), []),
      })
    ),
    []
  ),
});
const Cell = v.union([v.string(), v.number(), v.boolean(), v.null()]);
const ValueRanges = v.object({
  valueRanges: v.optional(v.array(v.object({ values: v.optional(v.array(v.array(Cell)), []) })), []),
});

/** Parses a Google response body. A shape Cortex does not expect is an error, never a guess. */
async function parsed<T extends v.GenericSchema>(res: Response, schema: T): Promise<v.InferOutput<T>> {
  if (!res.ok) throw new Error(`google_${res.status}`);
  const out = v.safeParse(schema, await res.json().catch(() => null));
  if (!out.success) throw new Error("google_bad_response");
  return out.output;
}

/** Sheets and Drive calls. Constructed in the offscreen document, never in the service worker. */
export class FetchDriveApi implements DriveApi {
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly token: string,
    fetchImpl?: FetchLike
  ) {
    // Calling window.fetch without its receiver throws "Illegal invocation".
    this.fetchImpl = fetchImpl ?? ((url, init) => fetch(url, init));
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    return this.fetchImpl(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  }

  async createFolder(name: string): Promise<string> {
    const res = await this.send("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" }),
    });
    return (await parsed(res, IdResponse)).id;
  }

  async createSpreadsheet(name: string, parentId: string): Promise<string> {
    const res = await this.send("https://sheets.googleapis.com/v4/spreadsheets", {
      method: "POST",
      body: JSON.stringify({
        properties: { title: name },
        sheets: SHEET_TABS.map((title, index) => ({ properties: { title, index, sheetId: index } })),
      }),
    });
    const id = (await parsed(res, SpreadsheetCreated)).spreadsheetId;
    const moved = await this.send(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?addParents=${encodeURIComponent(parentId)}`,
      { method: "PATCH", body: JSON.stringify({}) }
    );
    if (!moved.ok) throw new Error(`google_${moved.status}`);
    return id;
  }

  async getFile(id: string): Promise<DriveFileInfo | null> {
    const res = await this.send(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,trashed`,
      { method: "GET" }
    );
    if (res.status === 404) return null;
    const file = await parsed(res, FileResponse);
    return { id: file.id, name: file.name, trashed: file.trashed };
  }

  async trashFile(id: string): Promise<void> {
    const res = await this.send(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ trashed: true }),
    });
    if (!res.ok) throw new Error(`google_${res.status}`);
  }

  async untrashFile(id: string): Promise<void> {
    const res = await this.send(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ trashed: false }),
    });
    if (!res.ok) throw new Error(`google_${res.status}`);
  }

  async listFiles(query: string): Promise<DriveFileInfo[]> {
    const params = `q=${encodeURIComponent(query)}&fields=${encodeURIComponent("files(id,name,trashed,parents)")}&pageSize=100&spaces=drive`;
    const res = await this.send(`https://www.googleapis.com/drive/v3/files?${params}`, { method: "GET" });
    return (await parsed(res, FileList)).files.map((file) => ({ id: file.id, name: file.name, trashed: file.trashed, parents: file.parents }));
  }

  async formatHeaders(fileId: string): Promise<void> {
    // One batchUpdate on a new sheet: bold, frozen headers and the edit warning on every tab.
    await this.batchUpdate(fileId, [...headerFormatRequests(), ...SHEET_TABS.map((_, sheetId) => protectTabRequest(sheetId))]);
  }

  async batchUpdate(fileId: string, requests: object[]): Promise<void> {
    if (!requests.length) return;
    const res = await this.send(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(fileId)}:batchUpdate`,
      { method: "POST", body: JSON.stringify({ requests }) }
    );
    if (!res.ok) throw new Error(`google_${res.status}`);
  }

  async getSheetInfo(fileId: string): Promise<SheetInfo> {
    const fields = encodeURIComponent("sheets(properties(sheetId,title),protectedRanges(description))");
    const res = await this.send(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(fileId)}?fields=${fields}`, {
      method: "GET",
    });
    const sheetIds: Record<string, number> = {};
    const protectedIds: number[] = [];
    for (const sheet of (await parsed(res, SheetsList)).sheets) {
      sheetIds[sheet.properties.title] = sheet.properties.sheetId;
      if (sheet.protectedRanges.some((range) => range.description === PROTECTED_DESCRIPTION)) protectedIds.push(sheet.properties.sheetId);
    }
    return { sheetIds, protectedIds };
  }

  async readColumns(fileId: string, ranges: string[]): Promise<string[][][]> {
    if (!ranges.length) return [];
    const query = ranges.map((range) => `ranges=${encodeURIComponent(range)}`).join("&");
    const res = await this.send(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(fileId)}/values:batchGet?${query}&valueRenderOption=FORMATTED_VALUE`,
      { method: "GET" }
    );
    const body = await parsed(res, ValueRanges);
    return ranges.map((_, i) =>
      (body.valueRanges[i]?.values ?? []).map((row) => row.map((cell) => (cell == null ? "" : String(cell))))
    );
  }
}

export function googleStatus(error: unknown): number | null {
  const message = error instanceof Error ? error.message : "";
  const match = /^google_(\d+)$/.exec(message);
  return match ? Number(match[1]) : null;
}
