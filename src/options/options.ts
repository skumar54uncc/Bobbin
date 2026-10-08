import { initBackupUi, saveBlob } from "./backup-ui";
import { normalizePanelPreference } from "../lib/panel-mode";
import {
  getUserSettings,
  setUserSettings,
  type CortexUserSettings,
  type FeatureToggle,
} from "../shared/extension-settings";
import { getEffectiveSettings } from "../shared/managed-policy";
import { applyManagedLockout, stripLockedFields } from "./managed-ui";
import type { HistoryImportProgress } from "../lib/history-import";
import { INDEXING_CONSENT_KEY } from "../shared/onboarding-constants";
import { storageLocalGet } from "../shared/storage-local";
import { injectBrandFontFacesInto } from "../styles/brand-fonts";
import { siteBadgeColors, siteInitial } from "../lib/site-badge";
import {
  CLOUD_MODELS,
  defaultCloudModel,
  detectCloudProvider,
  normalizeCloudProvider,
  safeCloudBaseUrl,
  sanitizeCloudModel,
  type CloudProviderId,
} from "../lib/chat/cloud-provider";
import { listCloudModels } from "../lib/chat/cloud-stream";

const CLOUD_HELP: Partial<Record<CloudProviderId, { label: string; href: string }>> = {
  gemini: { label: "Google Gemini", href: "https://aistudio.google.com/apikey" },
  openai: { label: "OpenAI", href: "https://platform.openai.com/api-keys" },
  anthropic: { label: "Anthropic", href: "https://console.anthropic.com/settings/keys" },
  openrouter: { label: "OpenRouter", href: "https://openrouter.ai/keys" },
  groq: { label: "Groq", href: "https://console.groq.com/keys" },
  mistral: { label: "Mistral", href: "https://console.mistral.ai/api-keys" },
};

/** Where each provider lists its model ids. */
const MODEL_DOCS: Partial<Record<CloudProviderId, string>> = {
  gemini: "https://ai.google.dev/gemini-api/docs/models",
  openai: "https://platform.openai.com/docs/models",
  anthropic: "https://docs.anthropic.com/en/docs/about-claude/models",
  openrouter: "https://openrouter.ai/models",
  groq: "https://console.groq.com/docs/models",
  mistral: "https://docs.mistral.ai/getting-started/models/",
};

/** Suggested ids, the default first. Load models from my key replaces these with the real list. */
const MODEL_CHOICES: Record<CloudProviderId, string[]> = {
  gemini: ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"],
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
  anthropic: ["claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-1"],
  openrouter: ["openai/gpt-4o-mini", "anthropic/claude-sonnet-4.5", "google/gemini-2.5-flash"],
  groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
  mistral: ["mistral-small-latest", "mistral-medium-latest", "mistral-large-latest"],
  custom: [],
};

const OTHER_MODEL = "__other";

/** Ids Cortex itself put in the field. A provider switch replaces these, never a typed id. */
function knownModelIds(): Set<string> {
  return new Set([
    ...Object.values(CLOUD_MODELS),
    ...Object.values(MODEL_CHOICES).flat(),
    ...[...loadedModels.values()].flat(),
  ]);
}

/** Ids the provider returned for the key in the form, per provider. */
const loadedModels = new Map<CloudProviderId, string[]>();

function renderModelPick(id: CloudProviderId): void {
  const pick = qs<HTMLSelectElement>("#cx-opt-cloud-model-pick");
  const input = qs<HTMLInputElement>("#cx-opt-cloud-model");
  const current = input.value.trim();
  const ids = [...(loadedModels.get(id) ?? MODEL_CHOICES[id])];
  if (current && !ids.includes(current)) ids.unshift(current);
  pick.replaceChildren();
  for (const model of ids) {
    const opt = document.createElement("option");
    opt.value = model;
    opt.textContent = model === defaultCloudModel(id) ? `${model} (suggested)` : model;
    pick.appendChild(opt);
  }
  const other = document.createElement("option");
  other.value = OTHER_MODEL;
  other.textContent = "Other model id…";
  pick.appendChild(other);
  pick.value = current && ids.includes(current) ? current : ids[0] ?? OTHER_MODEL;
  if (pick.value !== OTHER_MODEL) input.value = pick.value;
  qs<HTMLElement>("#cx-opt-cloud-model-other").hidden = pick.value !== OTHER_MODEL;
}

async function loadModelsFromKey(): Promise<void> {
  const id = normalizeCloudProvider(qs<HTMLSelectElement>("#cx-opt-cloud-provider").value);
  const btn = qs<HTMLButtonElement>("#cx-opt-cloud-models-load");
  const msg = qs<HTMLElement>("#cx-opt-cloud-models-msg");
  msg.hidden = true;
  msg.classList.remove("is-error", "is-success");
  btn.disabled = true;
  btn.classList.add("is-loading");
  try {
    const ids = await listCloudModels(
      id,
      qs<HTMLInputElement>("#cx-opt-gemini-key").value,
      qs<HTMLInputElement>("#cx-opt-cloud-base").value
    );
    if (!ids.length) throw new Error("This key has no chat models.");
    loadedModels.set(id, ids);
    const input = qs<HTMLInputElement>("#cx-opt-cloud-model");
    if (!ids.includes(input.value.trim())) {
      input.value = ids.includes(defaultCloudModel(id)) ? defaultCloudModel(id) : ids[0]!;
    }
    renderModelPick(id);
    msg.textContent = `Found ${ids.length} ${ids.length === 1 ? "model" : "models"} for this key. Pick one, then save.`;
    msg.classList.add("is-success");
  } catch (e) {
    msg.textContent = e instanceof Error && e.message ? e.message : "Could not load models. Check the key.";
    msg.classList.add("is-error");
  } finally {
    msg.hidden = false;
    btn.disabled = false;
    btn.classList.remove("is-loading");
  }
}

const HISTORY_IDLE: HistoryImportProgress = {
  running: false,
  total: 0,
  processed: 0,
  indexed: 0,
  skipped: 0,
  fetchFailed: 0,
};

type RecentRow = {
  url: string;
  title: string;
  hostname: string;
  visitedAt: number;
};

let statsAnimatedOnce = false;
let deleteOpenAt = 0;

injectBrandFontFacesInto(document.head);

function qs<T extends HTMLElement>(sel: string): T {
  const el = document.querySelector(sel);
  if (!el) throw new Error(sel);
  return el as T;
}

function fmtBytes(n?: number): string {
  if (n == null || !Number.isFinite(n)) return "-";
  const u = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

function domainsFromTextarea(ta: HTMLTextAreaElement): string[] {
  return ta.value
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day} days ago`;
  return new Date(ts).toLocaleDateString();
}

function openTab(url: string): void {
  try {
    const u = new URL(url.trim());
    if (u.protocol === "http:" || u.protocol === "https:") {
      void chrome.runtime.sendMessage({ type: "CORTEX_OPEN_TAB", url: u.href });
    }
  } catch {
    /* ignore */
  }
}

function animateStat(el: HTMLElement, target: number): void {
  el.querySelector(".cx-stat-skeleton")?.remove();
  el.classList.add("is-loaded");
  if (!Number.isFinite(target)) {
    el.textContent = "-";
    return;
  }
  const n = Math.round(target);
  if (statsAnimatedOnce) {
    el.textContent = String(n);
    return;
  }
  const t0 = performance.now();
  const step = (t: number) => {
    const p = Math.min(1, (t - t0) / 300);
    el.textContent = String(Math.round(n * (1 - (1 - p) ** 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function syncPauseToggle(checked: boolean): void {
  const toggle = qs<HTMLButtonElement>("#cx-opt-pause-toggle");
  const input = qs<HTMLInputElement>("#cx-opt-pause");
  input.checked = checked;
  toggle.setAttribute("aria-checked", String(checked));
}

function renderBlocklistChips(): void {
  const ta = qs<HTMLTextAreaElement>("#cx-opt-blocklist");
  const row = qs<HTMLElement>("#cx-opt-blocklist-chips");
  row.replaceChildren();
  const domains = domainsFromTextarea(ta);
  for (const d of domains) {
    const chip = document.createElement("span");
    chip.className = "cx-chip";
    chip.append(document.createTextNode(d));
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "cx-chip-remove";
    rm.setAttribute("aria-label", `Remove ${d}`);
    rm.textContent = "×";
    rm.addEventListener("click", () => {
      const next = domainsFromTextarea(ta).filter((x) => x !== d);
      ta.value = next.join("\n");
      renderBlocklistChips();
    });
    chip.appendChild(rm);
    row.appendChild(chip);
  }
}

function renderRecentList(recent: RecentRow[]): void {
  const ul = qs<HTMLUListElement>("#cx-opt-recent");
  const empty = qs<HTMLElement>("#cx-opt-recent-empty");
  const badge = qs<HTMLElement>("#cx-recent-count");
  ul.replaceChildren();

  const map = new Map<
    string,
    { url: string; title: string; host: string; at: number; n: number }
  >();
  for (const row of recent) {
    const e = map.get(row.url);
    if (!e) {
      map.set(row.url, {
        url: row.url,
        title: row.title,
        host: row.hostname,
        at: row.visitedAt,
        n: 1,
      });
    } else {
      e.n++;
      if (row.visitedAt > e.at) {
        e.at = row.visitedAt;
        e.title = row.title || e.title;
        e.host = row.hostname || e.host;
      }
    }
  }
  const deduped = [...map.values()].sort((a, b) => b.at - a.at).slice(0, 20);
  badge.textContent = `(${deduped.length})`;
  empty.hidden = deduped.length > 0;

  for (const r of deduped) {
    const li = document.createElement("li");
    li.className = "cx-recent-item";
    li.tabIndex = 0;
    // Drawn here, never fetched: a favicon service would be told every
    // domain in this list (core value 1).
    const colors = siteBadgeColors(r.host);
    const fav = document.createElement("span");
    fav.className = "cx-recent-favicon cx-recent-fallback";
    fav.setAttribute("aria-hidden", "true");
    fav.style.background = colors.background;
    fav.style.color = colors.text;
    fav.textContent = siteInitial(r.host);

    const main = document.createElement("div");
    main.className = "cx-recent-main";
    const title = document.createElement("span");
    title.className = "cx-recent-title";
    title.textContent = r.title || r.host || r.url;
    const host = document.createElement("span");
    host.className = "cx-recent-host";
    host.textContent = r.host;
    main.append(title, host);

    const meta = document.createElement("div");
    meta.className = "cx-recent-meta";
    if (r.n > 1) {
      const pill = document.createElement("span");
      pill.className = "cx-recent-count-pill";
      pill.textContent = `${r.n} visits`;
      meta.appendChild(pill);
    }
    const when = document.createElement("span");
    when.textContent = relativeTime(r.at);
    meta.appendChild(when);
    const go = () => openTab(r.url);
    li.addEventListener("click", go);
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        go();
      }
    });

    li.append(fav, main, meta);
    ul.appendChild(li);
  }
}

async function refreshStats(): Promise<void> {
  const errEl = qs<HTMLElement>("#cx-opt-stats-error");
  errEl.hidden = true;

  const pagesEl = qs<HTMLElement>("#cx-opt-pages");
  const chunksEl = qs<HTMLElement>("#cx-opt-chunks");
  const visitsEl = qs<HTMLElement>("#cx-opt-visits");

  try {
    const res = (await chrome.runtime.sendMessage({
      type: "CORTEX_STATS",
    })) as {
      ok?: boolean;
      pageCount?: number;
      chunkCount?: number;
      visitCount?: number;
      storageBytes?: number;
      storageQuotaBytes?: number;
      recent?: RecentRow[];
    };

    if (!res?.ok) throw new Error("unavailable");

    animateStat(
      pagesEl,
      typeof res.pageCount === "number" ? res.pageCount : NaN
    );
    animateStat(
      chunksEl,
      typeof res.chunkCount === "number" ? res.chunkCount : NaN
    );
    animateStat(
      visitsEl,
      typeof res.visitCount === "number" ? res.visitCount : NaN
    );

    const used = fmtBytes(res.storageBytes);
    const cap = fmtBytes(res.storageQuotaBytes);
    qs("#cx-opt-storage-line").textContent =
      cap !== "-"
        ? `Approximate storage (browser quota): ${used} of ${cap}`
        : `Approximate storage in use: ${used}`;

    renderRecentList(res.recent ?? []);
    statsAnimatedOnce = true;
  } catch {
    pagesEl.textContent = "-";
    chunksEl.textContent = "-";
    visitsEl.textContent = "-";
    pagesEl.classList.add("is-loaded");
    chunksEl.classList.add("is-loaded");
    visitsEl.classList.add("is-loaded");
    qs("#cx-opt-storage-line").textContent = "Storage: unavailable";
    errEl.hidden = false;
    renderRecentList([]);
  }
}

async function fetchHistoryProgress(): Promise<HistoryImportProgress> {
  try {
    const res = (await chrome.runtime.sendMessage({
      type: "CORTEX_HISTORY_IMPORT_STATUS",
    })) as { ok?: boolean; progress?: HistoryImportProgress };
    if (res?.ok && res.progress) {
      return { ...HISTORY_IDLE, ...res.progress };
    }
  } catch {
    /* ignore */
  }
  return { ...HISTORY_IDLE };
}

let historyPollId: number | undefined;

function stopHistoryPolling(): void {
  if (historyPollId != null) {
    window.clearInterval(historyPollId);
    historyPollId = undefined;
  }
}

function readChatModeFromForm():
  | "auto"
  | "on-device-only"
  | "cloud-only" {
  const modeRadio = document.querySelector<HTMLInputElement>(
    'input[name="cx-chat-mode"]:checked'
  );
  return modeRadio?.value === "on-device-only" ||
    modeRadio?.value === "cloud-only"
    ? modeRadio.value
    : "auto";
}

function syncCloudProviderFields(): void {
  const id = normalizeCloudProvider(qs<HTMLSelectElement>("#cx-opt-cloud-provider").value);
  const helpInfo = CLOUD_HELP[id];
  qs<HTMLElement>("#cx-opt-cloud-base-wrap").hidden = id !== "custom";
  const help = qs<HTMLAnchorElement>("#cx-opt-cloud-help");
  if (helpInfo) {
    help.hidden = false;
    help.href = helpInfo.href;
    help.textContent = `Get an API key for ${helpInfo.label}`;
  } else {
    help.hidden = true;
  }
  const model = qs<HTMLInputElement>("#cx-opt-cloud-model");
  model.placeholder = defaultCloudModel(id) || "model id";
  const docs = qs<HTMLAnchorElement>("#cx-opt-cloud-models-help");
  const docsHref = MODEL_DOCS[id];
  docs.hidden = !docsHref;
  if (docsHref && helpInfo) {
    docs.href = docsHref;
    docs.textContent = `See model names for ${helpInfo.label}`;
  }
  qs<HTMLElement>("#cx-opt-cloud-models-msg").hidden = true;
  renderModelPick(id);
}

function readCloudFields():
  | {
      cloudChatEnabled: boolean;
      geminiApiKey: string;
      cloudProvider: CloudProviderId;
      cloudModel: string;
      cloudBaseUrl: string;
    }
  | string {
  const cloudProvider = normalizeCloudProvider(qs<HTMLSelectElement>("#cx-opt-cloud-provider").value);
  const cloudModel = sanitizeCloudModel(
    qs<HTMLInputElement>("#cx-opt-cloud-model").value,
    defaultCloudModel(cloudProvider)
  );
  if (cloudProvider !== "gemini" && cloudProvider !== "custom" && !cloudModel) {
    return "Enter the model id this key should call.";
  }
  let cloudBaseUrl = "";
  if (cloudProvider === "custom") {
    const safe = safeCloudBaseUrl(qs<HTMLInputElement>("#cx-opt-cloud-base").value);
    if (!safe) return "Use an https endpoint, or http://127.0.0.1 for a local model.";
    if (!cloudModel) return "Enter the model id this endpoint should call.";
    cloudBaseUrl = safe;
  }
  return {
    cloudChatEnabled: (qs("#cx-opt-cloud-chat") as HTMLInputElement).checked,
    geminiApiKey: (qs("#cx-opt-gemini-key") as HTMLInputElement).value.trim(),
    cloudProvider,
    cloudModel,
    cloudBaseUrl,
  };
}

function showChatSaveError(message: string): void {
  const feedback = qs<HTMLElement>("#cx-opt-chat-save-msg");
  feedback.textContent = message;
  feedback.classList.add("is-error");
  feedback.hidden = false;
}

async function runSave(
  btnId: string,
  msgId: string,
  idle: string,
  saveFn: () => Promise<void>
): Promise<void> {
  const btn = qs<HTMLButtonElement>(btnId);
  const feedback = qs<HTMLElement>(msgId);
  const label = btn.querySelector(".cx-btn-label");
  feedback.hidden = true;
  feedback.classList.remove("is-error", "is-success");
  btn.classList.remove("shake", "is-success");
  btn.classList.add("is-loading");
  btn.disabled = true;
  if (label) label.textContent = "Saving…";
  try {
    await saveFn();
    btn.classList.remove("is-loading");
    btn.classList.add("is-success");
    if (label) label.textContent = "Saved";
    feedback.textContent = "Saved";
    feedback.classList.add("is-success");
    feedback.hidden = false;
    window.setTimeout(() => {
      btn.classList.remove("is-success");
      btn.disabled = false;
      if (label) label.textContent = idle;
      feedback.hidden = true;
    }, 2000);
  } catch (err) {
    btn.classList.remove("is-loading");
    btn.classList.add("shake");
    btn.disabled = false;
    if (label) label.textContent = idle;
    feedback.textContent = err instanceof Error && err.message ? err.message : "Could not save. Try again.";
    feedback.classList.add("is-error");
    feedback.hidden = false;
  }
}

function applyHistoryUi(p: HistoryImportProgress): void {
  const status = qs<HTMLElement>("#cx-opt-history-status");
  const startBtn = qs<HTMLButtonElement>("#cx-opt-history-start");
  const cancelBtn = qs<HTMLButtonElement>("#cx-opt-history-cancel");
  const daysSel = qs<HTMLSelectElement>("#cx-opt-history-days");
  const capSel = qs<HTMLSelectElement>("#cx-opt-history-cap");

  status.classList.remove("is-running");

  if (p.running) {
    startBtn.disabled = true;
    cancelBtn.hidden = false;
    daysSel.disabled = true;
    capSel.disabled = true;
    status.classList.add("is-running");
    status.textContent = "Scanning…";
    qs<HTMLElement>("#cx-history-result-card").hidden = true;
  } else {
    startBtn.disabled = false;
    cancelBtn.hidden = true;
    daysSel.disabled = false;
    capSel.disabled = false;
    if (p.error) {
      status.textContent = `Stopped with error: ${p.error}`;
    } else if (p.finishedAt && p.processed > 0) {
      status.textContent = "";
      qs<HTMLElement>("#cx-history-result-card").hidden = false;
      qs("#cx-h-attempted").textContent = String(p.processed);
      qs("#cx-h-indexed").textContent = String(p.indexed);
      qs("#cx-h-skipped").textContent = String(p.skipped);
      qs("#cx-h-failed").textContent = String(p.fetchFailed);
    } else {
      status.textContent = "";
      qs<HTMLElement>("#cx-history-result-card").hidden = true;
    }
  }
}

async function tickHistoryPoll(): Promise<void> {
  const p = await fetchHistoryProgress();
  applyHistoryUi(p);
  if (!p.running) {
    stopHistoryPolling();
    await refreshStats();
  }
}

function startHistoryPolling(): void {
  stopHistoryPolling();
  void tickHistoryPoll();
  historyPollId = window.setInterval(() => void tickHistoryPoll(), 750);
}

/** Saves only the fields the user may change under the current policy. */
async function saveUserSettings(partial: Partial<CortexUserSettings>): Promise<void> {
  const [user, eff] = await Promise.all([getUserSettings(), getEffectiveSettings()]);
  await setUserSettings(stripLockedFields(partial, eff, user));
}

async function refreshIndexingConsentUi(): Promise<void> {
  const group = document.getElementById("cx-indexing-consent-group");
  if (!group) return;
  try {
    const r = await storageLocalGet([INDEXING_CONSENT_KEY]);
    group.hidden = Boolean(r[INDEXING_CONSENT_KEY]);
  } catch {
    group.hidden = false;
  }
}

async function loadSettingsUi(): Promise<void> {
  try {
    const v = chrome.runtime.getManifest().version;
    const el = document.getElementById("cx-about-version");
    if (el && v) el.textContent = v;
  } catch {
    /* not in an extension context */
  }
  void refreshIndexingConsentUi();
  const [s, eff] = await Promise.all([getUserSettings(), getEffectiveSettings()]);
  syncPauseToggle(s.indexingPaused);
  qs<HTMLTextAreaElement>("#cx-opt-blocklist").value = s.blocklist.join("\n");

  const mode = s.chatMode ?? "auto";
  document
    .querySelectorAll<HTMLInputElement>('input[name="cx-chat-mode"]')
    .forEach((r) => {
      r.checked = r.value === mode;
    });
  document
    .querySelectorAll<HTMLInputElement>('input[name="cx-theme"]')
    .forEach((r) => {
      r.checked = r.value === (s.theme ?? "light");
    });
  document
    .querySelectorAll<HTMLInputElement>('input[name="cx-panel-mode"]')
    .forEach((r) => {
      r.checked = r.value === (s.panelPreference ?? "auto");
    });
  (qs("#cx-opt-cloud-chat") as HTMLInputElement).checked = s.cloudChatEnabled;
  // S-2: key comes from secret store via getEffectiveSettings, not getUserSettings.
  (qs("#cx-opt-gemini-key") as HTMLInputElement).value = eff.geminiApiKey ?? "";
  const provider = normalizeCloudProvider(s.cloudProvider);
  qs<HTMLSelectElement>("#cx-opt-cloud-provider").value = provider;
  qs<HTMLInputElement>("#cx-opt-cloud-model").value = s.cloudModel || defaultCloudModel(provider);
  qs<HTMLInputElement>("#cx-opt-cloud-base").value = s.cloudBaseUrl ?? "";
  syncCloudProviderFields();
  qs<HTMLSelectElement>("#cx-opt-retention").value = String(s.retentionDays ?? 0);
  document.querySelectorAll<HTMLInputElement>("input[data-feature]").forEach((box) => {
    const key = box.dataset.feature as FeatureToggle;
    box.checked = Boolean(s[key]);
  });

  renderBlocklistChips();

  // Enterprise policy: lock and label managed fields (Phase 4.1).
  applyManagedLockout(document, eff);
}

async function runForget(scope: "site" | "hour" | "day", hostname?: string): Promise<void> {
  const fb = qs<HTMLElement>("#cx-forget-feedback");
  fb.classList.remove("is-error");
  fb.hidden = true;
  const res = (await chrome.runtime.sendMessage({
    type: "CORTEX_FORGET",
    scope,
    hostname,
  })) as
    | { ok?: boolean; error?: string; site?: string; counts?: { documents?: number; messages?: number } }
    | undefined;
  if (res?.ok) {
    const pages = res.counts?.documents ?? 0;
    const what =
      scope === "site" ? `${res.site}` : scope === "hour" ? "the last hour" : "the last day";
    fb.textContent = `Forgot ${what}: ${pages} page${pages === 1 ? "" : "s"} removed.`;
    fb.hidden = false;
    void refreshStats();
  } else {
    fb.textContent =
      res?.error === "bad_hostname" ? "Enter a site like example.com." : "Could not forget that data.";
    fb.classList.add("is-error");
    fb.hidden = false;
  }
}

function hideDeleteConfirm(): void {
  qs<HTMLElement>("#cx-delete-confirm").hidden = true;
  qs<HTMLInputElement>("#cx-delete-input").value = "";
  qs<HTMLButtonElement>("#cx-delete-confirm-btn").disabled = true;
  qs<HTMLElement>("#cx-delete-feedback").hidden = true;
  deleteOpenAt = 0;
}

function showDeleteConfirm(): void {
  deleteOpenAt = Date.now();
  qs<HTMLElement>("#cx-delete-confirm").hidden = false;
  qs<HTMLInputElement>("#cx-delete-input").focus();
  updateDeleteConfirmEnabled();
}

/**
 * Sticky section nav: marks the section the reader is in with aria-current so
 * it is announced as well as highlighted. Links stay plain anchors, so jumping
 * works with the keyboard and without this script.
 */
function initSectionNav(): void {
  const links = [...document.querySelectorAll<HTMLAnchorElement>(".cx-nav-link")];
  const pairs: { id: string; link: HTMLAnchorElement; section: HTMLElement }[] = [];
  for (const link of links) {
    const id = link.getAttribute("href")?.slice(1) ?? "";
    const section = id ? document.getElementById(id) : null;
    if (section) pairs.push({ id, link, section });
  }
  if (!pairs.length) return;

  const setCurrent = (id: string): void => {
    for (const p of pairs) {
      if (p.id === id) p.link.setAttribute("aria-current", "true");
      else p.link.removeAttribute("aria-current");
    }
  };

  // Move focus to the section so the keyboard lands where the eye does.
  for (const p of pairs) {
    p.link.addEventListener("click", () => {
      setCurrent(p.id);
      window.setTimeout(() => p.section.focus({ preventScroll: true }), 0);
    });
  }

  // The section whose top has passed just under the sticky bar wins. At the
  // very bottom the last section is short and never gets there, so pin it.
  const LINE = 140;
  let frame = 0;
  const update = (): void => {
    frame = 0;
    const doc = document.documentElement;
    const atBottom =
      window.innerHeight + Math.ceil(window.scrollY) >= doc.scrollHeight - 2;
    let id = pairs[pairs.length - 1].id;
    if (!atBottom) {
      id = pairs[0].id;
      for (const p of pairs) {
        if (p.section.getBoundingClientRect().top <= LINE) id = p.id;
      }
    }
    setCurrent(id);
  };
  const schedule = (): void => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  update();
}

function updateDeleteConfirmEnabled(): void {
  const input = qs<HTMLInputElement>("#cx-delete-input");
  const btn = qs<HTMLButtonElement>("#cx-delete-confirm-btn");
  const typed = input.value.trim().toUpperCase() === "DELETE";
  btn.disabled = !(typed || (deleteOpenAt > 0 && Date.now() - deleteOpenAt < 5000));
}

document.addEventListener("DOMContentLoaded", () => {
  initBackupUi(document, {
    send: (m) => chrome.runtime.sendMessage(m),
    download: saveBlob,
    onRestored: () => void refreshStats(),
  });
  initSectionNav();
  void refreshStats();
  void loadSettingsUi();
  void (async () => {
    const p = await fetchHistoryProgress();
    applyHistoryUi(p);
    if (p.running) startHistoryPolling();
  })();

  qs<HTMLButtonElement>("#cx-opt-pause-toggle").addEventListener("click", () => {
    const input = qs<HTMLInputElement>("#cx-opt-pause");
    input.checked = !input.checked;
    syncPauseToggle(input.checked);
  });

  qs<HTMLTextAreaElement>("#cx-opt-blocklist").addEventListener("input", () => {
    renderBlocklistChips();
  });

  document
    .querySelectorAll<HTMLInputElement>('input[name="cx-theme"]')
    .forEach((r) => {
      r.addEventListener("change", () => {
        if (!r.checked) return;
        const theme =
          r.value === "light" || r.value === "dark" ? r.value : "system";
        void setUserSettings({ theme });
      });
    });

  document
    .querySelectorAll<HTMLInputElement>('input[name="cx-panel-mode"]')
    .forEach((r) => {
      r.addEventListener("change", () => {
        if (!r.checked) return;
        void setUserSettings({ panelPreference: normalizePanelPreference(r.value) });
      });
    });

  qs<HTMLButtonElement>("#cx-opt-retry-stats").addEventListener("click", () => {
    void refreshStats();
  });

  document.querySelectorAll<HTMLInputElement>("input[data-feature]").forEach((box) => {
    box.addEventListener("change", () => {
      const key = box.dataset.feature as FeatureToggle;
      void saveUserSettings({ [key]: box.checked } as Partial<CortexUserSettings>);
    });
  });

  qs<HTMLSelectElement>("#cx-opt-retention").addEventListener("change", (e) => {
    const v = Number((e.target as HTMLSelectElement).value);
    void saveUserSettings({ retentionDays: Number.isFinite(v) && v >= 1 ? v : 0 });
  });

  qs<HTMLButtonElement>("#cx-forget-site-btn").addEventListener("click", () => {
    const host = qs<HTMLInputElement>("#cx-forget-site").value.trim();
    void runForget("site", host);
  });
  qs<HTMLButtonElement>("#cx-forget-hour").addEventListener("click", () => void runForget("hour"));
  qs<HTMLButtonElement>("#cx-forget-day").addEventListener("click", () => void runForget("day"));

  // Policy pushed while the page is open: re-apply the lockout.
  chrome.storage?.onChanged?.addListener((_changes, area) => {
    if (area === "managed") void loadSettingsUi();
  });

  qs<HTMLSelectElement>("#cx-opt-cloud-provider").addEventListener("change", () => {
    const id = normalizeCloudProvider(qs<HTMLSelectElement>("#cx-opt-cloud-provider").value);
    const model = qs<HTMLInputElement>("#cx-opt-cloud-model");
    const known = knownModelIds();
    if (!model.value.trim() || known.has(model.value.trim())) model.value = defaultCloudModel(id);
    syncCloudProviderFields();
  });

  qs<HTMLSelectElement>("#cx-opt-cloud-model-pick").addEventListener("change", () => {
    const pick = qs<HTMLSelectElement>("#cx-opt-cloud-model-pick");
    const other = pick.value === OTHER_MODEL;
    qs<HTMLElement>("#cx-opt-cloud-model-other").hidden = !other;
    const input = qs<HTMLInputElement>("#cx-opt-cloud-model");
    if (other) {
      input.value = "";
      input.focus();
    } else {
      input.value = pick.value;
    }
  });

  qs<HTMLButtonElement>("#cx-opt-cloud-models-load").addEventListener("click", () => void loadModelsFromKey());

  qs<HTMLInputElement>("#cx-opt-gemini-key").addEventListener("input", () => {
    const knownBefore = knownModelIds();
    loadedModels.clear();
    const key = qs<HTMLInputElement>("#cx-opt-gemini-key");
    const cloud = qs<HTMLInputElement>("#cx-opt-cloud-chat");
    if (key.value.trim() && !cloud.disabled) cloud.checked = true;
    const detected = detectCloudProvider(key.value);
    const provider = qs<HTMLSelectElement>("#cx-opt-cloud-provider");
    if (detected && !provider.disabled && provider.value !== detected) {
      provider.value = detected;
      const model = qs<HTMLInputElement>("#cx-opt-cloud-model");
      if (!model.value.trim() || knownBefore.has(model.value.trim())) model.value = defaultCloudModel(detected);
    }
    syncCloudProviderFields();
  });

  qs<HTMLButtonElement>("#cx-opt-chat-save").addEventListener("click", () => {
    const cloud = readCloudFields();
    if (typeof cloud === "string") {
      showChatSaveError(cloud);
      return;
    }
    void runSave("#cx-opt-chat-save", "#cx-opt-chat-save-msg", "Save chat settings", () =>
      saveUserSettings({
        chatMode: readChatModeFromForm(),
        ...cloud,
      })
    );
  });

  qs<HTMLButtonElement>("#cx-opt-save").addEventListener("click", () => {
    void runSave("#cx-opt-save", "#cx-opt-save-msg", "Save privacy settings", async () => {
      const cloud = readCloudFields();
      if (typeof cloud === "string") throw new Error(cloud);
      await saveUserSettings({
        indexingPaused: (qs("#cx-opt-pause") as HTMLInputElement).checked,
        blocklist: domainsFromTextarea(qs("#cx-opt-blocklist")),
        chatMode: readChatModeFromForm(),
        ...cloud,
      });
      renderBlocklistChips();
    });
  });

  qs<HTMLButtonElement>("#cx-opt-delete-all").addEventListener("click", () => {
    const panel = qs<HTMLElement>("#cx-delete-confirm");
    if (!panel.hidden) return;
    showDeleteConfirm();
  });

  qs<HTMLInputElement>("#cx-delete-input").addEventListener("input", () => {
    updateDeleteConfirmEnabled();
  });

  qs<HTMLButtonElement>("#cx-delete-cancel-btn").addEventListener("click", () => {
    hideDeleteConfirm();
  });

  qs<HTMLButtonElement>("#cx-delete-confirm-btn").addEventListener("click", async () => {
    const feedback = qs<HTMLElement>("#cx-delete-feedback");
    feedback.hidden = true;
    const res = (await chrome.runtime.sendMessage({
      type: "CORTEX_CLEAR_ALL_DATA",
    })) as { ok?: boolean; error?: string };

    if (res?.ok) {
      hideDeleteConfirm();
      void refreshStats();
    } else {
      feedback.textContent = res?.error ?? "Could not delete data.";
      feedback.classList.add("is-error");
      feedback.hidden = false;
    }
  });

  const consentAllow = document.getElementById(
    "cx-indexing-consent-allow"
  ) as HTMLButtonElement | null;
  consentAllow?.addEventListener("click", async () => {
    const msg = document.getElementById("cx-indexing-consent-msg");
    if (msg) {
      msg.hidden = true;
      msg.classList.remove("is-error");
    }
    consentAllow.disabled = true;
    try {
      const res = (await chrome.runtime.sendMessage({
        type: "CORTEX_INDEXING_CONSENT_GRANT",
      })) as { ok?: boolean; error?: string } | undefined;
      if (!res?.ok) {
        if (msg) {
          msg.textContent =
            res?.error?.trim() || "Could not allow indexing.";
          msg.classList.add("is-error");
          msg.hidden = false;
        }
        consentAllow.disabled = false;
        return;
      }
      await refreshIndexingConsentUi();
      if (msg) {
        msg.textContent = "Indexing is allowed. New pages you read can be saved on this device.";
        msg.hidden = false;
      }
    } catch {
      if (msg) {
        msg.textContent = "Could not allow indexing.";
        msg.classList.add("is-error");
        msg.hidden = false;
      }
      consentAllow.disabled = false;
    }
  });

  qs<HTMLButtonElement>("#cx-opt-history-start").addEventListener("click", async () => {
    qs<HTMLElement>("#cx-opt-history-status").textContent = "";
    const days = Number(qs<HTMLSelectElement>("#cx-opt-history-days").value);
    const maxUrls = Number(qs<HTMLSelectElement>("#cx-opt-history-cap").value);
    const res = (await chrome.runtime.sendMessage({
      type: "CORTEX_HISTORY_IMPORT_START",
      daysBack: days,
      maxUrls,
    })) as { ok?: boolean; error?: string };

    if (!res?.ok) {
      qs<HTMLElement>("#cx-opt-history-status").textContent =
        res?.error === "already_running"
          ? "A scan is already running."
          : "Could not start scan.";
      return;
    }
    void refreshIndexingConsentUi();
    startHistoryPolling();
  });

  qs<HTMLButtonElement>("#cx-opt-history-cancel").addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "CORTEX_HISTORY_IMPORT_CANCEL" });
  });

  void import(/* webpackChunkName: "assistant-sync-options" */ "./assistant-sync-panel").then((mod) => {
    mod.mountAssistantSyncPanel();
  });
});
