import { Controller, Get, Inject } from "@nestjs/common";
import type pg from "pg";
import { buildOpenApi } from "@fleet/contracts";
import { Public } from "./auth/context.js";
import { CONTROL_POOL } from "./infra/tokens.js";

@Controller()
export class HealthController {
  constructor(@Inject(CONTROL_POOL) private readonly pool: pg.Pool) {}

  @Public() @Get("/health")
  async health() {
    await this.pool.query("SELECT 1");
    return { ok: true };
  }

  @Public() @Get("/openapi.json")
  openapi() {
    return buildOpenApi();
  }
}
