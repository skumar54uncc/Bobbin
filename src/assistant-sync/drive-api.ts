import * as v from "valibot";
import { headerFormatRequests, SHEET_TABS } from "./sheet";

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export interface DriveFileInfo {
  id: string;
  name: string;
  trashed: boolean;
}

/** Name of the Drive JSON backup that older builds wrote. Kept so the cleanup can find it. */
export const DRIVE_JSON_BACKUP_NAME = "Cortex Memory Backup.json";

/**
 * Every Google call Cortex makes. Sheets reads are `getSheetIds` and `readColumns`;
 * the only Sheets write after creation is `batchUpdate`.
 */
export interface DriveApi {
  createFolder(name: string): Promise<string>;
  createSpreadsheet(name: string, parentId: string): Promise<string>;
  getFile(id: string): Promise<DriveFileInfo | null>;
  trashFile(id: string): Promise<void>;
  formatHeaders(fileId: string): Promise<void>;
  /** One spreadsheets.batchUpdate. Google applies it atomically and counts it as one write. */
  batchUpdate(fileId: string, requests: object[]): Promise<void>;
  /** One spreadsheets.get for tab titles and ids. One read. */
  getSheetIds(fileId: string): Promise<Record<string, number>>;
  /** One values.batchGet. One read. Returns one row list per range, in order. */
  readColumns(fileId: string, ranges: string[]): Promise<string[][][]>;
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

/** User asked to turn sync on again. Creates a new folder when the old one is gone or trashed. */
export async function reenableMemory(api: DriveApi, previous: StoredMemoryIds): Promise<StoredMemoryIds> {
  const status = await inspectMemory(api, previous);
  if (status === "ready" && previous.folderId && previous.fileId) return previous;
  return createMemoryFile(api, "Cortex Memory");
}

export async function trashMemory(api: DriveApi, ids: StoredMemoryIds): Promise<void> {
  if (ids.fileId) await api.trashFile(ids.fileId);
  if (ids.folderId && ids.folderId !== ids.fileId) await api.trashFile(ids.folderId);
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const IdResponse = v.object({ id: v.string() });
const FileResponse = v.object({ id: v.string(), name: v.optional(v.string(), ""), trashed: v.optional(v.boolean(), false) });
const SpreadsheetCreated = v.object({ spreadsheetId: v.string() });
const SheetsList = v.object({
  sheets: v.optional(
    v.array(v.object({ properties: v.object({ sheetId: v.number(), title: v.string() }) })),
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

  async formatHeaders(fileId: string): Promise<void> {
    await this.batchUpdate(fileId, headerFormatRequests());
  }

  async batchUpdate(fileId: string, requests: object[]): Promise<void> {
    if (!requests.length) return;
    const res = await this.send(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(fileId)}:batchUpdate`,
      { method: "POST", body: JSON.stringify({ requests }) }
    );
    if (!res.ok) throw new Error(`google_${res.status}`);
  }

  async getSheetIds(fileId: string): Promise<Record<string, number>> {
    const res = await this.send(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(fileId)}?fields=sheets.properties(sheetId,title)`,
      { method: "GET" }
    );
    const out: Record<string, number> = {};
    for (const sheet of (await parsed(res, SheetsList)).sheets) out[sheet.properties.title] = sheet.properties.sheetId;
    return out;
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
