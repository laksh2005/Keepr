import { looksLikeReminderAttempt, parseReminder } from "../src/common/reminder-parsing";

// Fixed reference instant so "next monday" etc. resolve to a known date, not
// whatever day the test happens to run on. 2026-09-14 is a Monday IST.
const NOW = new Date("2026-09-14T10:00:00+05:30");

describe("looksLikeReminderAttempt", () => {
  it.each([
    "remind me to call mom",
    "Remind me tomorrow",
    "reminder: dentist",
    "reminder dentist at 5",
    "don't let me forget the meeting",
    "dont let me forget"
  ])("recognises %s as a reminder attempt", (text) => {
    expect(looksLikeReminderAttempt(text)).toBe(true);
  });

  it.each([
    "call mom tomorrow",
    "I will remember to call mom",
    "reminded me of my dad",
    "this reminds me of college"
  ])("does not mistake %s for a reminder attempt", (text) => {
    expect(looksLikeReminderAttempt(text)).toBe(false);
  });
});

describe("parseReminder", () => {
  it("parses a weekday and strips the trigger and date from the content", () => {
    const result = parseReminder("remind me to call mom on monday", NOW);
    expect(result?.content).toBe("call mom");
    // "on monday" with forwardDate from a Monday means next Monday, not today.
    expect(result?.dueAt.getUTCDay()).toBe(1);
    expect(result!.dueAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("parses a clock time", () => {
    const result = parseReminder("remind me at 5pm to leave for the airport", NOW);
    expect(result?.content).toBe("leave for the airport");
    // 5pm IST = 11:30 UTC.
    expect(result?.dueAt.toISOString()).toContain("11:30:00");
  });

  it("parses a relative day", () => {
    const result = parseReminder("remind me tomorrow to submit the report", NOW);
    expect(result?.content).toBe("submit the report");
    expect(result?.dueAt.getUTCDate()).toBe(NOW.getUTCDate() + 1);
  });

  it("parses 'reminder:' phrasing", () => {
    const result = parseReminder("reminder: dentist appointment at 3pm tomorrow", NOW);
    expect(result?.content).toBe("dentist appointment");
  });

  it("parses \"don't let me forget\" phrasing", () => {
    const result = parseReminder("don't let me forget to water the plants on friday", NOW);
    expect(result?.content).toBe("water the plants");
  });

  it("resolves a bare time to later today when it has not passed yet", () => {
    // NOW is 10:00 IST, so 6pm today has not happened yet.
    const result = parseReminder("remind me at 6pm to call the bank", NOW);
    expect(result?.dueAt.toISOString().slice(0, 10)).toBe(NOW.toISOString().slice(0, 10));
  });

  it("rolls a passed time forward instead of scheduling it in the past", () => {
    // NOW is 10:00 IST; 9am has already passed today, so this must mean tomorrow —
    // otherwise the reminder would fire the instant it is created.
    const result = parseReminder("remind me at 9am to call the bank", NOW);
    expect(result!.dueAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("returns null for an ordinary message", () => {
    expect(parseReminder("call mom tomorrow", NOW)).toBeNull();
  });

  it("returns null when a trigger is used but no date is present", () => {
    expect(parseReminder("remind me to call mom", NOW)).toBeNull();
  });

  it("returns null when nothing follows the trigger", () => {
    expect(parseReminder("remind me", NOW)).toBeNull();
  });

  it("returns null when the date consumes the entire message", () => {
    // "remind me tomorrow" with nothing else to remind about.
    expect(parseReminder("remind me tomorrow", NOW)).toBeNull();
  });

  it("is case-insensitive on the trigger", () => {
    expect(parseReminder("REMIND ME TO CALL MOM ON MONDAY", NOW)).not.toBeNull();
  });

  it("does not leave a dangling preposition from the removed date phrase", () => {
    const result = parseReminder("remind me to pay rent on the 1st of october", NOW);
    expect(result?.content).toBe("pay rent");
  });
});
