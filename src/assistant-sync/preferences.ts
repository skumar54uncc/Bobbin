import { clampRetentionDays, readSyncEngineState, writeSyncEngineState } from "./db";
import { ASSISTANT_SYNC_RETENTION_KEY, ASSISTANT_SYNC_SHEET_DETAIL_KEY } from "./preference-keys";
import { normalizeSheetDetail } from "./sheet-detail";

export { ASSISTANT_SYNC_RETENTION_KEY, ASSISTANT_SYNC_SHEET_DETAIL_KEY };

/** Copies the options-page choices into the sync database before a pass runs. */
export async function applyAssistantSyncPreferences(stored: { retentionDays?: unknown; sheetDetail?: unknown }): Promise<void> {
  const state = await readSyncEngineState();
  if (typeof stored.retentionDays === "number") state.retentionDays = clampRetentionDays(stored.retentionDays);
  if (stored.sheetDetail !== undefined) state.sheetDetail = normalizeSheetDetail(stored.sheetDetail);
  await writeSyncEngineState(state);
}
