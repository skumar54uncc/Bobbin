/** Cloud chat providers. The API key stays in the secret store. */

export type CloudProviderId =
  | "gemini"
  | "openai"
  | "anthropic"
  | "openrouter"
  | "groq"
  | "mistral"
  | "custom";

/** Default model ids only. Request URLs stay in the service worker. */
export const CLOUD_MODELS: Record<CloudProviderId, string> = {
  gemini: "gemini-3.8-flash",
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-4-5",
  openrouter: "openai/gpt-4o-mini",
  groq: "llama-3.3-70b-versatile",
  mistral: "mistral-small-latest",
  custom: "",
};

const IDS = Object.keys(CLOUD_MODELS) as CloudProviderId[];

/** Sent after a reply that ran out of room, so the model picks up mid sentence. */
export const CONTINUE_PROMPT = "Continue exactly where you stopped. Do not repeat anything you already wrote.";

/** Up to this many extra requests when a reply hits the output limit. */
export const MAX_CONTINUATIONS = 2;

export function normalizeCloudProvider(value: unknown): CloudProviderId {
  return typeof value === "string" && (IDS as string[]).includes(value)
    ? (value as CloudProviderId)
    : "gemini";
}

export function defaultCloudModel(id: CloudProviderId): string {
  return CLOUD_MODELS[id];
}

/** Unambiguous key prefixes only. A bare sk- key is not enough to guess. */
export function detectCloudProvider(key: string): CloudProviderId | null {
  const k = key.trim();
  if (k.startsWith("AIza")) return "gemini";
  if (k.startsWith("sk-ant-")) return "anthropic";
  if (k.startsWith("sk-or-")) return "openrouter";
  if (k.startsWith("gsk_")) return "groq";
  return null;
}

export function sanitizeCloudModel(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (/^[A-Za-z0-9._:/-]{1,80}$/.test(raw)) return raw;
  return fallback;
}

/**
 * https endpoints, or loopback http for a model running on this machine.
 * Query strings, fragments, and embedded passwords are rejected so a key
 * cannot be smuggled into the URL.
 */
export function safeCloudBaseUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  const loopback =
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
  if (url.protocol !== "https:" && !loopback) return null;
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${path}`;
}

