/** chrome.storage.local — fast reads from SW + popup + content (UI flags only).
 *
 * S-2: geminiApiKey is NEVER stored in cortex_user_settings. The real key lives
 * in src/shared/gemini-api-key.ts (session TRUSTED_CONTEXTS + dedicated local
 * persist). getUserSettings always returns geminiApiKey: "" so content/overlay
 * never hold the secret. Trusted callers use getGeminiApiKey() /
 * getEffectiveChatSettings().
 */

import type { ChatSettings } from "../lib/chat/types";
import {
  normalizeCloudProvider,
  safeCloudBaseUrl,
  sanitizeCloudModel,
  type CloudProviderId,
} from "../lib/chat/cloud-provider";
import { storageLocalGet, storageLocalSet } from "./storage-local";
import { normalizeThemeSetting, type ThemeSetting } from "./theme";
import { normalizePanelPreference, type PanelPreference } from "../lib/panel-mode";

export type ChatMode = ChatSettings["mode"];

export interface CortexUserSettings {
  indexingPaused: boolean;
  /** Lowercase domain fragments e.g. banking.example.com */
  blocklist: string[];
  /** When true, only index hosts listed in allowlist (advanced) */
  allowlistOnly: boolean;
  allowlist: string[];
  chatMode: ChatMode;
  cloudChatEnabled: boolean;
  /** Which cloud model family the API key belongs to. */
  cloudProvider: CloudProviderId;
  /** Model id sent with the key. Empty uses the provider default. */
  cloudModel: string;
  /** Custom OpenAI-compatible endpoint. Empty unless the provider is custom. */
  cloudBaseUrl: string;
  /**
   * Always empty in getUserSettings / local blob (S-2). Populated only when
   * trusted code merges getGeminiApiKey() (e.g. getEffectiveSettings).
   */
  geminiApiKey: string;
  /** Overlay and side panel theme (Phase 2.6). */
  theme: ThemeSetting;
  /**
   * Where Cortex opens: on the page, or in Chrome's side panel. "auto" uses
   * the side panel on apps that take the keyboard back (claude.ai and other
   * editors), where typing in an in-page panel does not work.
   */
  panelPreference: PanelPreference;
  /** Delete pages, chunks and visits older than N days; 0 = keep forever (Phase 4.2). */
  retentionDays: number;
  /** On-device image descriptions via the Prompt API (Phase 5.8); off by default. */
  imageDescriptionsEnabled: boolean;
  /** Release 1.2.0 feature toggles (Phase 5). */
  peopleMemoryEnabled: boolean;
  /** Save and show the photo a profile showed. Device only. Off stops saving and hides saved photos. */
  profilePhotosEnabled: boolean;
  omniboxEnabled: boolean;
  highlightsEnabled: boolean;
  /** "Seen this before" chip; opt-in. */
  resurfacingEnabled: boolean;
  youtubeTranscriptsEnabled: boolean;
  tablesEnabled: boolean;
  imagesEnabled: boolean;
  pdfEnabled: boolean;
  /** Open the panel by tapping Shift twice. */
  doubleShiftShortcutEnabled: boolean;
}

export type FeatureToggle =
  | "peopleMemoryEnabled"
  | "profilePhotosEnabled"
  | "omniboxEnabled"
  | "highlightsEnabled"
  | "resurfacingEnabled"
  | "youtubeTranscriptsEnabled"
  | "tablesEnabled"
  | "imagesEnabled"
  | "imageDescriptionsEnabled"
  | "pdfEnabled"
  | "doubleShiftShortcutEnabled";

const KEY = "cortex_user_settings";

export const DEFAULT_USER_SETTINGS: CortexUserSettings = {
  indexingPaused: false,
  blocklist: [],
  allowlistOnly: false,
  allowlist: [],
  chatMode: "auto",
  cloudChatEnabled: false,
  cloudProvider: "gemini",
  cloudModel: "",
  cloudBaseUrl: "",
  geminiApiKey: "",
  theme: "light",
  panelPreference: "auto",
  retentionDays: 0,
  imageDescriptionsEnabled: false,
  peopleMemoryEnabled: true,
  profilePhotosEnabled: true,
  omniboxEnabled: true,
  highlightsEnabled: true,
  resurfacingEnabled: false,
  youtubeTranscriptsEnabled: true,
  tablesEnabled: true,
  imagesEnabled: true,
  pdfEnabled: true,
  doubleShiftShortcutEnabled: true,
};

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((item): item is string => typeof item === "string");
}

let memorySettings: CortexUserSettings | null = null;

function normalizeSettings(
  raw: Partial<CortexUserSettings> | undefined
): CortexUserSettings {
  // Whitelist only known fields — never spread raw (blocks __proto__ / unknown keys).
  // S-2: never surface geminiApiKey from the local settings blob.
  return {
    indexingPaused: bool(raw?.indexingPaused, DEFAULT_USER_SETTINGS.indexingPaused),
    blocklist: stringList(raw?.blocklist),
    allowlistOnly: bool(raw?.allowlistOnly, DEFAULT_USER_SETTINGS.allowlistOnly),
    allowlist: stringList(raw?.allowlist),
    chatMode:
      raw?.chatMode === "on-device-only" ||
      raw?.chatMode === "cloud-only" ||
      raw?.chatMode === "auto"
        ? raw.chatMode
        : DEFAULT_USER_SETTINGS.chatMode,
    cloudChatEnabled: Boolean(raw?.cloudChatEnabled),
    cloudProvider: normalizeCloudProvider(raw?.cloudProvider),
    cloudModel: sanitizeCloudModel(raw?.cloudModel, ""),
    cloudBaseUrl:
      normalizeCloudProvider(raw?.cloudProvider) === "custom"
        ? safeCloudBaseUrl(raw?.cloudBaseUrl) ?? ""
        : "",
    geminiApiKey: "",
    theme: normalizeThemeSetting(raw?.theme),
    panelPreference: normalizePanelPreference(raw?.panelPreference),
    retentionDays:
      typeof raw?.retentionDays === "number" &&
      Number.isFinite(raw.retentionDays) &&
      raw.retentionDays >= 1
        ? Math.floor(raw.retentionDays)
        : 0,
    imageDescriptionsEnabled: raw?.imageDescriptionsEnabled === true,
    peopleMemoryEnabled: bool(raw?.peopleMemoryEnabled, DEFAULT_USER_SETTINGS.peopleMemoryEnabled),
    profilePhotosEnabled: bool(raw?.profilePhotosEnabled, DEFAULT_USER_SETTINGS.profilePhotosEnabled),
    omniboxEnabled: bool(raw?.omniboxEnabled, DEFAULT_USER_SETTINGS.omniboxEnabled),
    highlightsEnabled: bool(raw?.highlightsEnabled, DEFAULT_USER_SETTINGS.highlightsEnabled),
    resurfacingEnabled: raw?.resurfacingEnabled === true,
    youtubeTranscriptsEnabled: bool(raw?.youtubeTranscriptsEnabled, DEFAULT_USER_SETTINGS.youtubeTranscriptsEnabled),
    tablesEnabled: bool(raw?.tablesEnabled, DEFAULT_USER_SETTINGS.tablesEnabled),
    imagesEnabled: bool(raw?.imagesEnabled, DEFAULT_USER_SETTINGS.imagesEnabled),
    pdfEnabled: bool(raw?.pdfEnabled, DEFAULT_USER_SETTINGS.pdfEnabled),
    doubleShiftShortcutEnabled: bool(
      raw?.doubleShiftShortcutEnabled,
      DEFAULT_USER_SETTINGS.doubleShiftShortcutEnabled
    ),
  };
}

async function loadUserSettingsFromStorage(): Promise<CortexUserSettings> {
  const r = await storageLocalGet([KEY]);
  return normalizeSettings(r[KEY] as Partial<CortexUserSettings> | undefined);
}

try {
  const c = (globalThis as { chrome?: typeof chrome }).chrome;
  c?.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local" || !changes[KEY]) return;
    void loadUserSettingsFromStorage().then((s) => {
      memorySettings = s;
    });
  });
} catch {
  /* ignore */
}

export async function getUserSettings(): Promise<CortexUserSettings> {
  if (memorySettings) {
    return { ...memorySettings, geminiApiKey: "" };
  }
  const loaded = await loadUserSettingsFromStorage();
  memorySettings = loaded;
  return { ...loaded, geminiApiKey: "" };
}

/** Reads storage directly (bypasses the in-memory cache) and refreshes the cache. */
export async function getUserSettingsFresh(): Promise<CortexUserSettings> {
  const s = await loadUserSettingsFromStorage();
  memorySettings = s;
  return { ...s, geminiApiKey: "" };
}

/**
 * Chat routing input with the real Gemini key (trusted contexts only).
 * Prefer getEffectiveChatSettings() so managed policy still applies.
 */
export async function getChatSettings(): Promise<ChatSettings> {
  const s = await loadUserSettingsFromStorage();
  memorySettings = s;
  const { getGeminiApiKey } = await import("./gemini-api-key");
  const geminiApiKey = await getGeminiApiKey();
  return {
    mode: s.chatMode,
    cloudEnabled: s.cloudChatEnabled,
    geminiApiKey,
    cloudProvider: s.cloudProvider,
    cloudModel: s.cloudModel,
    cloudBaseUrl: s.cloudBaseUrl,
  };
}

/**
 * Persists UI settings. geminiApiKey in `partial` is routed to the secret
 * store and never written into cortex_user_settings.
 */
export async function setUserSettings(
  partial: Partial<CortexUserSettings>
): Promise<void> {
  const { geminiApiKey: keyUpdate, ...safePartial } = partial;
  if (keyUpdate !== undefined) {
    const { setGeminiApiKey } = await import("./gemini-api-key");
    await setGeminiApiKey(typeof keyUpdate === "string" ? keyUpdate : "");
  }
  const cur = await getUserSettings();
  const next = normalizeSettings({ ...cur, ...safePartial, geminiApiKey: "" });
  memorySettings = next;
  await storageLocalSet({ [KEY]: next });
}

/** Test helper: drop the in-memory settings cache. */
export function resetUserSettingsMemoryForTests(): void {
  memorySettings = null;
}
