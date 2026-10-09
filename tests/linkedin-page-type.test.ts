import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { SyncProfileFields } from "../src/assistant-sync/db";
import { mergeDailyRepeats } from "../src/assistant-sync/merge";
import { PAGE_TYPES, pageTypeForUrl, visitPageType } from "../src/assistant-sync/page-type";
import { buildDayDocs } from "../src/assistant-sync/pages-doc";
import { visitRows } from "../src/assistant-sync/sheet";

const NOW = Date.parse("2026-10-08T15:00:00.000Z");
const PROFILE = "https://www.linkedin.com/in/ines-achterberg/";
const DETAILS = "https://www.linkedin.com/in/ines-achterberg/details/experience/";

describe("LinkedIn page types", () => {
  it("names profile and details pages, and leaves other LinkedIn pages alone", () => {
    expect(PAGE_TYPES).toContain("LinkedIn profile");
    expect(PAGE_TYPES).toContain("LinkedIn details");
    expect(pageTypeForUrl(PROFILE)).toBe("LinkedIn profile");
    expect(pageTypeForUrl("https://linkedin.com/in/ines-achterberg")).toBe("LinkedIn profile");
    expect(pageTypeForUrl(DETAILS)).toBe("LinkedIn details");
    expect(pageTypeForUrl("https://www.linkedin.com/in/ines-achterberg/details/skills/")).toBe("LinkedIn details");
    expect(pageTypeForUrl("https://www.linkedin.com/in/ines-achterberg/recent-activity/")).not.toMatch(/^LinkedIn (profile|details)$/);
    expect(pageTypeForUrl("https://www.linkedin.com/feed/")).not.toMatch(/^LinkedIn (profile|details)$/);
    expect(pageTypeForUrl("https://example.com/in/someone/")).not.toMatch(/^LinkedIn/);
  });

  it("relabels visits stored as Other before this change", () => {
    expect(visitPageType("Other", PROFILE)).toBe("LinkedIn profile");
    expect(visitPageType("Other", DETAILS)).toBe("LinkedIn details");
    expect(visitPageType("Other", "https://example.com/")).toBe("Other");
  });

  it("uses the same label in the Visits tab and the Pages doc", () => {
    const visit = (id: string, url: string, visitedAt: number) => ({
      id,
      visitedAt,
      title: `${id} | LinkedIn`,
      url,
      domain: "www.linkedin.com",
      dwellMinutes: 1,
      maxScrollPct: 50,
      pageType: "Other" as const,
      topics: [],
      finalizedAt: visitedAt,
    });
    const fields = (url: string, detailsPage?: SyncProfileFields["detailsPage"]): SyncProfileFields => ({
      name: "Ines Achterberg",
      headline: "Battery Systems Lead at Voltmere",
      location: "Rotterdam",
      about: "",
      experience: [{ title: "Battery Systems Lead", company: "Voltmere", dates: "Feb 2022 - Present" }],
      education: [],
      profileUrl: url,
      ...(detailsPage ? { detailsPage } : {}),
    });
    const profileVisit = visit("p", PROFILE, NOW);
    const detailsVisit = visit("d", DETAILS, NOW + 60_000);
    const [, profileRow, detailsRow] = visitRows([profileVisit, detailsVisit], "UTC");
    const typeColumn = 9;
    expect(profileRow![typeColumn]).toBe("LinkedIn profile");
    expect(detailsRow![typeColumn]).toBe("LinkedIn details");

    // Profile seen on its own: the doc section says LinkedIn profile, like its Visits row.
    const alone = buildDayDocs(
      mergeDailyRepeats(
        { visits: [profileVisit], content: [{ id: "p", visitedAt: NOW, title: "p", url: PROFILE, topics: [], text: "", profile: fields(PROFILE) }], searches: [], people: [], companies: [] },
        "UTC"
      ),
      [],
      "UTC"
    ).get("2026-10-08")!;
    expect(alone.sections[0]!.meta).toContain("LinkedIn profile");
    expect(alone.sections[0]!.meta).not.toContain("Other");

    // Only a details page that day: its section says LinkedIn details, like its Visits row.
    const onlyDetails = buildDayDocs(
      mergeDailyRepeats(
        {
          visits: [detailsVisit],
          content: [{ id: "d", visitedAt: NOW + 60_000, title: "d", url: DETAILS, topics: [], text: "", profile: fields(PROFILE, "experience") }],
          searches: [],
          people: [],
          companies: [],
        },
        "UTC"
      ),
      [],
      "UTC"
    ).get("2026-10-08")!;
    expect(onlyDetails.sections[0]!.meta).toContain("LinkedIn details");
  });
});
