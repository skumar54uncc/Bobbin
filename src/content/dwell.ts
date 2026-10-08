/**
 * Measures attention on the current page: time the tab is visible, focused, and
 * either touched in the last minute or playing a video. Also the deepest scroll.
 * Reports go to the service worker, which ends the visit and writes dwell.
 */

export const DWELL_TICK_MS = 1_000;
export const DWELL_REPORT_MS = 15_000;
/** No input for this long counts as away, unless a video is playing. */
export const IDLE_AFTER_MS = 60_000;
/** A tick longer than this (sleep, throttled timer) counts as one tick. */
const MAX_TICK_GAP_MS = 2_000;

export interface DwellReport {
  url: string;
  activeMs: number;
  maxScrollPct: number;
  final: boolean;
}

export interface DwellEnv {
  now(): number;
  visible(): boolean;
  focused(): boolean;
  playing(): boolean;
  scrollPct(): number;
  send(report: DwellReport): void;
}

export interface DwellTracker {
  tick(): void;
  input(): void;
  /** Sends the final report for the current page and starts measuring `nextUrl`. */
  navigate(nextUrl: string): void;
  /** Sends the final report. Called on pagehide. */
  end(): void;
  snapshot(): DwellReport;
}

export function createDwellTracker(url: string, env: DwellEnv): DwellTracker {
  let pageUrl = url;
  let activeMs = 0;
  let maxScroll = 0;
  let lastTick = env.now();
  let lastInput = lastTick;
  let lastReport = lastTick;
  let reportedMs = -1;
  let ended = false;

  const active = (now: number) =>
    env.visible() && env.focused() && (now - lastInput < IDLE_AFTER_MS || env.playing());

  const report = (final: boolean) => {
    if (ended) return;
    if (!final && activeMs === reportedMs) return;
    reportedMs = activeMs;
    env.send({ url: pageUrl, activeMs, maxScrollPct: maxScroll, final });
  };

  return {
    tick() {
      const now = env.now();
      const gap = Math.min(MAX_TICK_GAP_MS, Math.max(0, now - lastTick));
      lastTick = now;
      if (ended) return;
      if (active(now)) activeMs += gap;
      if (env.visible()) maxScroll = Math.max(maxScroll, Math.round(env.scrollPct()));
      if (now - lastReport >= DWELL_REPORT_MS) {
        lastReport = now;
        report(false);
      }
    },
    input() {
      lastInput = env.now();
    },
    navigate(nextUrl) {
      if (nextUrl === pageUrl) return;
      report(true);
      pageUrl = nextUrl;
      activeMs = 0;
      maxScroll = 0;
      reportedMs = -1;
      ended = false;
      lastReport = lastTick = lastInput = env.now();
    },
    end() {
      report(true);
      ended = true;
    },
    snapshot: () => ({ url: pageUrl, activeMs, maxScrollPct: maxScroll, final: false }),
  };
}

export function pageScrollPct(): number {
  const root = document.scrollingElement ?? document.documentElement;
  const height = root.scrollHeight;
  if (!height) return 0;
  return Math.min(100, ((window.scrollY + window.innerHeight) / height) * 100);
}

export function videoPlaying(): boolean {
  for (const video of Array.from(document.querySelectorAll("video"))) {
    if (!video.paused && !video.ended && video.readyState > 2) return true;
  }
  return false;
}
