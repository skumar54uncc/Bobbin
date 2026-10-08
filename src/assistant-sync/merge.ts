import type { SyncCompanyRecord, SyncContentRecord, SyncPersonRecord, SyncSearchRecord, SyncVisitRecord } from "./db";
import { localVisitStamp } from "./local-time";

export interface MergedVisit extends SyncVisitRecord {
  visitCount: number;
  /** Start of the latest visit in this row. */
  lastVisitedAt: number;
  /** Every local visit id in this row, the row id first. */
  memberIds: string[];
}

export interface MemoryInput {
  visits: SyncVisitRecord[];
  content: SyncContentRecord[];
  searches: SyncSearchRecord[];
  people: SyncPersonRecord[];
  companies: SyncCompanyRecord[];
}

export interface MergedMemory {
  visits: MergedVisit[];
  content: SyncContentRecord[];
  searches: SyncSearchRecord[];
  people: SyncPersonRecord[];
  companies: SyncCompanyRecord[];
}

function sumDwell(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (!known.length) return null;
  return Math.round(known.reduce((a, b) => a + b, 0) * 10) / 10;
}

function maxOf(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v != null && Number.isFinite(v));
  return known.length ? Math.max(...known) : null;
}

const byTime = <T extends { id: string; visitedAt: number }>(a: T, b: T) => a.visitedAt - b.visitedAt || a.id.localeCompare(b.id);

/**
 * Repeat visits to the same URL on the same local day become one row: dwell is
 * summed, scroll is the deepest, visit_count counts them. Rows that share a
 * visit id (Content, Searches, People, Companies) move to the row id so they
 * still join to Visits. `rowIds` are visit ids the sheet already has as rows;
 * a group keeps such an id so the row is updated, never appended twice.
 */
export function mergeDailyRepeats(memory: MemoryInput, timeZone: string, rowIds: Set<string> = new Set()): MergedMemory {
  const groups = new Map<string, SyncVisitRecord[]>();
  for (const visit of [...memory.visits].sort(byTime)) {
    const key = `${localVisitStamp(visit.visitedAt, timeZone).date}\t${visit.url}\t${visit.device ?? "this"}`;
    const list = groups.get(key);
    if (list) list.push(visit);
    else groups.set(key, [visit]);
  }

  // Visits the sheet already has as separate rows (written before merging) stay separate.
  const split: SyncVisitRecord[][] = [];
  for (const members of groups.values()) {
    const rows = members.filter((m) => rowIds.has(m.id));
    if (rows.length <= 1) {
      split.push(members);
      continue;
    }
    const first = rows[0]!;
    split.push([first, ...members.filter((m) => !rowIds.has(m.id) && m !== first)]);
    for (const row of rows.slice(1)) split.push([row]);
  }

  const rowOf = new Map<string, string>();
  const visits: MergedVisit[] = [];
  for (const members of split) {
    const primary = members.find((m) => rowIds.has(m.id)) ?? members[0]!;
    for (const m of members) rowOf.set(m.id, primary.id);
    const topics: string[] = [];
    for (const m of [primary, ...members]) for (const t of m.topics) if (!topics.includes(t)) topics.push(t);
    visits.push({
      ...primary,
      dwellMinutes: sumDwell(members.map((m) => m.dwellMinutes)),
      maxScrollPct: maxOf(members.map((m) => m.maxScrollPct)),
      topics: topics.slice(0, 3),
      visitedAt: Math.min(...members.map((m) => m.visitedAt)),
      visitCount: members.length,
      lastVisitedAt: Math.max(...members.map((m) => m.visitedAt)),
      memberIds: [primary.id, ...members.filter((m) => m !== primary).map((m) => m.id)],
    });
  }
  visits.sort(byTime);

  /** Groups rows by their visit row. `pick` merges a group into one row. */
  const regroup = <T extends { id: string; visitedAt: number }>(rows: T[], pick: (list: T[], id: string) => T): T[] => {
    const by = new Map<string, T[]>();
    for (const row of [...rows].sort(byTime)) {
      const id = rowOf.get(row.id) ?? row.id;
      const list = by.get(id);
      if (list) list.push(row);
      else by.set(id, [row]);
    }
    return [...by.entries()].map(([id, list]) => ({ ...pick(list, id), id })).sort(byTime);
  };
  const own = <T extends { id: string }>(list: T[], id: string): T => list.find((r) => r.id === id) ?? list[0]!;

  return {
    visits,
    // The first excerpt of the day stays. A later read does not rewrite a row the sheet has.
    content: regroup(memory.content, own),
    searches: regroup(memory.searches, own),
    people: regroup(memory.people, (list, id) => ({
      ...own(list, id),
      dwellMinutes: sumDwell(list.map((r) => r.dwellMinutes)),
      maxScrollPct: maxOf(list.map((r) => r.maxScrollPct)),
    })),
    companies: regroup(memory.companies, (list, id) => ({
      ...own(list, id),
      dwellMinutes: sumDwell(list.map((r) => r.dwellMinutes)),
    })),
  };
}
