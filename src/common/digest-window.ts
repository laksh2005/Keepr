import { REMINDER_UTC_OFFSET_MINUTES } from "./reminder-parsing";

// Same numeric-offset approach as reminders, for the same reason: named IANA zones
// resolve through the runtime's ICU data, which Vercel's Node build has silently
// gotten wrong before (see the comment on REMINDER_UTC_OFFSET_MINUTES).
const DIGEST_HOUR_IST = 17;

/**
 * True for the whole 5pm IST hour on a Sunday, not just the top of the hour — the
 * poller only checks in every few minutes, and widening the window means a missed or
 * delayed poll still catches it before the day is over.
 */
export function isDigestWindowNow(now: Date = new Date()): boolean {
  const istWallClock = new Date(now.getTime() + REMINDER_UTC_OFFSET_MINUTES * 60_000);
  return istWallClock.getUTCDay() === 0 && istWallClock.getUTCHours() === DIGEST_HOUR_IST;
}

/** The IST calendar date (YYYY-MM-DD) `now` falls on — used to dedupe one digest per week. */
export function digestWeekKey(now: Date = new Date()): string {
  const istWallClock = new Date(now.getTime() + REMINDER_UTC_OFFSET_MINUTES * 60_000);
  return istWallClock.toISOString().slice(0, 10);
}
