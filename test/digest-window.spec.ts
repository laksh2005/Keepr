import { digestWeekKey, isDigestWindowNow } from "../src/common/digest-window";

describe("isDigestWindowNow", () => {
  it("is true for the whole 5pm IST hour on a Sunday", () => {
    // Sunday 2026-09-13 17:00 IST == 2026-09-13T11:30:00Z
    expect(isDigestWindowNow(new Date("2026-09-13T11:30:00Z"))).toBe(true);
    // Still within the hour, near its end.
    expect(isDigestWindowNow(new Date("2026-09-13T12:29:00Z"))).toBe(true);
  });

  it("is false just before or after the 5pm IST hour on a Sunday", () => {
    expect(isDigestWindowNow(new Date("2026-09-13T11:29:00Z"))).toBe(false);
    expect(isDigestWindowNow(new Date("2026-09-13T12:30:00Z"))).toBe(false);
  });

  it("is false at 5pm IST on any day that isn't Sunday", () => {
    // Monday 2026-09-14 17:00 IST
    expect(isDigestWindowNow(new Date("2026-09-14T11:30:00Z"))).toBe(false);
  });
});

describe("digestWeekKey", () => {
  it("returns the IST calendar date", () => {
    // 2026-09-13T23:00:00Z is already 2026-09-14 in IST (+5:30).
    expect(digestWeekKey(new Date("2026-09-13T23:00:00Z"))).toBe("2026-09-14");
    expect(digestWeekKey(new Date("2026-09-13T11:30:00Z"))).toBe("2026-09-13");
  });

  it("stays the same across the whole digest-window hour", () => {
    const start = digestWeekKey(new Date("2026-09-13T11:30:00Z"));
    const end = digestWeekKey(new Date("2026-09-13T12:29:00Z"));
    expect(start).toBe(end);
  });
});
