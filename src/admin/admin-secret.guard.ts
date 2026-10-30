import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import { assertSecret } from "../common/secret";

/**
 * Checks the admin secret as a guard, which Nest runs before body validation:
 * otherwise an unauthenticated caller got a 400 describing the expected body
 * instead of a plain 403.
 */
@Injectable()
export class AdminSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers["x-admin-secret"];
    assertSecret(typeof provided === "string" ? provided : undefined, this.config.getOrThrow<string>("ADMIN_SECRET"));
    return true;
  }
}
