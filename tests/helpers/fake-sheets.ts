import type { DriveApi, DriveFileInfo } from "../../src/assistant-sync/drive-api";
import { SHEET_TABS } from "../../src/assistant-sync/sheet";

type Cells = { values: { userEnteredValue: { stringValue: string } }[] };
interface Tab {
  sheetId: number;
  rows: string[][];
}

/** One scripted outcome for the next batchUpdate. `lost` applies the batch and then fails, like a dropped reply. */
export type BatchOutcome = { status: number; lost?: boolean };

/**
 * In-memory Drive and Sheets. batchUpdate applies addSheet, deleteDimension,
 * appendCells, and updateCells in order and all-or-nothing, as Google does.
 */
export class FakeSheets implements DriveApi {
  files = new Map<string, { name: string; trashed: boolean }>();
  books = new Map<string, Map<string, Tab>>();
  reads = 0;
  writes = 0;
  batches: object[][] = [];
  outcomes: BatchOutcome[] = [];
  creates = 0;

  constructor(seed = true) {
    if (!seed) return;
    this.files.set("folder", { name: "Cortex Memory", trashed: false });
    this.files.set("file", { name: "Cortex Memory", trashed: false });
    this.books.set("file", this.freshBook());
  }

  private freshBook(): Map<string, Tab> {
    return new Map(SHEET_TABS.map((title, sheetId) => [title, { sheetId, rows: [] }]));
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

  async createSpreadsheet(name: string): Promise<string> {
    this.creates += 1;
    const id = `file-${this.files.size + 1}`;
    this.files.set(id, { name, trashed: false });
    this.books.set(id, this.freshBook());
    return id;
  }

  async getFile(id: string): Promise<DriveFileInfo | null> {
    const file = this.files.get(id);
    return file ? { id, name: file.name, trashed: file.trashed } : null;
  }

  async trashFile(id: string): Promise<void> {
    const file = this.files.get(id);
    if (file) file.trashed = true;
  }

  async formatHeaders(): Promise<void> {}

  async batchUpdate(fileId: string, requests: object[]): Promise<void> {
    this.writes += 1;
    const outcome = this.outcomes.shift();
    if (outcome && !outcome.lost) throw new Error(`google_${outcome.status}`);
    const book = this.books.get(fileId);
    if (!book) throw new Error("google_404");
    const draft = new Map([...book].map(([name, tab]) => [name, { sheetId: tab.sheetId, rows: tab.rows.map((row) => [...row]) }]));
    const byId = (sheetId: number) => {
      const tab = [...draft.values()].find((entry) => entry.sheetId === sheetId);
      if (!tab) throw new Error("google_400");
      return tab;
    };
    for (const request of requests as Record<string, any>[]) {
      if (request.addSheet) {
        const { sheetId, title } = request.addSheet.properties;
        if (draft.has(title)) throw new Error("google_400");
        draft.set(title, { sheetId, rows: [] });
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
      } else {
        throw new Error("google_400");
      }
    }
    this.books.set(fileId, draft);
    this.batches.push(requests);
    if (outcome?.lost) throw new Error(`google_${outcome.status}`);
  }

  async getSheetIds(fileId: string): Promise<Record<string, number>> {
    this.reads += 1;
    const book = this.books.get(fileId);
    if (!book) throw new Error("google_404");
    return Object.fromEntries([...book].map(([name, tab]) => [name, tab.sheetId]));
  }

  async readColumns(fileId: string, ranges: string[]): Promise<string[][][]> {
    this.reads += 1;
    const book = this.books.get(fileId);
    return ranges.map((range) => {
      const [name, cols] = range.split("!");
      const width = cols === "A:B" ? 2 : 1;
      const rows = (book?.get(name ?? "")?.rows ?? []).map((row) => row.slice(0, width));
      // Google drops trailing empty rows.
      while (rows.length && rows[rows.length - 1]!.every((cell) => !cell)) rows.pop();
      return rows;
    });
  }
}
