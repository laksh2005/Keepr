// "i am ooo on monday" is a fact about a day, but nothing in the pipeline knew that,
// so "when am i out of office?" had only sentence similarity to work with. Pulling the
// time references out at save time lets recall prefer memories that can actually answer
// a "when" question, and lets the reply say which day it found.

const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday"
];

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december"
];

const RELATIVE = [
  "today",
  "tonight",
  "tomorrow",
  "yesterday",
  "this week",
  "next week",
  "last week",
  "this weekend",
  "next weekend",
  "this month",
  "next month",
  "this year",
  "next year"
];

const PATTERNS: RegExp[] = [
  // Weekdays, with optional abbreviation: monday, mon, tues, thurs
  new RegExp(`\\b(${WEEKDAYS.join("|")})\\b`, "gi"),
  /\b(mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)\b/gi,
  // Relative expressions
  new RegExp(`\\b(${RELATIVE.join("|")})\\b`, "gi"),
  // "27 may", "27th may", "may 27"
  new RegExp(`\\b\\d{1,2}(st|nd|rd|th)?\\s+(${MONTHS.join("|")})\\b`, "gi"),
  new RegExp(`\\b(${MONTHS.join("|")})\\s+\\d{1,2}(st|nd|rd|th)?\\b`, "gi"),
  // Numeric dates: 27/5, 27-05-2026, 2026-05-27
  /\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b/g,
  /\b\d{4}-\d{2}-\d{2}\b/g,
  // Clock times: 5pm, 5:30 pm, 17:00
  /\b\d{1,2}(:\d{2})?\s?(am|pm)\b/gi,
  /\b\d{1,2}:\d{2}\b/g,
  // Durations that read as deadlines: "in 3 days", "in 2 weeks"
  /\bin\s+\d+\s+(minute|hour|day|week|month|year)s?\b/gi
];

/**
 * Returns the distinct time references in `text`, lowercased, in the order they
 * appear. Empty when the text says nothing about time.
 */
export function extractTemporalTerms(text: string): string[] {
  if (!text) return [];

  const found = new Map<string, number>();
  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const term = match[0].trim().toLowerCase().replace(/\s+/g, " ");
      if (term && !found.has(term)) found.set(term, match.index ?? 0);
    }
  }

  return [...found.entries()].sort((a, b) => a[1] - b[1]).map(([term]) => term);
}

/**
 * True when the question is asking about timing, which is the case where a memory
 * carrying a time reference is a much better answer than one without.
 */
export function isWhenQuestion(text: string): boolean {
  if (!text) return false;
  return /\b(when|what time|which day|what day|how soon|what date)\b/i.test(text);
}
