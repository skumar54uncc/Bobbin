import { describe, expect, it } from "vitest";
import { createDwellTracker, DWELL_REPORT_MS, IDLE_AFTER_MS, type DwellReport } from "../src/content/dwell";

function harness() {
  let now = 1_000_000;
  const env = { visible: true, focused: true, playing: false, scroll: 10 };
  const sent: DwellReport[] = [];
  const tracker = createDwellTracker("https://example.com/a", {
    now: () => now,
    visible: () => env.visible,
    focused: () => env.focused,
    playing: () => env.playing,
    scrollPct: () => env.scroll,
    send: (report) => sent.push(report),
  });
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 1000) {
      now += 1000;
      tracker.tick();
    }
  };
  return { tracker, env, sent, run, advance: (ms: number) => (now += ms) };
}

describe("dwell tracker", () => {
  it("counts time only while the tab is visible and focused", () => {
    const { tracker, env, run } = harness();
    run(10_000);
    env.focused = false;
    run(10_000);
    env.focused = true;
    env.visible = false;
    run(10_000);
    expect(tracker.snapshot().activeMs).toBe(10_000);
  });

  it("stops counting after a minute without input unless a video plays", () => {
    const { tracker, env, run } = harness();
    run(IDLE_AFTER_MS + 30_000);
    expect(tracker.snapshot().activeMs).toBe(IDLE_AFTER_MS - 1000);
    env.playing = true;
    run(5_000);
    expect(tracker.snapshot().activeMs).toBe(IDLE_AFTER_MS + 4000);
    env.playing = false;
    tracker.input();
    run(2_000);
    expect(tracker.snapshot().activeMs).toBe(IDLE_AFTER_MS + 6000);
  });

  it("does not count a sleeping laptop as reading", () => {
    const { tracker, advance } = harness();
    advance(3_600_000);
    tracker.tick();
    expect(tracker.snapshot().activeMs).toBeLessThanOrEqual(2000);
  });

  it("reports every 15 seconds and sends a final report on navigation", () => {
    const { tracker, env, sent, run } = harness();
    env.scroll = 64;
    run(DWELL_REPORT_MS);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ url: "https://example.com/a", activeMs: DWELL_REPORT_MS, maxScrollPct: 64, final: false });
    tracker.navigate("https://example.com/b");
    expect(sent.at(-1)).toMatchObject({ url: "https://example.com/a", final: true });
    run(3_000);
    expect(tracker.snapshot()).toMatchObject({ url: "https://example.com/b", activeMs: 3000 });
  });

  it("sends one final report on pagehide", () => {
    const { tracker, sent, run } = harness();
    run(4_000);
    tracker.end();
    tracker.end();
    expect(sent.filter((report) => report.final)).toHaveLength(1);
    expect(sent.at(-1)?.activeMs).toBe(4000);
  });
});
