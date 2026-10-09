/** Turns on Assistant Sync from an Enable click in the panel frame or the setup side panel. */

export interface EnableResult {
  message: string;
  /** Cortex has a question about an earlier Cortex Memory folder, answered in Settings. */
  needsSettings: boolean;
}

/** Interactive sign-in. Call only from the Enable click. */
function driveTokenFromClick(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (value) => {
      const err = chrome.runtime.lastError;
      if (err?.message || !value) reject(new Error(err?.message || "Sign in to Google is needed before Cortex can sync."));
      else resolve(value);
    });
  });
}

export async function enableFromClick(): Promise<EnableResult> {
  try {
    const token = await driveTokenFromClick();
    const res = (await chrome.runtime.sendMessage({ type: "CORTEX_ASSISTANT_SYNC", action: "enable", token })) as
      | { ok?: boolean; error?: string; status?: string }
      | undefined;
    if (res?.status === "confirm") {
      return { message: "Cortex has a question about an earlier Cortex Memory folder. Answer it in Settings.", needsSettings: true };
    }
    if (!res?.ok) return { message: res?.error || "Sync did not start.", needsSettings: false };
    return { message: "Sync is on.", needsSettings: false };
  } catch (error: unknown) {
    return { message: error instanceof Error ? error.message : "Sign in to Google is needed before Cortex can sync.", needsSettings: false };
  }
}
