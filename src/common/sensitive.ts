// Things Keepr refuses to keep: payment card numbers and government ID numbers.
// WhatsApp's Business Messaging Policy forbids sharing or requesting them, and a
// notes bot that quietly stores and replays them is the wrong place for them anyway.
// Deliberately narrow: each check validates the number's own checksum or format, so
// phone numbers, order numbers and prices are not caught by accident.

export type SensitiveKind = "card number" | "Aadhaar number" | "PAN" | "social security number";

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
];

// Aadhaar numbers carry a Verhoeff check digit, which weeds out random 12-digit runs.
function verhoeffValid(digits: string): boolean {
  let c = 0;
  const reversed = digits.split("").reverse();
  for (let i = 0; i < reversed.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][Number(reversed[i])]];
  }
  return c === 0;
}

const CARD_CANDIDATE = /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g;
// Written as 4-4-4 groups, or 12 digits straight after the word Aadhaar.
const AADHAAR_GROUPED = /(?<!\d)[2-9]\d{3}[ -]\d{4}[ -]\d{4}(?!\d)/g;
const AADHAAR_LABELLED = /aadh?aa?r[^\d]{0,20}([2-9]\d{11})(?!\d)/i;
const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/i;
const SSN = /(?<!\d)(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?!\d)/;

/** What kind of number a message contains that Keepr won't keep, or null. */
export function findSensitiveIdentifier(text: string): SensitiveKind | null {
  for (const candidate of text.match(CARD_CANDIDATE) ?? []) {
    const digits = candidate.replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) return "card number";
  }
  for (const candidate of text.match(AADHAAR_GROUPED) ?? []) {
    if (verhoeffValid(candidate.replace(/\D/g, ""))) return "Aadhaar number";
  }
  const labelled = AADHAAR_LABELLED.exec(text)?.[1];
  if (labelled && verhoeffValid(labelled)) return "Aadhaar number";
  if (PAN.test(text)) return "PAN";
  if (SSN.test(text)) return "social security number";
  return null;
}
