import { describe, expect, it } from "vitest";
import type { SyncCompanyRecord, SyncPersonRecord, SyncSearchRecord, SyncVisitRecord } from "../src/assistant-sync/db";
import {
  aboutRows,
  companyRows,
  dailyRows,
  peopleRows,
  searchRows,
  visitRows,
} from "../src/assistant-sync/sheet";

const ZONE = "America/New_York";
const NOW = Date.parse("2026-10-02T16:00:00.000Z");

const visit: SyncVisitRecord = {
  id: "doc:1:1",
  visitedAt: NOW,
  title: "Pinecone pricing",
  url: "https://example.com/pinecone",
  domain: "example.com",
  dwellMinutes: 12,
  maxScrollPct: 40,
  pageType: "Article",
  topics: ["vector databases"],
  finalizedAt: NOW,
};

describe("sheet row builders", () => {
  it("writes visit cells as local date text, not serials, with pages_doc", () => {
    const [header, row] = visitRows([{ ...visit, visitCount: 2, lastVisitedAt: NOW + 60_000 }], ZONE, (id) =>
      id === "doc:1:1" ? "Bobbin Pages 2026-10-02 Friday#doc:1:1" : ""
    );
    expect(header[0]).toBe("id");
    expect(row).toEqual([
      "doc:1:1",
      "2026-10-02",
      "Friday",
      "12:00",
      "Pinecone pricing",
      "https://example.com/pinecone",
      "example.com",
      "12",
      "40",
      "Article",
      "vector databases",
      "2",
      "12:01",
      "this device",
      "Bobbin Pages 2026-10-02 Friday#doc:1:1",
    ]);
  });

  it("writes search, people, and company rows in the same timezone", () => {
    const search: SyncSearchRecord = { id: "s1", visitedAt: NOW, engine: "Google", query: "pgvector" };
    const person: SyncPersonRecord = {
      id: "p1",
      visitedAt: NOW,
      name: "Ada Marin",
      headline: "Factory software",
      company: "Tesla",
      profileUrl: "https://www.linkedin.com/in/ada-marin/",
      howFound: "search",
      dwellMinutes: 4,
      maxScrollPct: 80,
    };
    const company: SyncCompanyRecord = {
      id: "c1",
      visitedAt: NOW,
      company: "Tidora",
      sectionViewed: "About",
      linkedinUrl: "https://www.linkedin.com/company/tidora/",
      dwellMinutes: 2,
    };
    expect(searchRows([search], ZONE)[1]).toEqual(["s1", "2026-10-02", "Friday", "12:00", "Google", "pgvector"]);
    expect(peopleRows([person], ZONE, () => "doc")[1]?.[4]).toBe("Ada Marin");
    expect(companyRows([company], ZONE)[1]?.[4]).toBe("Tidora");
  });

  it("builds one Daily row and About text that names the timezone", () => {
    const daily = dailyRows(
      { visits: [visit], searches: [{ id: "s1", visitedAt: NOW, engine: "Google", query: "flights" }], people: [], companies: [], content: [] },
      ZONE
    );
    expect(daily[1]?.[0]).toBe("2026-10-02");
    expect(daily[1]?.[5]).toMatch(/flights/i);
    const about = aboutRows({
      firstDate: "2026-10-01",
      lastDate: "2026-10-02",
      checkedAt: "2026-10-02 12:00",
      newestAt: "2026-10-02 12:00",
      timeZone: ZONE,
      visits: 1,
      searches: 1,
      people: 0,
      companies: 0,
      sheetBytes: 1200,
    });
    expect(about.some((row) => /Dates and times are America\/New_York/.test(row[0]!))).toBe(true);
    expect(about.some((row) => /schema_version: 6/.test(row[0]!))).toBe(true);
    expect(JSON.stringify(about)).not.toMatch(/\u2014/);
  });
});
