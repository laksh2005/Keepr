/**
 * A phone number safe to put in logs: enough to tell users apart while debugging
 * ("91******6233"), not enough to message them.
 */
export function maskNumber(value: string | undefined | null): string {
  const digits = String(value ?? "");
  if (digits.length <= 6) return "*".repeat(digits.length);
  return `${digits.slice(0, 2)}${"*".repeat(digits.length - 6)}${digits.slice(-4)}`;
}
