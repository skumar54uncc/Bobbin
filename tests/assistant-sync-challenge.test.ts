import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { isChallengePage, isChallengeText, isChallengeTitle, isChallengeUrl } from "../src/assistant-sync/challenge";
import { assistantSyncDb, clearAssistantSyncDatabase, defaultSyncEngineState, writeSyncEngineState, type SyncProfileFields } from "../src/assistant-sync/db";
import { syncDenyReason } from "../src/assistant-sync/denylist";
import { mergeDailyRepeats } from "../src/assistant-sync/merge";
import { buildDayDocs } from "../src/assistant-sync/pages-doc";
import { captureVisitFromChrome } from "../src/assistant-sync/runtime";
import { contentFinishedRendering, MAX_GROWTH_RECAPTURES, MAX_TITLE_RECAPTURES } from "../src/content/mutation-throttle";
import { dwellReportPageOk } from "../src/lib/message-security";

const NOW = Date.parse("2026-10-08T15:00:00.000Z");

beforeEach(async () => {
  await clearAssistantSyncDatabase();
  await writeSyncEngineState({ ...defaultSyncEngineState(), syncEnabled: true });
});

describe("challenge and login wall pages", () => {
  it("knows the titles", () => {
    for (const title of [
      "Security Verification",
      "Security Verification | LinkedIn",
      "Sign In",
      "Sign in | LinkedIn",
      "Sign Up | LinkedIn",
      "Join LinkedIn",
      "Just a moment...",
      "LinkedIn App Challenge",
      "LinkedIn Login, Sign in | LinkedIn",
      "Attention Required! | Cloudflare",
      "Verify you are human",
      "Log in",
    ]) {
      expect(isChallengeTitle(title), title).toBe(true);
    }
    for (const title of ["Sign in with Apple: a review", "How to verify you are human online, explained", "Just a moment of calm | Headspace", "Ines Achterberg | LinkedIn"]) {
      expect(isChallengeTitle(title), title).toBe(false);
    }
  });

  it("knows LinkedIn wall paths and challenge hosts", () => {
    for (const url of [
      "https://www.linkedin.com/checkpoint/challenge/AgF",
      "https://www.linkedin.com/authwall?trk=x",
      "https://www.linkedin.com/uas/login",
      "https://www.linkedin.com/login",
      "https://www.linkedin.com/signup/cold-join",
      "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b",
      "https://example.com/page?__cf_chl_rt_tk=abc",
      "https://www.google.com/sorry/index?continue=x",
    ]) {
      expect(isChallengeUrl(url), url).toBe(true);
    }
    for (const url of ["https://www.linkedin.com/in/ines-achterberg/", "https://example.com/login-tips-for-writers", "https://www.linkedin.com/feed/"]) {
      expect(isChallengeUrl(url), url).toBe(false);
    }
  });

  it("knows a Cloudflare interstitial by its words, only on short pages", () => {
    expect(isChallengeText("example.com Checking if the site connection is secure. Performance & security by Cloudflare")).toBe(true);
    expect(isChallengeText(`${"A long article about web security. ".repeat(80)} performance and security by Cloudflare`)).toBe(false);
    expect(isChallengePage({ url: "https://example.com/a", title: "example.com", text: "Verify you are human by completing the action below." })).toBe(true);
  });

  it("records nothing for a challenge page: no row, no text, no topics", async () => {
    let embeds = 0;
    const embed = async () => {
      embeds += 1;
      return null;
    };
    for (const [id, url, title] of [
      ["c1", "https://www.linkedin.com/checkpoint/challenge/x", "Security Verification | LinkedIn"],
      ["c2", "https://www.linkedin.com/in/ines-achterberg/", "Sign Up | LinkedIn"],
      ["c3", "https://example.com/report", "Just a moment..."],
    ] as const) {
      const out = await captureVisitFromChrome({ id, url, title, visitedAt: NOW, pageText: "x ".repeat(300), open: true }, embed);
      expect(out.stored, url).toBe(false);
    }
    expect(embeds).toBe(0);
    expect(await assistantSyncDb.visits.count()).toBe(0);
    expect(await assistantSyncDb.content.count()).toBe(0);
    // An auth path is already refused as sensitive; a challenge title on a normal path is refused as a challenge.
    expect(syncDenyReason("https://www.linkedin.com/authwall?x=1", { title: "LinkedIn" })).not.toBeNull();
    expect(syncDenyReason("https://www.linkedin.com/in/ines-achterberg/", { title: "Security Verification | LinkedIn" })).toBe("challenge");
  });

  it("is skipped before the service worker indexes or records a person", () => {
    const sw = readFileSync("src/background/service-worker.ts", "utf8");
    const at = sw.indexOf("isChallengePage({");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(sw.indexOf("maybeRecordPerson", at));
  });
});

describe("same address, new page", () => {
  it("re-captures when a thin page finishes rendering", () => {
    expect(contentFinishedRendering(120, 4_000)).toBe(true);
    expect(contentFinishedRendering(120, 600)).toBe(false);
    expect(contentFinishedRendering(900, 1_500)).toBe(false);
    expect(contentFinishedRendering(3_000, 9_000)).toBe(false);
    expect(contentFinishedRendering(null, 9_000)).toBe(false);
    expect(MAX_TITLE_RECAPTURES).toBeGreaterThanOrEqual(2);
    expect(MAX_GROWTH_RECAPTURES).toBeGreaterThanOrEqual(1);
  });

  it("re-indexes on a title change at the same address, and the new title replaces the old one", async () => {
    const main = readFileSync("src/content/main.ts", "utf8");
    expect(main).toMatch(/titleRecaptures < MAX_TITLE_RECAPTURES/);
    expect(main).toMatch(/contentFinishedRendering\(/);
    const base = { id: "doc:9:1", url: "https://example.com/report", visitedAt: NOW, open: true };
    await captureVisitFromChrome({ ...base, title: "Loading", pageText: null });
    await captureVisitFromChrome({ ...base, title: "Grid storage report 2026", pageText: "Real text. ".repeat(40) });
    expect((await assistantSyncDb.visits.get("doc:9:1"))?.title).toBe("Grid storage report 2026");
  });
});

describe("read time on LinkedIn profiles", () => {
  it("accepts the final report for the page measured even after the tab moved on", () => {
    const profile = "https://www.linkedin.com/in/ines-achterberg/";
    expect(dwellReportPageOk({ url: profile, final: true }, "https://www.linkedin.com/feed/", profile)).toBe(true);
    expect(dwellReportPageOk({ url: profile, final: false }, "https://www.linkedin.com/feed/", profile)).toBe(false);
    expect(dwellReportPageOk({ url: `${profile}#about`, final: false }, profile, undefined)).toBe(true);
    expect(dwellReportPageOk({ url: profile, final: true }, "https://www.linkedin.com/feed/", "https://example.com/")).toBe(false);
  });

  it("matches the open visit by the tab's address too, since LinkedIn redirects the profile URL", () => {
    const sw = readFileSync("src/background/service-worker.ts", "utf8");
    expect(sw).toMatch(/visit\.tabUrl && samePage\(visit\.tabUrl, report\.url\)/);
    expect(sw).toMatch(/dwellReportAllowed\(/);
  });
});

describe("LinkedIn details pages", () => {
  it("merge into the same person's section that day, and the details row points at it", () => {
    const at = (min: number) => NOW + min * 60_000;
    const visit = (id: string, url: string, title: string, visitedAt: number) => ({
      id,
      visitedAt,
      title,
      url,
      domain: "www.linkedin.com",
      dwellMinutes: 1,
      maxScrollPct: 50,
      pageType: "Other" as const,
      topics: [],
      finalizedAt: visitedAt,
    });
    const profile: SyncProfileFields = {
      name: "Ines Achterberg",
      headline: "Battery Systems Lead at Voltmere",
      location: "Rotterdam",
      about: "",
      experience: [
        { title: "Battery Systems Lead", company: "Voltmere", dates: "Feb 2022 - Present" },
        { title: "Commissioning Engineer", company: "Kalder Power", dates: "Sep 2015 - Jan 2022" },
      ],
      education: [],
      profileUrl: "https://www.linkedin.com/in/ines-achterberg/",
    };
    const details: SyncProfileFields = {
      name: "Ines Achterberg",
      headline: "",
      location: "",
      about: "",
      experience: [
        { title: "Battery Systems Lead", company: "Voltmere", dates: "Feb 2022 - Present" },
        { title: "Project Engineer", company: "Havstrom AS", dates: "Aug 2014 - Dec 2014" },
      ],
      education: [],
      profileUrl: "https://www.linkedin.com/in/ines-achterberg/",
      detailsPage: "experience",
    };
    const memory = {
      visits: [
        visit("d", "https://www.linkedin.com/in/ines-achterberg/details/experience/", "Experience | Ines Achterberg | LinkedIn", at(5)),
        visit("p", "https://www.linkedin.com/in/ines-achterberg/", "Ines Achterberg | LinkedIn", at(0)),
      ],
      content: [
        { id: "d", visitedAt: at(5), title: "Experience", url: "https://www.linkedin.com/in/ines-achterberg/details/experience/", topics: [], text: "", profile: details },
        { id: "p", visitedAt: at(0), title: "Ines", url: "https://www.linkedin.com/in/ines-achterberg/", topics: [], text: "", profile },
      ],
      searches: [],
      people: [],
      companies: [],
    };
    const day = buildDayDocs(mergeDailyRepeats(memory, "UTC"), [], "UTC").get("2026-10-08")!;
    expect(day.sections).toHaveLength(1);
    const section = day.sections[0]!;
    expect(section.id).toBe("p");
    expect(section.aliases).toEqual(["d"]);
    expect(section.body).toContain("Headline: Battery Systems Lead at Voltmere");
    expect(section.body).toContain("- Title: Project Engineer; Company: Havstrom AS; Dates: Aug 2014 - Dec 2014");
    expect(section.body.match(/Title: Battery Systems Lead/g)).toHaveLength(1);
    // Rows from both pages, in order, even when the details page lists fewer rows than the profile.
    expect(section.body.indexOf("Commissioning Engineer")).toBeLessThan(section.body.indexOf("Project Engineer"));
  });
});
