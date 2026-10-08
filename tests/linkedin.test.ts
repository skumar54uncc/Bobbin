// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseLinkedInPage,
  canonicalLinkedInUrl,
  profilePhotoUrl,
  sameLinkedInProfile,
} from "../src/lib/capture/linkedin";

function doc(name: string): Document {
  const html = readFileSync(join(__dirname, "fixtures", "linkedin", name), "utf8");
  return new DOMParser().parseFromString(html, "text/html");
}

describe("canonicalLinkedInUrl", () => {
  it("normalizes profile and company URLs and rejects everything else", () => {
    expect(canonicalLinkedInUrl("https://www.linkedin.com/in/mira-okafor-lind-12ab/?miniProfileUrn=x#top")).toBe(
      "https://www.linkedin.com/in/mira-okafor-lind-12ab/"
    );
    expect(canonicalLinkedInUrl("https://linkedin.com/in/Mira/details/experience/")).toBe(
      "https://www.linkedin.com/in/mira/"
    );
    expect(canonicalLinkedInUrl("https://de.linkedin.com/company/tidora/about/")).toBe(
      "https://www.linkedin.com/company/tidora/"
    );
    expect(canonicalLinkedInUrl("https://www.linkedin.com/school/unc-charlotte/about/")).toBe(
      "https://www.linkedin.com/school/unc-charlotte/"
    );
    expect(canonicalLinkedInUrl("https://www.linkedin.com/showcase/acme-labs/")).toBe(
      "https://www.linkedin.com/showcase/acme-labs/"
    );
    expect(canonicalLinkedInUrl("https://www.linkedin.com/feed/")).toBeNull();
    expect(canonicalLinkedInUrl("https://evil.example/in/mira/")).toBeNull();
    expect(canonicalLinkedInUrl("https://linkedin.com.evil.example/in/mira/")).toBeNull();
  });

  it("treats tracking queries and overlay paths as the same profile", () => {
    expect(
      sameLinkedInProfile(
        "https://www.linkedin.com/in/nairobi-toombs-574667213/",
        "https://www.linkedin.com/in/nairobi-toombs-574667213/?trk=public_profile&lipi=abc"
      )
    ).toBe(true);
    expect(
      sameLinkedInProfile(
        "https://www.linkedin.com/in/nairobi-toombs-574667213/overlay/contact-info/",
        "https://www.linkedin.com/in/nairobi-toombs-574667213/"
      )
    ).toBe(true);
    expect(
      sameLinkedInProfile(
        "https://www.linkedin.com/in/nairobi-toombs-574667213/",
        "https://www.linkedin.com/in/someone-else/"
      )
    ).toBe(false);
    expect(
      sameLinkedInProfile("https://www.linkedin.com/feed/", "https://www.linkedin.com/in/nairobi-toombs-574667213/")
    ).toBe(false);
  });
});

describe("profilePhotoUrl", () => {
  it("keeps a LinkedIn CDN photo and drops ghosts and other hosts", () => {
    expect(
      profilePhotoUrl("https://media.licdn.com/dms/image/v2/D4E03AQH/profile-displayphoto-shrink_200_200/0/1")
    ).toContain("profile-displayphoto-shrink_200_200");
    expect(profilePhotoUrl("https://static.licdn.com/aero-v1/sc/h/ghost-person")).toBeUndefined();
    expect(profilePhotoUrl("https://evil.example/photo.jpg")).toBeUndefined();
    expect(profilePhotoUrl("http://media.licdn.com/x")).toBeUndefined();
  });

  it("reads the top-card photo onto the parsed profile", () => {
    const html = `<main><section class="pv-top-card"><h1>Mira Okafor-Lind</h1>
      <div class="text-body-medium">Head of Field Programs</div>
      <img src="https://media.licdn.com/dms/image/v2/D4E/profile-displayphoto-shrink_100_100/0/1"
        srcset="https://media.licdn.com/dms/image/v2/D4E/profile-displayphoto-shrink_100_100/0/1 100w, https://media.licdn.com/dms/image/v2/D4E/profile-displayphoto-shrink_400_400/0/1 400w" />
      </section></main>`;
    const d = new DOMParser().parseFromString(html, "text/html");
    d.title = "Mira Okafor-Lind | LinkedIn";
    const p = parseLinkedInPage(d, "https://www.linkedin.com/in/mira-okafor-lind/");
    expect(p?.photoUrl).toContain("profile-displayphoto-shrink_400_400");
  });
});

describe("parseLinkedInPage", () => {
  it("parses a profile: name, headline, current company, canonical URL", () => {
    const p = parseLinkedInPage(doc("profile.html"), "https://www.linkedin.com/in/mira-okafor-lind-12ab/?trk=x");
    expect(p).toMatchObject({
      kind: "person",
      name: "Mira Okafor-Lind",
      headline: "Head of Field Programs at Tidora · Tidal microgrids",
      company: "Tidora",
      profileUrl: "https://www.linkedin.com/in/mira-okafor-lind-12ab/",
    });
  });

  it("falls back to the headline 'at X' and then the page title when the company button is missing", () => {
    const d = doc("profile.html");
    d.querySelector('button[aria-label^="Current company"]')?.remove();
    expect(parseLinkedInPage(d, "https://www.linkedin.com/in/mira/")?.company).toBe("Tidora");
    d.querySelector("h1")?.remove();
    d.querySelector(".text-body-medium")?.remove();
    const p = parseLinkedInPage(d, "https://www.linkedin.com/in/mira/");
    expect(p?.name).toBe("Mira Okafor-Lind");
    expect(p?.headline).toBe("Head of Field Programs at Tidora");
    expect(p?.company).toBe("Tidora");
  });

  it("parses a company page", () => {
    expect(parseLinkedInPage(doc("company.html"), "https://www.linkedin.com/company/tidora/")).toMatchObject({
      kind: "company",
      name: "Tidora",
      headline: "Tidal energy microgrids for island communities",
      company: "Tidora",
      profileUrl: "https://www.linkedin.com/company/tidora/",
    });
  });

  it("returns null for the feed, for other hosts, and when no name can be found", () => {
    expect(parseLinkedInPage(doc("feed.html"), "https://www.linkedin.com/feed/")).toBeNull();
    expect(parseLinkedInPage(doc("profile.html"), "https://evil.example/in/mira/")).toBeNull();
    const empty = new DOMParser().parseFromString("<html><head><title>LinkedIn</title></head><body></body></html>", "text/html");
    expect(parseLinkedInPage(empty, "https://www.linkedin.com/in/x/")).toBeNull();
  });

  it("reads a current profile: name in a header, no section anchors, company link", () => {
    const html = `<html><head>
      <title>Nairobi Toombs | LinkedIn</title>
      <meta property="og:title" content="Feed | LinkedIn" />
    </head><body>
      <header class="global-nav"><h1>LinkedIn</h1></header>
      <main>
        <section data-member-id="99">
          <header><h2>Nairobi Toombs</h2></header>
          <div><span>Product designer</span></div>
          <span>Charlotte, North Carolina</span>
          <img src="https://media.licdn.com/dms/image/v2/D4E/profile-displayphoto-shrink_400_400/0/1" />
        </section>
        <section>
          <h2>Experience</h2>
          <ul><li>
            <span aria-hidden="true">Product designer</span>
            <a href="https://www.linkedin.com/company/acme/">Acme</a>
            <span aria-hidden="true">Jan 2024 to Present</span>
          </li></ul>
        </section>
      </main></body></html>`;
    const d = new DOMParser().parseFromString(html, "text/html");
    const p = parseLinkedInPage(d, "https://www.linkedin.com/in/nairobi-toombs-574667213/?trk=x");
    expect(p).toMatchObject({
      kind: "person",
      name: "Nairobi Toombs",
      headline: "Product designer",
      company: "Acme",
      roleTitle: "Product designer",
      location: "Charlotte, North Carolina",
      profileUrl: "https://www.linkedin.com/in/nairobi-toombs-574667213/",
    });
    expect(p?.photoUrl).toContain("profile-displayphoto-shrink_400_400");
  });

  it("reads a long headline and the person's photo, not the school logo", () => {
    const headline =
      "Seeking AI Internship or Full-Time Opportunities in USA | MS in CS | Experienced RPA developer | Process Automation | AI automation";
    const html = `<html><head><title>Gokul Krishna A | LinkedIn</title></head><body><main>
      <section>
        <a href="https://www.linkedin.com/school/binghamton-university/">
          <img src="https://media.licdn.com/dms/image/v2/D560BAQ/company-logo_200_200/0/1" />
          <span>Binghamton University</span>
        </a>
        <h2>Gokul Krishna A</h2>
        <div><span>${headline}</span></div>
        <span>United States</span>
        <a>Contact info</a>
        <img src="https://media.licdn.com/dms/image/v2/D4E03AQ/profile-displayphoto-shrink_100_100/0/1" />
        <img src="https://media.licdn.com/dms/image/v2/D4E03AQ/profile-displayphoto-shrink_400_400/0/2" />
      </section>
    </main></body></html>`;
    const p = parseLinkedInPage(
      new DOMParser().parseFromString(html, "text/html"),
      "https://www.linkedin.com/in/gokulkrishna/"
    );
    expect(p?.headline).toBe(headline);
    expect(p?.photoUrl).toContain("profile-displayphoto-shrink_400_400");
    expect(p?.photoUrl).not.toContain("company-logo");
  });

  it("keeps the profile photo when a larger face sits in the recommendation rail", () => {
    const html = `<html><head><title>Laura Yang | LinkedIn</title></head><body><main>
      <section data-member-id="7">
        <h2>Laura Yang</h2>
        <div><span>Aspiring CPA | Accounting Student at University of North Carolina at Charlotte</span></div>
        <img alt="Laura Yang" src="https://media.licdn.com/dms/image/v2/LAURA/profile-displayphoto-shrink_200_200/0/1" />
      </section>
      <aside>
        <a href="https://www.linkedin.com/in/bill-gates/">
          <img alt="Bill Gates" src="https://media.licdn.com/dms/image/v2/BILL/profile-displayphoto-shrink_800_800/0/2" />
        </a>
      </aside>
    </main></body></html>`;
    const p = parseLinkedInPage(
      new DOMParser().parseFromString(html, "text/html"),
      "https://www.linkedin.com/in/laura-yang-741b1431a/"
    );
    expect(p?.name).toBe("Laura Yang");
    expect(p?.photoUrl).toContain("LAURA");
    expect(p?.photoUrl).not.toContain("BILL");
  });

  it("keeps the photo that links to this profile's own photo viewer", () => {
    const html = `<html><head><title>Tabitha Hadley, M.S | LinkedIn</title></head><body><main>
      <section>
        <a href="/in/tabitha-hadley/overlay/photo/">
          <img src="https://media.licdn.com/dms/image/v2/TABITHA/profile-displayphoto-shrink_400_400/0/1" />
        </a>
        <h1>Tabitha Hadley, M.S</h1>
        <div><span>Manager, Early Talent Technology Programs | BRG Leadership</span></div>
        <a href="/search/results/people/?facetConnectionOf=x">
          <img src="https://media.licdn.com/dms/image/v2/MUTUAL/profile-displayphoto-shrink_800_800/0/2" />
          <span>Abdul-Rahman and 235 other mutual connections</span>
        </a>
      </section>
    </main></body></html>`;
    const p = parseLinkedInPage(
      new DOMParser().parseFromString(html, "text/html"),
      "https://www.linkedin.com/in/tabitha-hadley/"
    );
    expect(p?.photoUrl).toContain("TABITHA");
  });

  it("keeps this profile's photo when a larger face is listed under more profiles", () => {
    const html = `<html><head><title>Luckas Mejia Granadino | LinkedIn</title></head><body><main>
      <section>
        <button aria-label="Luckas Mejia Granadino">
          <img alt="Luckas Mejia Granadino" src="https://media.licdn.com/dms/image/v2/LUCKAS/profile-displayphoto-shrink_800_800/0/1" />
        </button>
        <h1>Luckas Mejia Granadino</h1>
        <div><span>Electrical Engineering Student at UNC Charlotte</span></div>
        <h2>More profiles for you</h2>
        <ul><li>
          <img src="https://media.licdn.com/dms/image/v2/OTHER/profile-displayphoto-shrink_800_800/0/2" />
          <a href="https://www.linkedin.com/in/someone-else/">Someone Else</a>
        </li></ul>
      </section>
    </main></body></html>`;
    const p = parseLinkedInPage(
      new DOMParser().parseFromString(html, "text/html"),
      "https://www.linkedin.com/in/luckas-mejia-granadino/"
    );
    expect(p?.headline).toBe("Electrical Engineering Student at UNC Charlotte");
    expect(p?.photoUrl).toContain("LUCKAS");
    expect(p?.photoUrl).not.toContain("OTHER");
  });

  it("caps field lengths (page-controlled text)", () => {
    const d = doc("profile.html");
    d.querySelector("h1")!.textContent = "N".repeat(500);
    const p = parseLinkedInPage(d, "https://www.linkedin.com/in/x/");
    expect(p!.name.length).toBeLessThanOrEqual(120);
  });
});

describe("parseLinkedInPage profile detail", () => {
  const p = parseLinkedInPage(doc("profile.html"), "https://www.linkedin.com/in/mira/")!;

  it("captures location, connection degree and connection count", () => {
    expect(p.location).toBe("Bergen, Norway");
    expect(p.connectionDegree).toBe("2nd");
    expect(p.connectionCount).toBe(842);
  });

  it("captures the about text, trimmed and capped at 600 characters", () => {
    expect(p.about).toContain("Co-founder turned operator.");
    expect(p.about).toContain("PolyWise");
    expect(p.about!.length).toBeLessThanOrEqual(600);
    expect(p.about).not.toContain("\n");
    expect(p.about).not.toMatch(/\s{2}/);
  });

  it("captures the current role title and up to five past roles", () => {
    expect(p.roleTitle).toBe("Head of Field Programs");
    expect(p.pastRoles!.length).toBeLessThanOrEqual(5);
    expect(p.pastRoles!.slice(0, 3)).toEqual([
      { title: "Grid Operations Lead", company: "Nordwind Energy" },
      { title: "Co-founder", company: "PolyWise" },
      { title: "Senior Field Engineer", company: "PolyWise" },
    ]);
    // The current role is not repeated in the past roles.
    expect(p.pastRoles!.some((r) => r.title === "Head of Field Programs")).toBe(false);
  });

  it("captures up to three education entries as school plus degree", () => {
    expect(p.education).toEqual([
      "NTNU, Master of Science, Electrical Engineering",
      "University of Bergen, Bachelor of Science, Physics",
      "Chalmers University of Technology, Exchange, Marine Engineering",
    ]);
  });

  it("summarises the profile in one or two plain sentences", () => {
    expect(p.summary).toBe(
      "Head of Field Programs at Tidora, based in Bergen, Norway. Co-founder turned operator."
    );
    expect(p.summary!.length).toBeLessThanOrEqual(200);
    expect(p.summary).not.toContain(String.fromCharCode(0x2014));
  });

  it("reads text only, never markup", () => {
    const d = doc("profile.html");
    d.querySelector("#about")!.closest("section")!.querySelector("span[aria-hidden='true']")!.textContent =
      "<script>alert(1)</script> plain";
    const q = parseLinkedInPage(d, "https://www.linkedin.com/in/mira/")!;
    expect(q.about).toBe("<script>alert(1)</script> plain");
    expect(d.querySelector("#about")!.closest("section")!.querySelector("script")).toBeNull();
  });

  it("leaves detail fields off when the page does not show them", () => {
    const d = doc("profile.html");
    for (const id of ["about", "experience", "education"]) {
      d.querySelector(`#${id}`)!.closest("section")!.remove();
    }
    d.querySelector(".text-body-small")!.remove();
    d.querySelector(".distance-badge")!.remove();
    d.querySelector(".pv-top-card--list")!.remove();
    const q = parseLinkedInPage(d, "https://www.linkedin.com/in/mira/")!;
    expect(q.about).toBeUndefined();
    expect(q.pastRoles).toBeUndefined();
    expect(q.education).toBeUndefined();
    expect(q.connectionCount).toBeUndefined();
    expect(q.name).toBe("Mira Okafor-Lind");
  });
});

describe("parseLinkedInPage company detail", () => {
  const c = parseLinkedInPage(doc("company.html"), "https://www.linkedin.com/company/tidora/")!;

  it("captures industry, size, tagline, location and the about text", () => {
    expect(c.industry).toBe("Renewable Energy Semiconductor Manufacturing");
    expect(c.companySize).toBe("51-200 employees");
    expect(c.tagline).toBe("Tidal energy microgrids for island communities");
    expect(c.location).toBe("Bergen, Vestland");
    expect(c.about).toContain("tidal microgrids for island communities");
  });

  it("summarises the company by tagline, industry, place and size", () => {
    expect(c.summary).toBe(
      "Tidal energy microgrids for island communities. Renewable Energy Semiconductor Manufacturing, Bergen, Vestland, 51-200 employees."
    );
  });

  it("saves a company from its address when the home tab is only a post", () => {
    const html = `<html><head><title>Feed | LinkedIn</title></head><body>
      <div class="org-top-card"><h1>Fifth Third Bank</h1><p>The curious bank</p></div>
      <main><article><h2>We're hiring</h2><p>Join Fifth Third Bank today.</p></article></main>
    </body></html>`;
    const c = parseLinkedInPage(
      new DOMParser().parseFromString(html, "text/html"),
      "https://www.linkedin.com/company/fifth-third-bank/posts/?feedView=all"
    );
    expect(c?.kind).toBe("company");
    expect(c?.name).toBe("Fifth Third Bank");
    expect(c?.headline).toBe("The curious bank");
    expect(c?.profileUrl).toBe("https://www.linkedin.com/company/fifth-third-bank/");
  });

  it("uses the tab title when it matches the company slug, and the short tagline as the headline", () => {
    const html = `<html><head><title>Charlotte Center City Partners | LinkedIn</title></head><body>
      <main>
        <section>
          <img alt="University of North Carolina at Charlotte" src="https://media.licdn.com/dms/image/v2/C4E/company-logo_200_200/0/1" />
          <h1>University City Partners</h1>
          <p>A City Within A City</p>
          <span>Non-profit Organizations · Charlotte, North Carolina · 1.8K followers · 2-10 employees</span>
        </section>
        <section>
          <h2>Overview</h2>
          <p>Every day we have an opportunity to make University City, Charlotte North Carolina a little better.</p>
        </section>
      </main></body></html>`;
    const c = parseLinkedInPage(
      new DOMParser().parseFromString(html, "text/html"),
      "https://www.linkedin.com/company/charlottecentercitypartners/home/"
    );
    expect(c?.name).toBe("Charlotte Center City Partners");
    expect(c?.headline).toBe("A City Within A City");
    expect(c?.tagline).toBe("A City Within A City");
  });

  it("reads a company tagline when the page has no tagline class", () => {
    const tagline =
      "The best cloud-based payments platform for banks to offer modern global transaction banking for the connected economy.";
    const html = `<html><head><title>finzly | LinkedIn</title></head><body>
      <header class="global-nav"></header>
      <main>
        <section>
          <img src="https://media.licdn.com/dms/image/v2/C4E/company-logo_200_200/0/1" />
          <h2>finzly</h2>
          <p>${tagline}</p>
          <span>Financial Services · Charlotte, North Carolina · 23K followers · 201-500 employees</span>
        </section>
        <section>
          <h2>Overview</h2>
          <p>We help banks to prepare for the embedded, connected and real-time demands of the new economy.</p>
        </section>
      </main></body></html>`;
    const c = parseLinkedInPage(
      new DOMParser().parseFromString(html, "text/html"),
      "https://www.linkedin.com/company/finzly/home/"
    );
    expect(c?.kind).toBe("company");
    expect(c?.name).toBe("finzly");
    expect(c?.headline).toBe(tagline);
    expect(c?.photoUrl).toContain("company-logo");
  });

  it("keeps the company tagline when a jobs tab also shows buttons and stats", () => {
    const html = `<html><head><title>BioCytics Inc | LinkedIn</title></head><body>
      <div class="org-top-card">
        <img alt="BioCytics Inc" src="https://media.licdn.com/dms/image/v2/BIO/company-logo_200_200/0/1" />
        <h1>BioCytics Inc</h1>
        <p>Human Application Lab</p>
        <span>Show all</span>
        <span>10%</span>
        <span>37</span>
        <p>BioCytics is an R&amp;D incubator within Carolina BioOncology Institute</p>
      </div>
      <main><section><h2>Jobs</h2><button>Show all</button></section></main>
    </body></html>`;
    const c = parseLinkedInPage(
      new DOMParser().parseFromString(html, "text/html"),
      "https://www.linkedin.com/company/biocytics-inc./jobs/"
    );
    expect(c?.name).toBe("BioCytics Inc");
    expect(c?.headline).toBe("Human Application Lab");
    expect(c?.tagline).toBe("Human Application Lab");
    expect(c?.photoUrl).toContain("company-logo");
  });

  it("reads a single bullet separated info line too", () => {
    const d = doc("company.html");
    const list = d.querySelector(".org-top-card-summary-info-list")!;
    list.replaceChildren(d.createTextNode("Maritime · Raleigh, North Carolina · 900 followers · 11-50 employees"));
    const q = parseLinkedInPage(d, "https://www.linkedin.com/company/tidora/")!;
    expect(q.industry).toBe("Maritime");
    expect(q.location).toBe("Raleigh, North Carolina");
    expect(q.companySize).toBe("11-50 employees");
  });
});
