import { clampRetentionDays, readSyncEngineState, writeSyncEngineState } from "./db";
import { ASSISTANT_SYNC_RETENTION_KEY } from "./preference-keys";

export { ASSISTANT_SYNC_RETENTION_KEY };

/** Copies the options-page choices into the sync database before a pass runs. */
export async function applyAssistantSyncPreferences(stored: { retentionDays?: unknown }): Promise<void> {
  const state = await readSyncEngineState();
  if (typeof stored.retentionDays === "number") state.retentionDays = clampRetentionDays(stored.retentionDays);
  await writeSyncEngineState(state);
}
