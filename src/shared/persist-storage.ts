import { storageLocalSet } from "./storage-local";

/** Whether Chrome agreed to keep Cortex's storage when the disk runs low. For troubleshooting. */
export const STORAGE_PERSISTED_KEY = "cortex_storage_persisted";

/**
 * Asks Chrome to make this extension's IndexedDB persistent, so it is not evicted under storage
 * pressure. A Window API: called from extension pages, not the service worker. Chrome decides
 * without asking the user. Returns null where the API is missing.
 */
export async function requestPersistentStorage(): Promise<boolean | null> {
  const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
  if (!storage?.persist) return null;
  const already = await (storage.persisted?.() ?? Promise.resolve(false)).catch(() => false);
  const granted = already || (await storage.persist().catch(() => false));
  await storageLocalSet({ [STORAGE_PERSISTED_KEY]: granted }).catch(() => undefined);
  return granted;
}
