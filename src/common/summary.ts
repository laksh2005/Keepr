const MAX_SUMMARY_CHARS = 200;

/**
 * A summary made of the message's own opening sentences, with no model. It keeps whole
 * sentences while they fit and cuts the first one only if it alone is too long.
 */
export function extractiveSummary(text: string, maxChars = MAX_SUMMARY_CHARS): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;

  let summary = "";
  for (const sentence of clean.split(/(?<=[.!?])\s+/)) {
    const next = summary ? `${summary} ${sentence}` : sentence;
    if (next.length > maxChars) break;
    summary = next;
  }
  return summary || `${clean.slice(0, maxChars - 3)}...`;
}
