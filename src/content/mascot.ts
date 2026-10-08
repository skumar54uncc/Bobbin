/** Felt mascot. Below 64px this always uses felt-head. */

const ALT: Record<string, string> = {
  wave: "Cortex mascot waving",
  idle: "Cortex mascot waiting",
  searching: "Cortex mascot reading through pages",
  found: "Cortex mascot with a page it found",
  sleepy: "Cortex mascot resting",
  syncing: "Cortex mascot syncing",
  connected: "Cortex mascot connected",
  lost: "Cortex mascot looking for a page",
  portrait: "Cortex mascot portrait",
};

function asset(file: string): string {
  if (typeof chrome === "undefined" || !chrome.runtime?.getURL) return "mascot/" + file;
  return chrome.runtime.getURL("mascot/" + file);
}

const KNOWN_STATES = new Set([
  "wave",
  "idle",
  "searching",
  "found",
  "sleepy",
  "syncing",
  "connected",
  "lost",
  "portrait",
]);

export function mascotHtml(state: string, px: number): string {
  const safe = KNOWN_STATES.has(state) ? state : "idle";
  const size = Number.isFinite(px) ? Math.max(16, Math.min(256, Math.round(px))) : 96;
  const head = size < 64;
  const file = head ? "felt-head.webp" : `felt-${safe}.webp`;
  const url = asset(file);
  const set = head ? "" : ` srcset="${asset(file.replace(".webp", "@256.webp"))} 256w, ${url} 512w"`;
  const s = size >= 160 ? "lg" : size >= 64 ? "md" : "sm";
  const key = head ? "head" : safe;
  const alt = head ? "Cortex mascot" : ALT[safe] || "Cortex mascot";
  return `<span class="cx-m" data-s="${s}" data-k="${key}"><img alt="${alt}" width="${size}" height="${size}" src="${url}"${set} loading="lazy" decoding="async"></span>`;
}
