import { findSensitiveIdentifier } from "../src/common/sensitive";

describe("findSensitiveIdentifier", () => {
  it.each([
    ["my card is 4111 1111 1111 1111", "card number"],
    ["4111-1111-1111-1111 exp 12/28", "card number"],
    ["card 4111111111111111", "card number"],
    ["aadhaar 2345 6789 0124", "Aadhaar number"],
    ["Aadhaar number is 234567890124", "Aadhaar number"],
    ["pan ABCDE1234F", "PAN"],
    ["ssn 123-45-6789", "social security number"]
  ])("flags %s", (text, kind) => {
    expect(findSensitiveIdentifier(text)).toBe(kind);
  });

  it.each([
    ["plumber Sunil +91 98100 12345 comes on weekends"],
    ["call 919810012345 tomorrow"],
    ["order 1234567890123 arrives friday"],
    ["AC repair cost ₹2,500 last time"],
    ["wifi password sunflower42"],
    ["gym locker code 4471"],
    ["2345 6789 0123 is not a valid aadhaar checksum"],
    ["flight AI 101 on 14 March, PNR XY12AB"],
    ["the spare key is under the blue mat"]
  ])("leaves %s alone", (text) => {
    expect(findSensitiveIdentifier(text)).toBeNull();
  });
});
