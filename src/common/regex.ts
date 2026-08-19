/**
 * Escapes regex metacharacters so a search term from a message is matched literally.
 *
 * Without this, "delete (" throws Invalid regular expression and the sender just gets
 * silence, "delete (a+)+$" backtracks catastrophically and burns the whole function
 * budget, and "delete ." matches every memory containing any character — deleting
 * everything, irreversibly, from a plausible typo.
 */
export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
