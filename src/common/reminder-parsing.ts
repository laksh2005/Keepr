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

// Hour used when a saved message names a day but no time ("dentist on thursday"):
// a morning nudge on the day itself.
const OFFER_DEFAULT_HOUR = 9;

// An offer is only worth making for something that hasn't happened yet and isn't so
// far off that a reminder now would be noise.
const OFFER_MIN_LEAD_MS = 10 * 60 * 1000;
const OFFER_MAX_LEAD_MS = 365 * 24 * 60 * 60 * 1000;

// "due on the 5th" — chrono has no reading for a bare ordinal day of the month.
const ORDINAL_DAY = /\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/i;

// "42000 a month" is a rate, not a date, though chrono reads it as "one month from now".
const BARE_DURATION = /^(a|an|one)\s+(day|week|fortnight|month|year)$/i;

/** IST wall-clock parts of `instant`. */
function istParts(instant: Date): { year: number; month: number; day: number } {
  const shifted = new Date(instant.getTime() + REMINDER_UTC_OFFSET_MINUTES * 60_000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** The UTC instant for an IST calendar date and wall-clock time. */
function fromIst(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - REMINDER_UTC_OFFSET_MINUTES * 60_000);
}

/**
 * The future moment a saved message refers to, for offering a reminder: "dentist
 * moved to 4pm thursday" gives Thursday 4pm IST, "rent due on the 5th" gives the 5th
 * at 9am. Needs an actual day (a weekday, "tomorrow", a date, "the 14th"): a time on
 * its own ("closes at 9pm") is usually a standing fact, not an event. Null when there
 * is no such day, or it is in the past or implausibly far off.
 */
export function findReminderOffer(text: string, now: Date = new Date()): { dueAt: Date } | null {
  if (!text?.trim()) return null;

  const results = chrono
    .parse(text, { instant: now, timezone: REMINDER_UTC_OFFSET_MINUTES }, { forwardDate: true })
    .filter((r) => !BARE_DURATION.test(r.text.trim()));
  const timed = results.find((r) => r.start.isCertain("hour"));
  const hour = timed?.start.get("hour") ?? OFFER_DEFAULT_HOUR;
  const minute = timed ? timed.start.get("minute") ?? 0 : 0;

  let dueAt: Date | null = null;
  const dated = results
    .filter((r) => r.start.isCertain("day") || r.start.isCertain("weekday"))
    .reduce<chrono.ParsedResult | null>((best, r) => (!best || r.text.length > best.text.length ? r : best), null);

  if (dated) {
    const year = dated.start.get("year");
    const month = dated.start.get("month");
    const day = dated.start.get("day");
    if (year == null || month == null || day == null) return null;
    const ownHour = dated.start.isCertain("hour");
    dueAt = fromIst(
      year,
      month,
      day,
      ownHour ? dated.start.get("hour") ?? hour : hour,
      ownHour ? dated.start.get("minute") ?? 0 : minute
    );
  } else {
    const ordinal = ORDINAL_DAY.exec(text);
    const dayOfMonth = ordinal ? Number(ordinal[1]) : NaN;
    if (!(dayOfMonth >= 1 && dayOfMonth <= 31)) return null;
    // The next time that day comes round: this month if still ahead, else next.
    const today = istParts(now);
    for (let ahead = 0; ahead <= 2 && !dueAt; ahead++) {
      const monthIndex = today.month - 1 + ahead;
      const year = today.year + Math.floor(monthIndex / 12);
      const month = (monthIndex % 12) + 1;
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
      if (dayOfMonth > daysInMonth) continue;
      const candidate = fromIst(year, month, dayOfMonth, hour, minute);
      if (candidate.getTime() - now.getTime() >= OFFER_MIN_LEAD_MS) dueAt = candidate;
    }
    if (!dueAt) return null;
  }

  const lead = dueAt.getTime() - now.getTime();
  if (lead < OFFER_MIN_LEAD_MS || lead > OFFER_MAX_LEAD_MS) return null;
  return { dueAt };
}
