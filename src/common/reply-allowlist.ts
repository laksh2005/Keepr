import { ConfigService } from "@nestjs/config";

/**
 * While Keepr is in testing, REPLY_ALLOWLIST (comma-separated digits, such as
 * "917042306233") limits whom it will hear from and message. Unset or empty means no
 * limit. It is enforced at the webhook, in the reminder and digest sweeps, and at the
 * send itself, so a path that forgets the check still cannot text anyone else.
 */
export class ReplyAllowlist {
  private readonly numbers: Set<string> | null;

  constructor(raw: string | undefined) {
    const list = (raw ?? "")
      .split(",")
      .map((number) => number.trim())
      .filter(Boolean);
    this.numbers = list.length ? new Set(list) : null;
  }

  static from(config: ConfigService): ReplyAllowlist {
    return new ReplyAllowlist(config.get<string>("REPLY_ALLOWLIST"));
  }

  get restricted(): boolean {
    return this.numbers !== null;
  }

  allows(number: string | undefined): boolean {
    return !this.numbers || (number !== undefined && this.numbers.has(number));
  }
}
