// Tells a question ("where did I put the Paris photos") from a statement ("the spare
// key is under the mat") with rules, so routing a message costs no inference call.
// Each rule is backed by the example phrases in test/question-detector.spec.ts; add
// a phrase there whenever a real message is routed wrongly.

// Openers that make a question on their own, English and Hinglish.
const QUESTION_WORDS =
  /^(what|what's|whats|wat|when|where|wheres|where's|who|whom|whose|which|why|how|kya|kab|kahan|kahaan|kaha|kaun|kon|kitna|kitne|kitni|kaise|kaisa|konsa|kaunsa|kis|kisne|kidhar)\b/;

// "what a day", "how much I love this": exclamations, not questions.
const EXCLAMATIONS = /^(what an?|how (much|good|nice|great|lovely|cute|sweet) (i|we|it|this|that))\b/;

// Auxiliaries only ask when a subject follows: "did I pay rent" asks,
// "can opener is in drawer 2" doesn't.
const AUX_WITH_SUBJECT =
  /^(did|do|does|is|are|was|were|can|could|will|would|should|have|has|had|am)\s+(i|you|u|we|my|the|it|he|she|they|there|this|that|a|an|any|our|your|his|her|their)\b/;

// Asking Keepr to fetch something.
const FETCH_VERBS =
  /^(find|search|show|look ?up|get me|give me|tell me|fetch|pull up|recall|bring up|dhundo|dhoondo|dhund|batao|bata|bta|dikhao|dikha)\b/;

// Hinglish questions usually end with the question word.
const HINGLISH_ENDINGS = /\b(kya hai|kya tha|kahan hai|kahaan hai|kaha hai|kab hai|kab tha|kaun hai|kitna hai|batao|bata do|dikhao|kya)$/;

// Explicitly asking to keep something, even when it reads like a question.
const SAVE_OPENERS = /^(remember|note|save|keep|store|fyi|reminder to self|note to self|yaad rakh)\b/;

export function isQuestion(text: string): boolean {
  const t = text.toLowerCase().trim().replace(/\s+/g, " ");
  if (!t) return false;
  if (SAVE_OPENERS.test(t)) return false;
  if (t.endsWith("?")) return true;
  const bare = t.replace(/[.!]+$/, "");
  if (EXCLAMATIONS.test(bare)) return false;
  return (
    QUESTION_WORDS.test(bare) || AUX_WITH_SUBJECT.test(bare) || FETCH_VERBS.test(bare) || HINGLISH_ENDINGS.test(bare)
  );
}
