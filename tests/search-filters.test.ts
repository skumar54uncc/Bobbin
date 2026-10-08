import { describe, it, expect } from "vitest";
import { dayValue, matchPreset, presetDays, rangeFromDays, rangeWords } from "../src/content/search-filters";

const now = new Date(2026, 9, 6, 16, 24);

describe("search date filters", () => {
  it("presets cover whole local days", () => {
    expect(presetDays("today", now)).toEqual({ from: "2026-10-06", to: "2026-10-06" });
    expect(presetDays("yesterday", now)).toEqual({ from: "2026-10-05", to: "2026-10-05" });
    expect(presetDays("week", now)).toEqual({ from: "2026-09-30", to: "2026-10-06" });
    expect(presetDays("month", now)).toEqual({ from: "2026-09-07", to: "2026-10-06" });
    expect(presetDays("any", now)).toEqual({ from: "", to: "" });
  });

  it("recognizes a preset typed by hand and a custom range", () => {
    expect(matchPreset("2026-10-06", "2026-10-06", now)).toBe("today");
    expect(matchPreset("", "", now)).toBe("any");
    expect(matchPreset("2026-10-01", "2026-10-03", now)).toBeNull();
  });

  it("today runs from local midnight to the last millisecond of the day", () => {
    const r = rangeFromDays("2026-10-06", "2026-10-06", now.getTime());
    expect(r.ok && r.range).toEqual({
      from: new Date(2026, 9, 6).getTime(),
      to: new Date(2026, 9, 7).getTime() - 1,
    });
    expect(now.getTime()).toBeGreaterThan(r.ok && r.range ? r.range.from : Infinity);
  });

  it("rejects a From date after the To date", () => {
    const r = rangeFromDays("2026-10-06", "2026-10-05", now.getTime());
    expect(r.ok).toBe(false);
  });

  it("an open end reaches to now or back to the start", () => {
    const since = rangeFromDays("2026-10-01", "", now.getTime());
    expect(since.ok && since.range?.to).toBe(now.getTime());
    const through = rangeFromDays("", "2026-10-01", now.getTime());
    expect(through.ok && through.range?.from).toBe(0);
    expect(rangeFromDays("", "", now.getTime())).toEqual({ ok: true, range: null });
  });

  it("names the range for the results heading", () => {
    expect(rangeWords("2026-10-06", "2026-10-06", now)).toBe("today");
    expect(rangeWords("2026-09-30", "2026-10-06", now)).toBe("in the last 7 days");
    expect(rangeWords("", "", now)).toBe("");
    expect(dayValue(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
