/**
 * Profile photos, device only. The photo is fetched once, at capture time,
 * while the user is on that profile, then downscaled and kept in IndexedDB.
 * Cards read this copy, so viewing the library makes no request to LinkedIn.
 * No photo and no photo URL is stored on the person row, synced, or exported.
 */
import { db } from "../db/schema";

export const PHOTO_HOSTS = new Set(["media.licdn.com", "static.licdn.com", "avatars.githubusercontent.com"]);
/** Longest side kept. Cards are 280px wide, so this stays sharp on a 2x screen. */
export const PHOTO_MAX_PX = 560;
/** A saved photo is refreshed on a later visit once it is this old. */
export const PHOTO_REFRESH_MS = 30 * 86_400_000;
const MAX_FETCH_BYTES = 1_500_000;
/** Kept as is when this device cannot re-encode it. */
const MAX_RAW_BYTES = 400_000;

export interface PhotoRecord {
  profileUrl: string;
  mime: string;
  bytes: ArrayBuffer;
  savedAt: number;
}

/** The URL unchanged when it is an https photo on an accepted image host, else null. */
export function acceptedPhotoUrl(raw: string | undefined): string | null {
  try {
    const u = new URL(String(raw ?? "").trim());
    if (u.protocol !== "https:") return null;
    if (!PHOTO_HOSTS.has(u.hostname.toLowerCase())) return null;
    if (/ghost-person|ghost-company/i.test(u.pathname)) return null;
    return u.href;
  } catch {
    return null;
  }
}

const PHOTO_SIZE = /((?:shrink|scale|company-logo|profile-displayphoto-shrink|profile-framedphoto-shrink)_)(\d+)_(\d+)/gi;

/**
 * Larger LinkedIn renditions of a small photo, then the URL the page listed.
 * Company logos use company-logo_200_200, which a shrink-only rewrite misses.
 */
function sizedPhoto(url: string): string[] {
  const sizes = [...url.matchAll(new RegExp(PHOTO_SIZE.source, "gi"))].map((m) => Number(m[2]));
  const have = sizes.length ? Math.max(...sizes) : 800;
  const bump = (n: number): string =>
    url.replace(new RegExp(PHOTO_SIZE.source, "gi"), (_all, prefix: string) => `${prefix}${n}_${n}`);
  const larger = have >= 800 ? [] : [800, 400].filter((n) => n > have).map(bump);
  return [...larger, url];
}

/** Renditions to try at capture, sharpest first. Framed photos also try the unframed original. */
export function personPhotoCandidates(raw: string | undefined): string[] {
  const accepted = acceptedPhotoUrl(raw);
  if (!accepted) return [];
  const bases = /profile-framedphoto/i.test(accepted)
    ? [accepted.replace(/profile-framedphoto/gi, "profile-displayphoto"), accepted]
    : [accepted];
  const out: string[] = [];
  for (const base of bases) {
    for (const href of sizedPhoto(base)) if (!out.includes(href)) out.push(href);
  }
  return out.slice(0, 6);
}

function looksLikeImage(bytes: Uint8Array): boolean {
  const head = String.fromCharCode(...bytes.subarray(0, 12));
  return /^\xff\xd8\xff|^\x89PNG|^GIF8|^RIFF[\s\S]{4}WEBP/.test(head);
}

type FetchLike = (url: string) => Promise<Response>;

async function fetchImage(url: string, fetchImpl: FetchLike): Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string } | null> {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    // A redirect must stay on an accepted image host.
    if (res.url && !acceptedPhotoUrl(res.url)) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength < 32 || bytes.byteLength > MAX_FETCH_BYTES || !looksLikeImage(bytes)) return null;
    const mime = res.headers.get("content-type") ?? "";
    return { bytes, mime: mime.startsWith("image/") ? mime : "image/jpeg" };
  } catch {
    return null;
  }
}

/** Downscales to PHOTO_MAX_PX. Null when this context has no OffscreenCanvas. */
async function shrink(bytes: Uint8Array<ArrayBuffer>, mime: string, logo: boolean): Promise<{ bytes: ArrayBuffer; mime: string } | null> {
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") return null;
  try {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
    const scale = Math.min(1, PHOTO_MAX_PX / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    // Logos keep transparency.
    const type = logo ? "image/png" : "image/jpeg";
    const blob = await canvas.convertToBlob({ type, quality: 0.9 });
    return { bytes: await blob.arrayBuffer(), mime: type };
  } catch {
    return null;
  }
}

/**
 * Saves the photo the profile showed. Called from the capture path only, while
 * the user is on that page. Skips the fetch when a fresh copy is already saved.
 */
export async function cacheProfilePhoto(
  profileUrl: string,
  photoUrl: string | undefined,
  opts: { logo: boolean; now?: number; fetchImpl?: FetchLike }
): Promise<boolean> {
  const candidates = personPhotoCandidates(photoUrl);
  if (!candidates.length) return false;
  const now = opts.now ?? Date.now();
  const saved = await db.photos.get(profileUrl);
  if (saved && now - saved.savedAt < PHOTO_REFRESH_MS) return false;
  const fetchImpl = opts.fetchImpl ?? ((url: string) => fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" }));
  for (const url of candidates.slice(0, 3)) {
    const got = await fetchImage(url, fetchImpl);
    if (!got) continue;
    const small = await shrink(got.bytes, got.mime, opts.logo);
    if (!small && got.bytes.byteLength > MAX_RAW_BYTES) continue;
    const out = small ?? { bytes: got.bytes.slice().buffer, mime: got.mime };
    await db.photos.put({ profileUrl, mime: out.mime, bytes: out.bytes, savedAt: now });
    return true;
  }
  return false;
}

export function getProfilePhoto(profileUrl: string): Promise<PhotoRecord | undefined> {
  return db.photos.get(profileUrl);
}

export async function profilesWithPhotos(): Promise<Set<string>> {
  return new Set((await db.photos.toCollection().primaryKeys()).map(String));
}

/** Drops photos whose person row is gone. Run after any people delete. */
export async function pruneOrphanPhotos(): Promise<number> {
  const live = new Set((await db.people.orderBy("profileUrl").keys()).map(String));
  const orphans = (await db.photos.toCollection().primaryKeys()).map(String).filter((url) => !live.has(url));
  await db.photos.bulkDelete(orphans);
  return orphans.length;
}
