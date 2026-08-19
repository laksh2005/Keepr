import { extractTemporalTerms, isWhenQuestion } from "../src/common/temporal";

describe("extractTemporalTerms", () => {
  it.each([
    ["i am ooo on monday", "monday"],
    ["standup moved to tomorrow", "tomorrow"],
    ["flight on 27 may", "27 may"],
    ["dentist may 3rd", "may 3rd"],
    ["call at 5pm", "5pm"],
    ["call at 17:30", "17:30"],
    ["deadline in 3 days", "in 3 days"],
    ["renew on 27/05/2026", "27/05/2026"]
  ])("pulls the time reference out of %s", (text, expected) => {
    expect(extractTemporalTerms(text)).toContain(expected);
  });

  it("returns nothing for text with no time reference", () => {
    expect(extractTemporalTerms("my wifi password is hunter2")).toEqual([]);
  });

  it("keeps multiple references in the order they appear", () => {
    expect(extractTemporalTerms("ooo monday, back tuesday")).toEqual(["monday", "tuesday"]);
  });

  it("does not repeat the same reference twice", () => {
    expect(extractTemporalTerms("monday, definitely monday")).toEqual(["monday"]);
  });

  it("handles empty input", () => {
    expect(extractTemporalTerms("")).toEqual([]);
  });
});

describe("isWhenQuestion", () => {
  it.each([
    "when am i out of office?",
    "what time is standup",
    "which day is the flight",
    "what date do i renew"
  ])("treats %s as asking about timing", (text) => {
    expect(isWhenQuestion(text)).toBe(true);
  });

  it.each(["where did i park", "what is my wifi password", "find my designs"])(
    "does not treat %s as asking about timing",
    (text) => {
      expect(isWhenQuestion(text)).toBe(false);
    }
  );
});
