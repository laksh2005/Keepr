// Chat shorthand is invisible to all-MiniLM-L6-v2: "i am ooo on monday" against
// "when am i out of office?" scored 0.664 on Atlas's scale, under the 0.7 relevance
// cut, so a genuinely relevant memory was dropped. Appending the expansion (rather
// than replacing the shorthand, which would break recall for people who search using
// the shorthand) lifts that pair to 0.831. Applied to both the stored text and the
// query so either phrasing finds the other.
const EXPANSIONS: Record<string, string> = {
  ooo: "out of office",
  wfh: "working from home",
  wfo: "working from office",
  eod: "end of day",
  eow: "end of week",
  cob: "close of business",
  asap: "as soon as possible",
  tmrw: "tomorrow",
  tmw: "tomorrow",
  tmr: "tomorrow",
  appt: "appointment",
  mtg: "meeting",
  bday: "birthday",
  addr: "address",
  acc: "account",
  pwd: "password",
  pw: "password",
  otw: "on the way",
  brb: "be right back",
  eta: "estimated time of arrival",
  dob: "date of birth",
  pto: "paid time off",
  "1:1": "one on one meeting",
  yt: "youtube",
  msg: "message",
  rn: "right now",
  tbd: "to be decided",
  tba: "to be announced",
  fyi: "for your information",
  imo: "in my opinion",
  idk: "i do not know"
};

/**
 * Appends the long form of any chat shorthand found in `text`, so an embedding of
 * the result matches queries written either way. Returns `text` unchanged when
 * nothing matches.
 */
export function expandAbbreviations(text: string): string {
  if (!text) return text;

  const seen = new Set<string>();
  for (const [abbreviation, full] of Object.entries(EXPANSIONS)) {
    // Escape regex metacharacters ("1:1" contains none today, but the table is
    // meant to be edited by hand).
    const escaped = abbreviation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // \b does not anchor against a leading digit or colon, so fall back to a
    // whitespace/boundary lookaround for abbreviations that are not plain words.
    const pattern = /^[a-z]+$/i.test(abbreviation)
      ? new RegExp(`\\b${escaped}\\b`, "i")
      : new RegExp(`(^|\\s)${escaped}(\\s|$|[.,!?])`, "i");

    if (pattern.test(text) && !new RegExp(`\\b${full.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) {
      seen.add(full);
    }
  }

  return seen.size ? `${text} (${[...seen].join(", ")})` : text;
}
