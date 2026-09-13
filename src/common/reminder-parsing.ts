import * as chrono from "chrono-node";

// Regex could not carry this: turning "monday" or "in 3 days" into an actual
// timestamp needs a real calendar (today's weekday, month lengths, DST), which is
// exactly what chrono-node exists for. It also finds *where* the date phrase sits in
// the sentence, so it can be stripped to leave just the reminder content.
// \b after "to" matters: without it, "remind me tomorrow" matched "remind me to" —
// the "to" inside "tomorrow" — leaving "morrow" as the start of the parsed content.
const TRIGGER = /^(remind me( to\b)?|reminder:?|don'?t let me forget( to\b)?)\s*/i;

// A serverless runtime's local timezone is whatever the platform chose (UTC on
// Vercel), not the sender's. Without this, "remind me at 5pm" parses as 5pm UTC —
// 10:30pm IST — silently 5.5 hours off. Every Keepr number today is used from India,
// so this is fixed rather than per-user until the product actually needs otherwise.
//
// A numeric minutes-from-UTC offset, not the IANA name "Asia/Kolkata": chrono-node
// resolves named zones through the runtime's ICU data, and Vercel's Node build ships
// a reduced ICU set that silently fell back to UTC for it in testing — correct
// locally, wrong once deployed, with no error either way. IST has no DST, so a fixed
// offset loses nothing a named zone would have given it.
export const REMINDER_UTC_OFFSET_MINUTES = 330;

export interface ParsedReminder {
  /** What to remind the sender about, with the trigger phrase and date removed. */
  content: string;
  dueAt: Date;
}

/**
 * True for "remind me ..." / "reminder: ..." / "don't let me forget ..." regardless of
 * whether a date could be found — lets the caller tell "not a reminder at all" apart
 * from "tried to set one but I couldn't find a time", which deserve different replies.
 */
export function looksLikeReminderAttempt(text: string): boolean {
  return TRIGGER.test(text.trim());
}

/**
 * Returns null when the message is not a reminder request, or when it is one but no
 * date could be found in it — check `looksLikeReminderAttempt` first to tell those
 * two cases apart.
 */
export function parseReminder(text: string, now: Date = new Date()): ParsedReminder | null {
  const trimmed = text.trim();
  if (!TRIGGER.test(trimmed)) return null;

  const withoutTrigger = trimmed.replace(TRIGGER, "").trim();
  if (!withoutTrigger) return null;

  const results = chrono.parse(
    withoutTrigger,
    { instant: now, timezone: REMINDER_UTC_OFFSET_MINUTES },
    { forwardDate: true }
  );
  if (!results.length) return null;

  // Longest match wins: "monday at 5pm" should consume both parts, not just "5pm" if
  // chrono returns overlapping candidates for the same phrase.
  const match = results.reduce((best, r) => (r.text.length > best.text.length ? r : best));

  const content = (
    withoutTrigger.slice(0, match.index) + withoutTrigger.slice(match.index + match.text.length)
  )
    // Splicing out the date phrase almost always leaves a leading or trailing space
    // ("tomorrow" removed from "tomorrow to submit..." leaves " to submit...") — that
    // space has to go before the anchored regexes below, or they never match.
    .trim()
    .replace(/\s+/g, " ")
    // A stray leading "to"/"about" from "remind me to <x> on monday", and a trailing
    // preposition — optionally with "the" — left behind by "<x> on the 1st of october".
    .replace(/^(to|about)\s+/i, "")
    .replace(/\s+(on|at|by)(\s+the)?\s*$/i, "")
    .trim();

  if (!content) return null;

  return { content, dueAt: match.start.date() };
}
