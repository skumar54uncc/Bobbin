/**
 * The last sync passes, kept in chrome.storage.local on this device for
 * troubleshooting. Counts, status, and Google's error reply: no page URLs, titles, or tokens.
 * Read it from the service worker console:
 *   chrome.storage.local.get("cortex_assist_flush_log").then(console.table)
 */
export const FLUSH_LOG_KEY = "cortex_assist_flush_log";
export const FLUSH_LOG_MAX = 50;

export interface FlushLogEntry {
  /** ISO time the pass ended. */
  at: string;
  action: "alarm" | "now" | "enable";
  status: string;
  appended: number;
  /** Sheets reads and writes. A normal flush is 0 reads and 1 write. */
  reads: number | null;
  writes: number | null;
  /** ISO time of the next planned attempt, when the engine asked for one. */
  retryAt?: string;
  error?: string;
  /** The failed Google call: search, folder create, sheet create, batchUpdate, read, and the rest. */
  error_detail?: ErrorDetail;
}

interface ErrorDetail {
  call: string;
  http_status: number;
  /** Google's error.status, for example PERMISSION_DENIED. */
  status: string;
  /** Google's error.message. */
  message: string;
}

export function flushLogEntry(
  action: FlushLogEntry["action"],
  reply: {
    ok?: boolean;
    status?: string;
    appended?: number;
    reads?: number;
    writes?: number;
    retryAt?: number;
    error?: string;
    errorDetail?: ErrorDetail;
  },
  now: number
): FlushLogEntry {
  return {
    at: new Date(now).toISOString(),
    action,
    status: reply.status ?? (reply.ok === false ? "error" : "ready"),
    appended: reply.appended ?? 0,
    reads: reply.reads ?? null,
    writes: reply.writes ?? null,
    ...(reply.retryAt ? { retryAt: new Date(reply.retryAt).toISOString() } : {}),
    ...(reply.error ? { error: reply.error.slice(0, 400) } : {}),
    ...(reply.errorDetail ? { error_detail: { ...reply.errorDetail } } : {}),
  };
}

/** Newest last, capped at FLUSH_LOG_MAX. */
export function appendFlushLog(log: unknown, entry: FlushLogEntry): FlushLogEntry[] {
  const list = Array.isArray(log) ? (log as FlushLogEntry[]) : [];
  return [...list, entry].slice(-FLUSH_LOG_MAX);
}
