/** Last Ask thread and unsent draft. Survives overlay close and tab switches. */

export const ASK_RESUME_KEY = "cortex_ask_resume_v1";

export type AskResume = {
  conversationId: number | null;
  draft: string;
};

export function parseAskResume(raw: unknown): AskResume {
  if (!raw || typeof raw !== "object") return { conversationId: null, draft: "" };
  const o = raw as { conversationId?: unknown; draft?: unknown };
  const id = o.conversationId;
  return {
    conversationId: typeof id === "number" && Number.isFinite(id) ? id : null,
    draft: typeof o.draft === "string" ? o.draft.slice(0, 8_000) : "",
  };
}

/** A stored thread that ends on the user's question never got an answer. */
export function threadNeedsRetry(messages: Array<{ role?: string }>): boolean {
  const last = messages[messages.length - 1];
  return Boolean(last && last.role === "user");
}

function resumeArea(): chrome.storage.StorageArea | null {
  try {
    const storage = (globalThis as { chrome?: { storage?: { session?: chrome.storage.StorageArea; local?: chrome.storage.StorageArea } } })
      .chrome?.storage;
    return storage?.session ?? storage?.local ?? null;
  } catch {
    return null;
  }
}

export function readAskResume(): Promise<AskResume> {
  const area = resumeArea();
  if (!area) return Promise.resolve({ conversationId: null, draft: "" });
  return new Promise((resolve) => {
    area.get(ASK_RESUME_KEY, (r) => {
      resolve(parseAskResume(r?.[ASK_RESUME_KEY]));
    });
  });
}

export function writeAskResume(next: AskResume): Promise<void> {
  const area = resumeArea();
  if (!area) return Promise.resolve();
  return new Promise((resolve) => {
    area.set({ [ASK_RESUME_KEY]: next }, () => resolve());
  });
}
