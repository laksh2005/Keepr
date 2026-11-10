import * as chrono from "chrono-node";

// Pulls the one piece a question asks for out of a saved memory, with rules instead
// of a question-answering model, so a recall costs no extra inference call. Null
// whenever no rule is sure, and the caller then sends the whole memory as before.

const MAX_ANSWER_CHARS = 100;

interface Rule {
  asks: RegExp;
  find: (context: string) => string | null | undefined;
}

const first = (pattern: RegExp, group = 0) => (context: string) => context.match(pattern)?.[group];

const RULES: Rule[] = [
  // No rule for passwords, PINs or one-time codes: Keepr is not a vault and should not
  // pull a secret out of a note and hand it back as a headline answer.
  { asks: /\b(link|url|website|site)\b/i, find: first(/https?:\/\/\S+/i) },
  { asks: /\b(email|e-mail|mail id)\b/i, find: first(/[\w.+-]+@[\w-]+\.[\w.]+/) },
  { asks: /\b(number|phone|contact|mobile)\b/i, find: first(/\+?\d[\d\s-]{6,}\d/) },
  {
    asks: /\b(how much|price|cost|costs|kitna|kitne|amount|paid|fees?)\b/i,
    find: first(/(?:₹|rs\.?|inr|\$|€|£)\s?\d[\d,.]*\s?k?|\d[\d,.]*\s?(?:rs|rupees|inr|dollars|k)\b/i)
  },
  {
    asks: /^(when|kab)\b|\b(what time|what date|which day|which date|kab)\b/i,
    find: (context) => chrono.parse(context)[0]?.text.replace(/^(on|at|by)\s+/i, "")
  },
  {
    asks: /^(where|kahan|kahaan|kaha|kidhar)\b|\b(kahan|kahaan|kidhar)\b/i,
    // English puts the place after the preposition, Hindi before the postposition
    // ("drawer mein").
    find: (context) =>
      context.match(/\b(?:at|in|under|on|inside|near|behind|next to)\s+(?:the\s+|my\s+)?[^.,;\n]{2,60}/i)?.[0] ??
      context.match(/\b\S+\s+(?:mein|me|pe|par)\b/i)?.[0]
  }
];

export function extractAnswer(question: string, context: string): string | null {
  for (const rule of RULES) {
    if (!rule.asks.test(question)) continue;
    const answer = rule.find(context)?.trim().replace(/[.,;:!?)]+$/, "");
    if (answer) return answer.length > MAX_ANSWER_CHARS ? `${answer.slice(0, MAX_ANSWER_CHARS - 3)}...` : answer;
  }
  return null;
}
