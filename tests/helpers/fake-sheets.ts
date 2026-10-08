import type { DriveApi, DriveFileInfo, SheetInfo } from "../../src/assistant-sync/drive-api";
import { headerFormatRequests, PROTECTED_DESCRIPTION, protectTabRequest, SHEET_TABS } from "../../src/assistant-sync/sheet";

type Cells = { values: { userEnteredValue: { stringValue: string } }[] };
interface Tab {
  sheetId: number;
  rows: string[][];
  /** Descriptions of protected ranges on this tab. */
  protections: string[];
}

/** One scripted outcome for the next batchUpdate. `lost` applies the batch and then fails, like a dropped reply. */
export type BatchOutcome = { status: number; lost?: boolean };

/**
 * In-memory Drive and Sheets. batchUpdate applies addSheet, deleteDimension,
 * appendCells, and updateCells in order and all-or-nothing, as Google does.
 */
type FakeFile = { name: string; trashed: boolean; parent?: string; sheet?: boolean };

export class FakeSheets implements DriveApi {
  files = new Map<string, FakeFile>();
  lists = 0;
  books = new Map<string, Map<string, Tab>>();
  reads = 0;
  writes = 0;
  batches: object[][] = [];
  outcomes: BatchOutcome[] = [];
  creates = 0;

  constructor(seed = true) {
    if (!seed) return;
    this.files.set("folder", { name: "Cortex Memory", trashed: false });
    this.files.set("file", { name: "Cortex Memory", trashed: false, parent: "folder", sheet: true });
    this.books.set("file", this.freshBook(true));
  }

  /** `created`: as Cortex creates it, with its edit warning on every tab. */
  private freshBook(created = false): Map<string, Tab> {
    const protections = () => (created ? [PROTECTED_DESCRIPTION] : []);
    return new Map(SHEET_TABS.map((title, sheetId) => [title, { sheetId, rows: [], protections: protections() }]));
  }

  /** Protection descriptions per tab. */
  protections(fileId = "file"): Record<string, string[]> {
    return Object.fromEntries([...(this.books.get(fileId) ?? [])].map(([name, tab]) => [name, tab.protections]));
  }

  tab(name: string, fileId = "file"): string[][] {
    return this.books.get(fileId)?.get(name)?.rows ?? [];
  }

  ids(name: string, fileId = "file"): string[] {
    return this.tab(name, fileId)
      .slice(1)
      .map((row) => row[0] ?? "");
  }

  async createFolder(name: string): Promise<string> {
    this.creates += 1;
    const id = `folder-${this.files.size + 1}`;
    this.files.set(id, { name, trashed: false });
    return id;
  }

  async createSpreadsheet(name: string, parentId?: string): Promise<string> {
    this.creates += 1;
    const id = `file-${this.files.size + 1}`;
    this.files.set(id, { name, trashed: false, parent: parentId, sheet: true });
    this.books.set(id, this.freshBook());
    return id;
  }

  async untrashFile(id: string): Promise<void> {
    const file = this.files.get(id);
    if (file) file.trashed = false;
  }

  /** Understands the two queries Cortex sends: files in a folder, and the Cortex Memory sheet by name. */
  async listFiles(query: string): Promise<DriveFileInfo[]> {
    this.lists += 1;
    const parent = /^'([^']+)' in parents/.exec(query)?.[1];
    const name = /name = '([^']+)'/.exec(query)?.[1];
    return [...this.files]
      .filter(([, file]) => !file.trashed)
      .filter(([, file]) => (parent ? file.parent === parent : file.sheet && file.name === name))
      .map(([id, file]) => ({ id, name: file.name, trashed: file.trashed, parents: file.parent ? [file.parent] : [] }));
  }

  async getFile(id: string): Promise<DriveFileInfo | null> {
    const file = this.files.get(id);
    return file ? { id, name: file.name, trashed: file.trashed } : null;
  }

  async trashFile(id: string): Promise<void> {
    const file = this.files.get(id);
    if (file) file.trashed = true;
  }

  /** Mirrors FetchDriveApi.formatHeaders: one batch with the header format and the edit warning on every tab. */
  async formatHeaders(fileId: string): Promise<void> {
    await this.batchUpdate(fileId, [...headerFormatRequests(), ...SHEET_TABS.map((_, sheetId) => protectTabRequest(sheetId))]);
  }

  async batchUpdate(fileId: string, requests: object[]): Promise<void> {
    this.writes += 1;
    const outcome = this.outcomes.shift();
    if (outcome && !outcome.lost) throw new Error(`google_${outcome.status}`);
    const book = this.books.get(fileId);
    if (!book) throw new Error("google_404");
    const draft = new Map(
      [...book].map(([name, tab]) => [
        name,
        { sheetId: tab.sheetId, rows: tab.rows.map((row) => [...row]), protections: [...tab.protections] },
      ])
    );
    const byId = (sheetId: number) => {
      const tab = [...draft.values()].find((entry) => entry.sheetId === sheetId);
      if (!tab) throw new Error("google_400");
      return tab;
    };
    for (const request of requests as Record<string, any>[]) {
      if (request.addSheet) {
        const { sheetId, title } = request.addSheet.properties;
        if (draft.has(title)) throw new Error("google_400");
        draft.set(title, { sheetId, rows: [], protections: [] });
      } else if (request.deleteDimension) {
        const { sheetId, startIndex, endIndex } = request.deleteDimension.range;
        byId(sheetId).rows.splice(startIndex, endIndex - startIndex);
      } else if (request.appendCells) {
        const tab = byId(request.appendCells.sheetId);
        for (const row of request.appendCells.rows as Cells[]) tab.rows.push(row.values.map((cell) => cell.userEnteredValue.stringValue));
      } else if (request.updateCells) {
        const { sheetId, rowIndex } = request.updateCells.start;
        const tab = byId(sheetId);
        (request.updateCells.rows as Cells[]).forEach((row, i) => {
          const values = row.values.map((cell) => cell.userEnteredValue.stringValue);
          while (tab.rows.length <= rowIndex + i) tab.rows.push([]);
          tab.rows[rowIndex + i] = values;
        });
      } else if (request.repeatCell && !request.repeatCell.cell.userEnteredValue) {
        // Bold header: no effect on values.
      } else if (request.repeatCell) {
        const { sheetId, startRowIndex, endRowIndex, startColumnIndex } = request.repeatCell.range;
        const tab = byId(sheetId);
        for (let r = startRowIndex; r < endRowIndex; r++) {
          const row = (tab.rows[r] ??= []);
          while (row.length < startColumnIndex) row.push("");
          row[startColumnIndex] = request.repeatCell.cell.userEnteredValue.stringValue;
        }
      } else if (request.copyPaste) {
        const { source, destination, pasteType } = request.copyPaste;
        if (source.sheetId !== destination.sheetId || pasteType !== "PASTE_VALUES") throw new Error("google_400");
        const tab = byId(source.sheetId);
        for (let r = source.startRowIndex; r < source.endRowIndex; r++) {
          const row = (tab.rows[r] ??= []);
          while (row.length < destination.startColumnIndex) row.push("");
          row[destination.startColumnIndex] = row[source.startColumnIndex] ?? "";
        }
      } else if (request.addProtectedRange) {
        const { range, description, warningOnly } = request.addProtectedRange.protectedRange;
        if (warningOnly !== true) throw new Error("google_400");
        byId(range.sheetId).protections.push(description);
      } else if (request.updateSheetProperties) {
        // Frozen header row: no effect on values.
      } else {
        throw new Error("google_400");
      }
    }
    this.books.set(fileId, draft);
    this.batches.push(requests);
    if (outcome?.lost) throw new Error(`google_${outcome.status}`);
  }

  async getSheetInfo(fileId: string): Promise<SheetInfo> {
    this.reads += 1;
    const book = this.books.get(fileId);
    if (!book) throw new Error("google_404");
    return {
      sheetIds: Object.fromEntries([...book].map(([name, tab]) => [name, tab.sheetId])),
      protectedIds: [...book.values()].filter((tab) => tab.protections.includes(PROTECTED_DESCRIPTION)).map((tab) => tab.sheetId),
    };
  }

  async readColumns(fileId: string, ranges: string[]): Promise<string[][][]> {
    this.reads += 1;
    const book = this.books.get(fileId);
    return ranges.map((range) => {
      const [name, cols] = range.split("!");
      if (cols === "1:1") return (book?.get(name ?? "")?.rows ?? []).slice(0, 1).map((row) => [...row]);
      const width = cols === "A:B" ? 2 : 1;
      const rows = (book?.get(name ?? "")?.rows ?? []).map((row) => row.slice(0, width));
      // Google drops trailing empty rows.
      while (rows.length && rows[rows.length - 1]!.every((cell) => !cell)) rows.pop();
      return rows;
    });
  }
}
