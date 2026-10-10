// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { profileFields } from "../src/assistant-sync/capture";
import { PUBLIC_VIEW_NOTE, profileBody } from "../src/assistant-sync/pages-doc";
import { parseLinkedInPage, sanitizePersonDetail, type LinkedInEntity } from "../src/lib/capture/linkedin";

/** Synthetic fixtures: invented people, modeled on LinkedIn's layouts. */
function load(name: string): Document {
  const html = readFileSync(join(__dirname, "fixtures", "linkedin", name), "utf8");
  return new DOMParser().parseFromString(html, "text/html");
}

/** The same path the service worker takes: parse, sanitize, then the labeled fields the Pages doc writes. */
function pipeline(name: string, url: string): { entity: LinkedInEntity; body: string } {
  const entity = parseLinkedInPage(load(name), url)!;
  expect(entity).toBeTruthy();
  const detail = sanitizePersonDetail(entity as unknown as Record<string, unknown>);
  const fields = profileFields({
    kind: "person",
    name: entity.name,
    headline: entity.headline,
    company: entity.company,
    profileUrl: entity.profileUrl,
    location: detail.location,
    about: detail.about,
    aboutTruncated: detail.aboutTruncated === true,
    experience: detail.experience ?? [],
    education: detail.education ?? [],
    schools: detail.schools ?? [],
    skills: detail.skills ?? [],
    publicView: detail.publicView === true,
    detailsPage: detail.detailsPage,
  })!;
  return { entity, body: profileBody(fields) };
}

/** Text from buttons, sign-in forms, overlays, rails, and ads. None of it may reach the doc. */
const UI_TEXT = [
  /see more/i,
  /show (all|more)/i,
  /\bMessage\b/,
  /\bConnect\b/,
  /\bFollow\b/,
  /join now/i,
  /sign in/i,
  /welcome back/i,
  /email or phone/i,
  /password/i,
  /user agreement/i,
  /new to linkedin/i,
  /endorse/i,
  /promoted/i,
  /recruiter lite/i,
  /people also viewed/i,
  /other similar profiles/i,
  /Bram Oosterhuis/,
  /Sanne de Wit/,
  /Gridvale/,
  /Messaging/,
  /Join to view/i,
];

function expectNoUi(text: string): void {
  for (const pattern of UI_TEXT) expect(text, `found ${pattern}`).not.toMatch(pattern);
}

describe("LinkedIn profile fixtures", () => {
  it("signed in: labeled name, headline, location, role, full About, experience, education, and skills", () => {
    const { entity, body } = pipeline("profile-signed-in.html", "https://www.linkedin.com/in/ines-achterberg/");
    expect(entity.publicView).toBeFalsy();
    expect(entity.aboutTruncated).toBeFalsy();
    const lines = body.split("\n");
    expect(lines[0]).toBe("Name: Ines Achterberg");
    expect(lines).toContain("Headline: Battery Systems Lead at Voltmere · Grid storage");
    expect(lines).toContain("Location: Rotterdam, South Holland, Netherlands");
    expect(lines).toContain("Current role: Battery Systems Lead at Voltmere");
    const about = lines.find((l) => l.startsWith("About: "))!;
    // The whole About, read from the page's own copy without clicking "see more", once.
    expect(about).toMatch(/^About: I lead the battery systems team at Voltmere\./);
    expect(about).toMatch(/write about long duration storage\.$/);
    expect(about.match(/I lead the battery systems team/g)).toHaveLength(1);
    expect(lines).toContain(
      "- Title: Battery Systems Lead; Company: Voltmere; Dates: Feb 2022 - Present · 3 yrs 9 mos; Location: Rotterdam, South Holland, Netherlands · Hybrid"
    );
    const description = lines.find((l) => l.startsWith("  Description: Leads a team of nine engineers"))!;
    expect(description.length - "  Description: ".length).toBeLessThanOrEqual(303);
    expect(description).toMatch(/\.\.\.$/);
    expect(lines).toContain("- Title: Commissioning Engineer; Company: Kalder Power; Dates: Sep 2015 - Jan 2022 · 6 yrs 5 mos; Location: Antwerp, Flanders, Belgium");
    expect(lines).toContain("- School: Delft University of Technology; Degree: Master of Science - MS; Field: Electrical Power Engineering; Years: 2013 - 2015");
    expect(lines).toContain("- School: Eindhoven University of Technology; Degree: Bachelor of Science - BS; Field: Electrical Engineering; Years: 2010 - 2013");
    expect(lines).toContain("Skills: Battery management systems, Power systems, Thermal modeling");
    expect(body).not.toContain(PUBLIC_VIEW_NOTE);
    expectNoUi(body);
    expectNoUi(JSON.stringify(entity.experience ?? []) + JSON.stringify(entity.schools ?? []) + (entity.about ?? ""));
  });

  it("logged out: parses what the public layout shows and says it is a limited view", () => {
    const { entity, body } = pipeline("profile-public.html", "https://nl.linkedin.com/in/ines-achterberg");
    expect(entity.publicView).toBe(true);
    const lines = body.split("\n");
    expect(lines).toContain("Name: Ines Achterberg");
    expect(lines).toContain("Headline: Battery Systems Lead at Voltmere");
    expect(lines).toContain("Location: Rotterdam, South Holland, Netherlands");
    // The full copy of About, not the shortened one with its ellipsis.
    expect(lines).toContain(
      "About: I lead the battery systems team at Voltmere. We design containerized storage for regional grids, from cell selection and thermal modeling to the controls that decide when a site charges. I care about safety cases that operators can read."
    );
    expect(lines).toContain("- Title: Battery Systems Lead; Company: Voltmere; Dates: Feb 2022 - Present; Location: Rotterdam, South Holland, Netherlands");
    expect(lines).toContain("- Title: Commissioning Engineer; Company: Kalder Power; Dates: Sep 2015 - Jan 2022");
    expect(lines.some((l) => l.startsWith("- School: Delft University of Technology; Degree: Master of Science - MS"))).toBe(true);
    expect(lines[lines.length - 1]).toBe(PUBLIC_VIEW_NOTE);
    expect(PUBLIC_VIEW_NOTE).toBe("Limited public view. Sign in to LinkedIn for full details.");
    expectNoUi(body.replace(PUBLIC_VIEW_NOTE, ""));
  });

  it("login popup open: keeps the profile's own text, drops the popup, and marks a cut About", () => {
    const { entity, body } = pipeline("profile-login-popup.html", "https://www.linkedin.com/in/ines-achterberg/");
    expect(entity.aboutTruncated).toBe(true);
    const lines = body.split("\n");
    expect(lines).toContain("Name: Ines Achterberg");
    expect(lines).toContain(
      "About: I lead the battery systems team at Voltmere. We design containerized storage for regional grids, from cell selection and thermal modeling to the controls that decide when a site charges (truncated on page)"
    );
    expect(lines).toContain("- Title: Battery Systems Lead; Company: Voltmere; Dates: Feb 2022 - Present");
    expectNoUi(body.replace(PUBLIC_VIEW_NOTE, ""));
    expectNoUi(entity.about ?? "");
  });
});
