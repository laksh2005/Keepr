import { extractAnswer } from "../src/recall/answer-extractor";

// Static question / saved-memory pairs the rules are tuned on.
describe("extractAnswer", () => {
  it.each([
    ["send me the recipe link", "Pasta recipe https://example.com/pasta.", "https://example.com/pasta"],
    ["what's Raj's email", "Raj from design, raj.k@example.com", "raj.k@example.com"],
    ["plumber's number", "Plumber Sunil +91 98100 12345 comes on weekends", "+91 98100 12345"],
    ["how much was the AC repair", "AC repair cost ₹2,500 last time", "₹2,500"],
    ["when is the dentist", "Dentist appointment on Thursday at 4pm", "Thursday at 4pm"],
    ["dentist kab hai", "Dentist appointment on 14 March", "14 March"],
    ["where is the spare key", "The spare key is under the blue mat.", "under the blue mat"],
    ["chabi kahan hai", "chabi drawer mein hai", "drawer mein"]
  ])("answers %s", (question, context, expected) => {
    expect(extractAnswer(question, context)).toBe(expected);
  });

  it.each([
    ["what did Priya recommend", "Priya recommended Olive Bistro"],
    ["send me the recipe link", "Ask Raj about the pasta"],
    ["when is the dentist", "Find a new dentist"],
    ["plumber's number", "Plumber Sunil is good"]
  ])("returns null for %s when no rule is sure", (question, context) => {
    expect(extractAnswer(question, context)).toBeNull();
  });

  it("caps long answers", () => {
    const answer = extractAnswer("where is it", `It is in ${"a".repeat(200)}`);
    expect(answer!.length).toBeLessThanOrEqual(100);
  });
});
