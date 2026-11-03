import { isQuestion } from "../src/intent/question-detector";

// The static examples the rules are tuned on. A misrouted real message belongs here.
const QUESTIONS = [
  "where did I put the Paris photos",
  "what's the wifi password",
  "wifi password?",
  "when is mom's birthday",
  "who recommended that book",
  "which restaurant did Priya suggest",
  "how do I reset the router",
  "did I pay the rent",
  "do you have my passport number",
  "is there anything about the dentist",
  "find my flight details",
  "show me the recipe link",
  "tell me the gym timings",
  "search plumber",
  "wifi ka password kya hai",
  "dentist kab hai",
  "chabi kahan hai",
  "passport number batao",
  "kya maine rent diya",
  "Where's the receipt."
];

const STATEMENTS = [
  "the spare key is under the mat",
  "wifi password is sunflower42",
  "mom's birthday is 14 March",
  "Priya suggested Olive Bistro",
  "Paris photos",
  "can opener is in drawer 2",
  "remember to call the plumber",
  "note: passport expires 2029",
  "remember where I parked? level 3, spot 42",
  "what a day it was",
  "how much I love this song",
  "today I went for a run",
  "dentist moved to 4pm thursday",
  "https://example.com/recipe",
  "gym is open 6 to 10",
  "chabi drawer mein hai"
];

describe("isQuestion", () => {
  it.each(QUESTIONS)("reads %s as a question", (text) => expect(isQuestion(text)).toBe(true));
  it.each(STATEMENTS)("reads %s as a statement", (text) => expect(isQuestion(text)).toBe(false));
  it("treats empty text as a statement", () => expect(isQuestion("   ")).toBe(false));
});
