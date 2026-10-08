export type ChatMode = "auto" | "on-device-only" | "cloud-only";

export interface ChatSettings {
  mode: ChatMode;
  cloudEnabled: boolean;
  /** Secret store key. Used for every provider, not only Gemini. */
  geminiApiKey: string;
  cloudProvider?: string;
  cloudModel?: string;
  cloudBaseUrl?: string;
  /** People memory (Phase 5.1); undefined means on. */
  peopleEnabled?: boolean;
}
