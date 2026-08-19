import { expandAbbreviations } from "../src/common/text-expansion";

describe("expandAbbreviations", () => {
  it("appends the long form so either phrasing can find the other", () => {
    expect(expandAbbreviations("i am ooo on monday")).toBe(
      "i am ooo on monday (out of office)"
    );
  });

  it("keeps the shorthand rather than replacing it", () => {
    // Someone who saved "wfh" may well search "wfh" too — dropping it would trade one
    // broken phrasing for another.
    expect(expandAbbreviations("wfh friday")).toContain("wfh");
  });

  it("expands several abbreviations in one message", () => {
    const result = expandAbbreviations("wfh today, standup at eod");
    expect(result).toContain("working from home");
    expect(result).toContain("end of day");
  });

  it("leaves text without abbreviations untouched", () => {
    expect(expandAbbreviations("dinner with mum on sunday")).toBe(
      "dinner with mum on sunday"
    );
  });

  it("does not duplicate an expansion already spelled out", () => {
    const result = expandAbbreviations("ooo (out of office) next week");
    expect(result).toBe("ooo (out of office) next week");
  });

  it("does not fire on abbreviations embedded in longer words", () => {
    // "pw" inside "pwned", "mtg" inside "mtgox"
    expect(expandAbbreviations("got pwned playing mtgox")).toBe("got pwned playing mtgox");
  });

  it("handles empty input", () => {
    expect(expandAbbreviations("")).toBe("");
  });
});
