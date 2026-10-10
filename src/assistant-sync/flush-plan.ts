import type { SheetLayout } from "./db";
import type { RowRange } from "./drive-api";

export type Runs = SheetLayout["runs"][string];

/** A row of plain text cells. RAW strings keep dates as text. */
function cellsRow(values: string[]): object {
  return { values: values.map((value) => ({ userEnteredValue: { stringValue: value } })) };
}

export function rowCount(runs: Runs | undefined): number {
  return (runs ?? []).reduce((n, run) => n + run.count, 0);
}

/** Merges each new date onto the run-length list, in the order the rows are appended. */
export function appendRuns(runs: Runs, dates: string[]): Runs {
  const next = runs.map((run) => ({ ...run }));
  for (const date of dates) {
    const last = next[next.length - 1];
    if (last && last.date === date) last.count += 1;
    else next.push({ date, count: 1 });
  }
  return next;
}

/**
 * Sheet row ranges (0-based, header at 0) holding dates before `cutoffDate`, and the runs
 * that remain. Ranges come back in descending order so deleting them in sequence keeps
 * the earlier indexes valid.
 */
export function staleRanges(runs: Runs, cutoffDate: string): { ranges: RowRange[]; kept: Runs } {
  const ranges: RowRange[] = [];
  const kept: Runs = [];
  let index = 1;
  for (const run of runs) {
    if (run.date < cutoffDate) {
      const last = ranges[ranges.length - 1];
      if (last && last.endIndex === index) last.endIndex = index + run.count;
      else ranges.push({ startIndex: index, endIndex: index + run.count });
    } else {
      const tail = kept[kept.length - 1];
      if (tail && tail.date === run.date) tail.count += run.count;
      else kept.push({ ...run });
    }
    index += run.count;
  }
  return { ranges: ranges.reverse(), kept };
}

/** 0-based sheet row of the Daily row for `date`, or null when the sheet has none. */
export function dailyRowIndex(runs: Runs, date: string): number | null {
  let index = 1;
  for (const run of runs) {
    if (run.date === date) return index;
    index += run.count;
  }
  return null;
}

/** 0-based sheet row of the `ord`th row dated `date`, counting across runs in sheet order. */
export function rowIndexOf(runs: Runs, date: string, ord: number): number | null {
  let index = 1;
  let seen = 0;
  for (const run of runs) {
    if (run.date === date) {
      if (ord < seen + run.count) return index + (ord - seen);
      seen += run.count;
    }
    index += run.count;
  }
  return null;
}

/** Rows dated `date` already in the sheet. The next one appended gets this as its ord. */
export function rowsOnDate(runs: Runs, date: string): number {
  return runs.reduce((n, run) => (run.date === date ? n + run.count : n), 0);
}

/** Writes one value into a column for a block of rows. */
export function fillColumnRequest(sheetId: number, column: number, startRow: number, endRow: number, value: string): object {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: column, endColumnIndex: column + 1 },
      cell: { userEnteredValue: { stringValue: value } },
      fields: "userEnteredValue",
    },
  };
}

/** Copies the values of one column into another for a block of rows, with no read. */
export function copyColumnRequest(sheetId: number, from: number, to: number, startRow: number, endRow: number): object {
  const range = (column: number) => ({
    sheetId,
    startRowIndex: startRow,
    endRowIndex: endRow,
    startColumnIndex: column,
    endColumnIndex: column + 1,
  });
  return { copyPaste: { source: range(from), destination: range(to), pasteType: "PASTE_VALUES", pasteOrientation: "NORMAL" } };
}

export function addSheetRequest(sheetId: number, title: string, index: number): object {
  return { addSheet: { properties: { sheetId, title, index } } };
}

export function deleteRowsRequest(sheetId: number, range: RowRange): object {
  return {
    deleteDimension: {
      range: { sheetId, dimension: "ROWS", startIndex: range.startIndex, endIndex: range.endIndex },
    },
  };
}

export function appendCellsRequest(sheetId: number, rows: string[][]): object {
  return { appendCells: { sheetId, rows: rows.map(cellsRow), fields: "userEnteredValue" } };
}

export function updateCellsRequest(sheetId: number, rowIndex: number, rows: string[][]): object {
  return {
    updateCells: { start: { sheetId, rowIndex, columnIndex: 0 }, rows: rows.map(cellsRow), fields: "userEnteredValue" },
  };
}

/** Rebuilds the run list from a column of dates read from the sheet (header excluded). */
export function runsFromDates(dates: string[]): Runs {
  return appendRuns([], dates);
}
