/** Builds packet items from local memory. Runs in the service worker; data access is passed in. */
import { MAX_ITEMS, oneLine, type PacketItem, type PacketRequest } from "./packet";

export interface PageHit {
  url: string;
  title: string;
  visitedAt: number;
  snippet?: string;
}

export interface PersonHit {
  name: string;
  headline?: string;
  profileUrl: string;
  lastSeen: number;
  about?: string;
}

export interface SearchHit {
  id: string;
  visitedAt: number;
  engine: string;
  query: string;
}

export interface PageTextRecord {
  url: string;
  visitedAt: number;
  text: string;
}

export interface PacketDeps {
  searchPages: (query: string, from?: number, to?: number) => Promise<PageHit[]>;
  listPeople: (from?: number, to?: number) => Promise<PersonHit[]>;
  listSearches: (from: number, to: number) => Promise<SearchHit[]>;
  /** The Pages doc text captured around that time, kept while Assistant Sync is on. */
  pageTexts: (from: number, to: number) => Promise<PageTextRecord[]>;
}

const DAY = 24 * 60 * 60 * 1000;
const LABEL_CHARS = 200;

/** The Pages doc text for each page, nearest visit first; the search snippet when there is none. */
async function withPageText(items: PacketItem[], hits: PageHit[], deps: PacketDeps): Promise<void> {
  if (!items.length) return;
  const times = hits.map((h) => h.visitedAt);
  const texts = await deps.pageTexts(Math.min(...times) - DAY, Math.max(...times) + DAY);
  items.forEach((item, i) => {
    const hit = hits[i]!;
    const match = texts
      .filter((t) => t.url === hit.url && t.text.trim())
      .sort((a, b) => Math.abs(a.visitedAt - hit.visitedAt) - Math.abs(b.visitedAt - hit.visitedAt))[0];
    const text = match?.text || hit.snippet || "";
    if (text.trim()) item.text = text;
  });
}

export async function buildPacketItems(req: PacketRequest, deps: PacketDeps): Promise<PacketItem[]> {
  const inRange = (at: number) => (req.from == null || at >= req.from) && (req.to == null || at <= req.to);

  if (req.source === "people") {
    const people = (await deps.listPeople(req.from, req.to)).filter((p) => inRange(p.lastSeen)).slice(0, MAX_ITEMS);
    return people.map((p, i) => ({
      key: `person:${i}:${p.profileUrl}`,
      kind: "person" as const,
      at: p.lastSeen,
      label: oneLine(p.headline ? `${p.name}, ${p.headline}` : p.name, LABEL_CHARS),
      url: p.profileUrl,
      ...(req.withText && p.about?.trim() ? { text: p.about } : {}),
    }));
  }

  if (req.source === "searches") {
    if (req.from == null || req.to == null) return [];
    const rows = (await deps.listSearches(req.from, req.to)).sort((a, b) => b.visitedAt - a.visitedAt).slice(0, MAX_ITEMS);
    return rows.map((s) => ({
      key: `search:${s.id}`,
      kind: "search" as const,
      at: s.visitedAt,
      label: oneLine(`${s.engine} search: "${s.query}"`, LABEL_CHARS),
    }));
  }

  const query = req.source === "query" ? (req.query ?? "").trim().slice(0, 500) : "";
  if (req.source === "query" && !query) return [];
  const hits = (await deps.searchPages(query, req.from, req.to)).filter((h) => h.url && inRange(h.visitedAt)).slice(0, MAX_ITEMS);
  const items: PacketItem[] = hits.map((h, i) => ({
    key: `page:${i}:${h.url}`,
    kind: "page",
    at: h.visitedAt,
    label: oneLine(h.title || h.url, LABEL_CHARS),
    url: h.url,
  }));
  if (req.withText) await withPageText(items, hits, deps);
  return items;
}

/** Validates a request from the panel. */
export function parsePacketRequest(raw: unknown): PacketRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const source = r.source;
  if (source !== "pages" && source !== "people" && source !== "searches" && source !== "query") return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const from = num(r.from);
  const to = num(r.to);
  return {
    source,
    ...(typeof r.query === "string" ? { query: r.query.slice(0, 500) } : {}),
    ...(from != null && to != null && from <= to ? { from, to } : {}),
    withText: r.withText === true,
  };
}
