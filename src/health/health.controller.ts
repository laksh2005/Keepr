import { Controller, Get } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";

/**
 * Until this existed the only route was /webhook, which rejects anything unsigned —
 * so "is Keepr up?" could not be answered without forging a webhook call.
 */
@Controller("health")
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get()
  check(): { status: string; database: string; uptime: number } {
    // 1 is "connected" in Mongoose's readyState enum. Reported rather than thrown on,
    // so the endpoint still answers while the database is unreachable.
    const connected = this.connection.readyState === 1;
    return {
      status: connected ? "ok" : "degraded",
      database: connected ? "connected" : "disconnected",
      uptime: Math.floor(process.uptime())
    };
  }
}
