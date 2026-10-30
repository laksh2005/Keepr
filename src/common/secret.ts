import { ForbiddenException } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";

/** True when `provided` equals `expected`, compared in constant time. */
export function secretMatches(provided: string | undefined, expected: string): boolean {
  const providedBuffer = Buffer.from(provided ?? "");
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

/** Throws 403 unless `provided` matches `expected`. */
export function assertSecret(provided: string | undefined, expected: string): void {
  if (!secretMatches(provided, expected)) {
    throw new ForbiddenException();
  }
}
