/**
 * Uploads the day docs to Cortex Memory/Pages. One Drive write per changed day: the whole
 * day's HTML replaces the Doc's content. Days whose HTML is unchanged are not sent.
 */
import { assistantSyncDb, readSyncEngineState, writeSyncEngineState, type PagesDeletedNotice, type SyncPagesDocRecord } from "./db";
import { FOLDER_MIME, googleErrorDetail, googleStatus, type DriveApi, type GoogleErrorDetail } from "./drive-api";
import { DAY_DOC_MAX_CHARS, dayChars, dayDocHtml, htmlSignature, PAGES_FOLDER_NAME, trimDay, type DayDoc } from "./pages-doc";

/** Day docs sent in one pass. Today goes first; older days follow on later passes. */
export const MAX_DOC_UPLOADS_PER_PASS = 6;

export const PAGES_ERROR_MESSAGE = "Google did not accept the last Pages doc update. Cortex will try again.";

export interface PagesSyncResult {
  /** Drive writes: uploads, folder creation, restores, and retention trashing. */
  writes: number;
  /** Drive reads: name lookups and file checks. */
  reads: number;
  uploaded: string[];
  more: boolean;
  error?: string;
  errorDetail?: GoogleErrorDetail;
}

const q = (value: string) => `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const encoder = new TextEncoder();

/** A day ready to send: trimmed to the cap, as HTML, with its hash. */
export function preparedDay(day: DayDoc, maxChars = DAY_DOC_MAX_CHARS): { html: string; sig: string; chars: number; bytes: number; sections: number } {
  const { day: trimmed } = trimDay(day, maxChars);
  const html = dayDocHtml(trimmed);
  return { html, sig: htmlSignature(html), chars: dayChars(trimmed), bytes: encoder.encode(html).length, sections: trimmed.sections.length };
}

/** Days the user removed from Drive, and every day once the user removed the Pages folder. */
export async function userRemovedDays(): Promise<{ all: boolean; dates: Set<string> }> {
  const state = await readSyncEngineState();
  const records = await assistantSyncDb.pagesDocs.toArray();
  return { all: state.pagesFolderTrashed, dates: new Set(records.filter((row) => row.userDeleted).map((row) => row.date)) };
}

async function noteRemoved(kind: PagesDeletedNotice["kind"], date?: string): Promise<void> {
  const state = await readSyncEngineState();
  const previous = state.pagesNotice;
  const dates = kind === "folder" ? [] : [...new Set([...(previous?.kind === "day" ? previous.dates : []), ...(date ? [date] : [])])].sort();
  await writeSyncEngineState({
    ...state,
    ...(kind === "folder" ? { pagesFolderTrashed: true } : {}),
    pagesNotice: previous?.kind === "folder" ? previous : { kind, dates },
  });
}

class PagesFolderRemoved extends Error {}

/**
 * The Pages folder. A stored folder the user trashed or deleted is never restored or replaced:
 * uploads stop until the user presses Undo.
 */
async function pagesFolder(api: DriveApi, memoryFolderId: string, counts: { reads: number; writes: number }): Promise<string> {
  const state = await readSyncEngineState();
  if (state.pagesFolderId) {
    counts.reads += 1;
    const info = await api.getFile(state.pagesFolderId);
    if (info && !info.trashed) return state.pagesFolderId;
    await noteRemoved("folder");
    throw new PagesFolderRemoved();
  }
  counts.reads += 1;
  const found = await api.listFiles(
    `${q(memoryFolderId)} in parents and name = ${q(PAGES_FOLDER_NAME)} and mimeType = ${q(FOLDER_MIME)} and trashed = false`,
    "createdTime"
  );
  let id = found[0]?.id;
  if (!id) {
    counts.writes += 1;
    id = await api.createFolder(PAGES_FOLDER_NAME, memoryFolderId);
  }
  await writeSyncEngineState({ ...(await readSyncEngineState()), pagesFolderId: id });
  return id;
}

/**
 * Sends every changed day (newest first, up to the per pass limit) and trashes day docs
 * older than `cutoff`. A stored doc is reused; a lost record is found again by name before a
 * new doc is made, so a day never gets two docs. A day doc the user trashed or deleted is
 * left alone and that day is not uploaded again; Settings offers Undo.
 */
export async function syncPagesDocs(input: {
  api: DriveApi;
  memoryFolderId: string;
  days: Map<string, DayDoc>;
  /** Day docs dated before this leave Drive. */
  cutoff: string;
  now: number;
  maxUploads?: number;
  /** Characters per day doc: 500,000 with Standard sheet detail, 150,000 with Compact. */
  maxChars?: number;
}): Promise<PagesSyncResult> {
  const counts = { reads: 0, writes: 0 };
  const uploaded: string[] = [];
  if ((await readSyncEngineState()).pagesFolderTrashed) return { ...counts, uploaded, more: false };
  const records = new Map((await assistantSyncDb.pagesDocs.toArray()).map((row) => [row.date, row]));
  try {
    for (const record of records.values()) {
      if (record.date >= input.cutoff) continue;
      if (!record.userDeleted && record.fileId) {
        counts.writes += 1;
        await input.api.trashFile(record.fileId).catch((error: unknown) => {
          if (googleStatus(error) !== 404) throw error;
        });
      }
      await assistantSyncDb.pagesDocs.delete(record.date);
      records.delete(record.date);
    }

    const changed = [...input.days.values()]
      .filter((day) => day.date >= input.cutoff && day.sections.length && !records.get(day.date)?.userDeleted)
      .map((day) => ({ day, ...preparedDay(day, input.maxChars) }))
      .filter((day) => records.get(day.day.date)?.sig !== day.sig)
      .sort((a, b) => b.day.date.localeCompare(a.day.date));
    const limit = input.maxUploads ?? MAX_DOC_UPLOADS_PER_PASS;
    let folder: string | null = null;
    for (const item of changed.slice(0, limit)) {
      const { day, html } = item;
      const record = records.get(day.date);
      let fileId = record?.fileId ?? null;
      if (fileId) {
        // Checked before writing, so page text never goes into a doc the user threw away.
        counts.reads += 1;
        const info = await input.api.getFile(fileId);
        if (!info || info.trashed) {
          if (info?.trashed) folder ??= await pagesFolder(input.api, input.memoryFolderId, counts);
          const removed: SyncPagesDocRecord = { ...record!, fileId: info ? fileId : "", userDeleted: true };
          await assistantSyncDb.pagesDocs.put(removed);
          records.set(day.date, removed);
          await noteRemoved("day", day.date);
          continue;
        }
        counts.writes += 1;
        await input.api.updateDoc(fileId, html);
      } else {
        folder ??= await pagesFolder(input.api, input.memoryFolderId, counts);
        counts.reads += 1;
        const existing = await input.api.listFiles(`${q(folder)} in parents and name = ${q(day.name)} and trashed = false`, "createdTime");
        counts.writes += 1;
        if (existing[0]) {
          fileId = existing[0].id;
          await input.api.updateDoc(fileId, html);
        } else {
          fileId = await input.api.createDoc(day.name, folder, html);
        }
      }
      const next: SyncPagesDocRecord = {
        date: day.date,
        fileId,
        sig: item.sig,
        chars: item.chars,
        bytes: item.bytes,
        sections: item.sections,
        uploadedAt: input.now,
      };
      await assistantSyncDb.pagesDocs.put(next);
      records.set(day.date, next);
      uploaded.push(day.date);
    }
    const state = await readSyncEngineState();
    if (state.pagesError) await writeSyncEngineState({ ...state, pagesError: "" });
    return { ...counts, uploaded, more: changed.length > limit };
  } catch (error) {
    if (error instanceof PagesFolderRemoved) return { ...counts, uploaded, more: false };
    const detail = googleErrorDetail(error);
    const said = detail?.message.trim();
    const message = said ? `${PAGES_ERROR_MESSAGE} Google said: ${said}` : PAGES_ERROR_MESSAGE;
    await writeSyncEngineState({ ...(await readSyncEngineState()), pagesError: message });
    return { ...counts, uploaded, more: true, error: message, ...(detail ? { errorDetail: detail } : {}) };
  }
}

/**
 * Undo in Settings: brings back what the user trashed (the Pages folder or day docs) and lets
 * those days upload again. A doc deleted for good is made again from the text on this device.
 */
export async function undoPagesRemoval(api: DriveApi): Promise<{ restored: number }> {
  const state = await readSyncEngineState();
  let restored = 0;
  let folderId = state.pagesFolderId;
  if (state.pagesFolderTrashed && folderId) {
    const info = await api.getFile(folderId);
    if (info?.trashed) {
      await api.untrashFile(folderId);
      restored += 1;
    } else if (!info) {
      folderId = "";
    }
  }
  for (const record of await assistantSyncDb.pagesDocs.toArray()) {
    if (!record.userDeleted) continue;
    const info = record.fileId ? await api.getFile(record.fileId) : null;
    if (info?.trashed) {
      await api.untrashFile(record.fileId);
      restored += 1;
    }
    if (info) await assistantSyncDb.pagesDocs.put({ ...record, userDeleted: false, sig: "" });
    else await assistantSyncDb.pagesDocs.delete(record.date);
  }
  await writeSyncEngineState({ ...(await readSyncEngineState()), pagesFolderId: folderId, pagesFolderTrashed: false, pagesNotice: null });
  return { restored };
}

/** OK in Settings: the notice goes away and the removed days stay removed. */
export async function dismissPagesNotice(): Promise<void> {
  await writeSyncEngineState({ ...(await readSyncEngineState()), pagesNotice: null });
}
