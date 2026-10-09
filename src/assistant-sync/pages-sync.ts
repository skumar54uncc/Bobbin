/**
 * Uploads the day docs to Cortex Memory/Pages. One Drive write per changed day: the whole
 * day's HTML replaces the Doc's content. Days whose HTML is unchanged are not sent.
 */
import { assistantSyncDb, readSyncEngineState, writeSyncEngineState, type SyncPagesDocRecord } from "./db";
import { FOLDER_MIME, googleErrorDetail, googleStatus, type DriveApi, type GoogleErrorDetail } from "./drive-api";
import { dayChars, dayDocHtml, htmlSignature, PAGES_FOLDER_NAME, trimDay, type DayDoc } from "./pages-doc";

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
export function preparedDay(day: DayDoc): { html: string; sig: string; chars: number; bytes: number; sections: number } {
  const { day: trimmed } = trimDay(day);
  const html = dayDocHtml(trimmed);
  return { html, sig: htmlSignature(html), chars: dayChars(trimmed), bytes: encoder.encode(html).length, sections: trimmed.sections.length };
}

async function pagesFolder(api: DriveApi, memoryFolderId: string, counts: { reads: number; writes: number }): Promise<string> {
  const state = await readSyncEngineState();
  if (state.pagesFolderId) {
    counts.reads += 1;
    const info = await api.getFile(state.pagesFolderId);
    if (info && !info.trashed) return state.pagesFolderId;
    if (info?.trashed) {
      counts.writes += 1;
      await api.untrashFile(state.pagesFolderId);
      return state.pagesFolderId;
    }
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
 * older than `cutoff`. A stored doc is reused; a lost id is found again by name before a new
 * doc is made, so a day never gets two docs. A doc found in the trash is restored.
 */
export async function syncPagesDocs(input: {
  api: DriveApi;
  memoryFolderId: string;
  days: Map<string, DayDoc>;
  /** Day docs dated before this leave Drive. */
  cutoff: string;
  now: number;
  maxUploads?: number;
}): Promise<PagesSyncResult> {
  const counts = { reads: 0, writes: 0 };
  const uploaded: string[] = [];
  const records = new Map((await assistantSyncDb.pagesDocs.toArray()).map((row) => [row.date, row]));
  try {
    for (const record of records.values()) {
      if (record.date >= input.cutoff) continue;
      counts.writes += 1;
      await input.api.trashFile(record.fileId).catch((error: unknown) => {
        if (googleStatus(error) !== 404) throw error;
      });
      await assistantSyncDb.pagesDocs.delete(record.date);
      records.delete(record.date);
    }

    const changed = [...input.days.values()]
      .filter((day) => day.date >= input.cutoff && day.sections.length)
      .map((day) => ({ day, ...preparedDay(day) }))
      .filter((day) => records.get(day.day.date)?.sig !== day.sig)
      .sort((a, b) => b.day.date.localeCompare(a.day.date));
    const limit = input.maxUploads ?? MAX_DOC_UPLOADS_PER_PASS;
    let folder: string | null = null;
    for (const item of changed.slice(0, limit)) {
      const { day, html } = item;
      let fileId = records.get(day.date)?.fileId ?? null;
      if (fileId) {
        counts.writes += 1;
        const out = await input.api.updateDoc(fileId, html);
        if (!out) fileId = null;
        else if (out.trashed) {
          folder ??= await pagesFolder(input.api, input.memoryFolderId, counts);
          counts.reads += 1;
          if ((await input.api.getFile(fileId))?.trashed) {
            counts.writes += 1;
            await input.api.untrashFile(fileId);
          }
        }
      }
      if (!fileId) {
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
      const record: SyncPagesDocRecord = {
        date: day.date,
        fileId,
        sig: item.sig,
        chars: item.chars,
        bytes: item.bytes,
        sections: item.sections,
        uploadedAt: input.now,
      };
      await assistantSyncDb.pagesDocs.put(record);
      records.set(day.date, record);
      uploaded.push(day.date);
    }
    const state = await readSyncEngineState();
    if (state.pagesError) await writeSyncEngineState({ ...state, pagesError: "" });
    return { ...counts, uploaded, more: changed.length > limit };
  } catch (error) {
    const detail = googleErrorDetail(error);
    const said = detail?.message.trim();
    const message = said ? `${PAGES_ERROR_MESSAGE} Google said: ${said}` : PAGES_ERROR_MESSAGE;
    await writeSyncEngineState({ ...(await readSyncEngineState()), pagesError: message });
    return { ...counts, uploaded, more: true, error: message, ...(detail ? { errorDetail: detail } : {}) };
  }
}
