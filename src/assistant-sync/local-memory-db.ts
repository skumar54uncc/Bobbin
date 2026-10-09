import Dexie, { type EntityTable } from "dexie";
import type { SearchEngine } from "./search-capture";

/**
 * A search kept on this device for Ask any assistant, whether or not Assistant Sync is on.
 * Its own database: the sync engine never opens it, so turning sync on later uploads none of it.
 */
export interface LocalSearchRecord {
  id: string;
  visitedAt: number;
  /** The engine's host, for Forget this site. */
  host: string;
  engine: SearchEngine;
  query: string;
}

/** Page text kept on this device for Ask any assistant's Include page text. Never synced. */
export interface LocalTextRecord {
  id: string;
  visitedAt: number;
  host: string;
  url: string;
  title: string;
  text: string;
}

class LocalMemoryDB extends Dexie {
  searches!: EntityTable<LocalSearchRecord, "id">;
  texts!: EntityTable<LocalTextRecord, "id">;

  constructor() {
    super("cortex-local-memory");
    this.version(1).stores({ searches: "id, visitedAt", texts: "id, visitedAt" });
  }
}

export const localMemoryDb = new LocalMemoryDB();
