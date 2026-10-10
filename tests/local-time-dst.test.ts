import { describe, expect, it } from "vitest";
import { localVisitStamp } from "../src/assistant-sync/local-time";

describe("local visit stamps across DST, midnight, and travel", () => {
  it("keeps the hour that exists after the US spring-forward skip", () => {
    const before = Date.parse("2026-03-08T06:30:00.000Z");
    const after = Date.parse("2026-03-08T07:30:00.000Z");
    expect(localVisitStamp(before, "America/New_York")).toEqual({
      date: "2026-03-08",
      weekday: "Sunday",
      time: "01:30",
    });
    expect(localVisitStamp(after, "America/New_York")).toEqual({
      date: "2026-03-08",
      weekday: "Sunday",
      time: "03:30",
    });
  });

  it("keeps the repeated 1 a.m. hour on US fall-back as two distinct instants", () => {
    const first = Date.parse("2026-11-01T05:30:00.000Z");
    const second = Date.parse("2026-11-01T06:30:00.000Z");
    expect(localVisitStamp(first, "America/New_York")).toEqual({
      date: "2026-11-01",
      weekday: "Sunday",
      time: "01:30",
    });
    expect(localVisitStamp(second, "America/New_York")).toEqual({
      date: "2026-11-01",
      weekday: "Sunday",
      time: "01:30",
    });
    expect(first).not.toBe(second);
  });

  it("splits a UTC morning across local midnight", () => {
    const late = Date.parse("2026-10-02T03:59:00.000Z");
    const early = Date.parse("2026-10-02T04:00:00.000Z");
    expect(localVisitStamp(late, "America/New_York")).toMatchObject({ date: "2026-10-01", time: "23:59" });
    expect(localVisitStamp(early, "America/New_York")).toMatchObject({ date: "2026-10-02", time: "00:00" });
  });

  it("labels the same instant by the traveler's timezone", () => {
    const instant = Date.parse("2026-10-02T04:00:00.000Z");
    expect(localVisitStamp(instant, "America/New_York").date).toBe("2026-10-02");
    expect(localVisitStamp(instant, "Pacific/Honolulu").date).toBe("2026-10-01");
    expect(localVisitStamp(instant, "Asia/Tokyo")).toEqual({
      date: "2026-10-02",
      weekday: "Friday",
      time: "13:00",
    });
  });
});
