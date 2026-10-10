import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "../src/db/schema";
import { deletePerson, upsertPerson } from "../src/lib/people";
import { forgetSite } from "../src/lib/data-controls";
import {
  PHOTO_REFRESH_MS,
  cacheProfilePhoto,
  getProfilePhoto,
  personPhotoCandidates,
  profilesWithPhotos,
  pruneOrphanPhotos,
} from "../src/lib/profile-photos";

const PROFILE = "https://www.linkedin.com/in/mira/";
const PHOTO = "https://media.licdn.com/dms/image/v2/D4E/profile-displayphoto-shrink_200_200/0/1";
const NOW = Date.parse("2026-10-08T12:00:00Z");

function jpegResponse(url = ""): Response {
  const bytes = new Uint8Array(64);
  bytes.set([0xff, 0xd8, 0xff]);
  const res = new Response(bytes, { status: 200, headers: { "content-type": "image/jpeg" } });
  if (url) Object.defineProperty(res, "url", { value: url });
  return res;
}

beforeEach(async () => {
  await db.people.clear();
  await db.photos.clear();
});

describe("personPhotoCandidates", () => {
  it("asks for a larger company logo, then the size the page gave", () => {
    const photos = personPhotoCandidates("https://media.licdn.com/dms/image/v2/C4E/company-logo_200_200/0/1");
    expect(photos[0]).toContain("company-logo_800_800");
    expect(photos[1]).toContain("company-logo_400_400");
    expect(photos[2]).toContain("company-logo_200_200");
  });

  it("asks for the plain portrait before the open-to-work frame", () => {
    const photos = personPhotoCandidates("https://media.licdn.com/dms/image/v2/D4E/profile-framedphoto-shrink_200_200/0/1");
    expect(photos[0]).toContain("profile-displayphoto-shrink_800_800");
    expect(photos.some((href) => href.includes("profile-framedphoto-shrink_200_200"))).toBe(true);
  });

  it("refuses other hosts, plain http, and LinkedIn's placeholder", () => {
    expect(personPhotoCandidates("https://evil.example/a.jpg")).toEqual([]);
    expect(personPhotoCandidates("http://media.licdn.com/a.jpg")).toEqual([]);
    expect(personPhotoCandidates("https://static.licdn.com/aero-v1/ghost-person.png")).toEqual([]);
  });
});

describe("cacheProfilePhoto", () => {
  it("saves the image bytes on this device, without cookies or a referrer", async () => {
    const fetchImpl = vi.fn(async () => jpegResponse());
    expect(await cacheProfilePhoto(PROFILE, PHOTO, { logo: false, now: NOW, fetchImpl })).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const saved = await getProfilePhoto(PROFILE);
    expect(saved?.mime).toBe("image/jpeg");
    expect(saved?.bytes.byteLength).toBe(64);
    expect(saved?.savedAt).toBe(NOW);
    expect(await profilesWithPhotos()).toEqual(new Set([PROFILE]));
  });

  it("skips the request while the saved copy is fresh, and refreshes it after 30 days", async () => {
    const fetchImpl = vi.fn(async () => jpegResponse());
    await cacheProfilePhoto(PROFILE, PHOTO, { logo: false, now: NOW, fetchImpl });
    expect(await cacheProfilePhoto(PROFILE, PHOTO, { logo: false, now: NOW + 1000, fetchImpl })).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await cacheProfilePhoto(PROFILE, PHOTO, { logo: false, now: NOW + PHOTO_REFRESH_MS, fetchImpl })).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects a redirect off LinkedIn's image host and bytes that are not an image", async () => {
    const offHost = vi.fn(async () => jpegResponse("https://evil.example/x.jpg"));
    expect(await cacheProfilePhoto(PROFILE, PHOTO, { logo: false, now: NOW, fetchImpl: offHost })).toBe(false);
    const notImage = vi.fn(async () => new Response("<html>".repeat(20), { status: 200 }));
    expect(await cacheProfilePhoto(PROFILE, PHOTO, { logo: false, now: NOW, fetchImpl: notImage })).toBe(false);
    expect(await getProfilePhoto(PROFILE)).toBeUndefined();
  });

  it("makes no request for a URL off the accepted hosts", async () => {
    const fetchImpl = vi.fn(async () => jpegResponse());
    expect(await cacheProfilePhoto(PROFILE, "https://evil.example/a.jpg", { logo: false, now: NOW, fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("photos follow their person", () => {
  it("never stores a photo URL on the person row", async () => {
    await upsertPerson({ kind: "person", name: "Mira Okafor", headline: "", company: "", profileUrl: PROFILE, photoUrl: PHOTO });
    const row = await db.people.where("profileUrl").equals(PROFILE).first();
    expect(row).toBeDefined();
    expect(JSON.stringify(row)).not.toContain("licdn");
  });

  it("deletes the photo with the person, on forget, and when orphaned", async () => {
    const fetchImpl = vi.fn(async () => jpegResponse());
    await upsertPerson({ kind: "person", name: "Mira Okafor", headline: "", company: "", profileUrl: PROFILE });
    await cacheProfilePhoto(PROFILE, PHOTO, { logo: false, now: NOW, fetchImpl });
    const id = (await db.people.where("profileUrl").equals(PROFILE).first())!.id!;
    await deletePerson(id);
    expect(await getProfilePhoto(PROFILE)).toBeUndefined();

    await upsertPerson({ kind: "person", name: "Mira Okafor", headline: "", company: "", profileUrl: PROFILE });
    await cacheProfilePhoto(PROFILE, PHOTO, { logo: false, now: NOW, fetchImpl });
    await forgetSite("linkedin.com");
    expect(await getProfilePhoto(PROFILE)).toBeUndefined();

    await db.photos.put({ profileUrl: "https://www.linkedin.com/in/gone/", mime: "image/jpeg", bytes: new ArrayBuffer(8), savedAt: NOW });
    expect(await pruneOrphanPhotos()).toBe(1);
  });
});
