// WhatsApp rejects a text body over 4096 characters. Leaving headroom keeps a long
// export/digest from failing outright, which used to drop the whole reply silently.
export const MAX_WHATSAPP_BODY_CHARS = 3500;

/**
 * Packs entries into message-sized blocks, splitting between entries rather than
 * mid-entry. An entry longer than `maxChars` on its own is truncated, since sending it
 * whole would have WhatsApp reject the entire message.
 */
export function chunkEntries(entries: string[], maxChars: number): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const entry of entries) {
    const piece = entry.length > maxChars ? `${entry.slice(0, maxChars - 1)}…` : entry;

    if (!current) {
      current = piece;
    } else if (current.length + 2 + piece.length <= maxChars) {
      current += `\n\n${piece}`;
    } else {
      chunks.push(current);
      current = piece;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}
