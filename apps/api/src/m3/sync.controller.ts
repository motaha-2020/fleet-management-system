import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import type { z } from "zod";
import { routes } from "@fleet/contracts";
import { Ctx, Public, Requires, type RequestContext } from "../auth/context.js";
import { TokenService } from "../auth/token.service.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { TenantDb } from "../fleet/tenant-db.js";
import { SyncService } from "./sync.service.js";

/** E14: Offline Grant, offline event inbox, conflict queue. */
@Controller()
export class SyncController {
  constructor(private readonly tdb: TenantDb, private readonly sync: SyncService, private readonly tokens: TokenService) {}

  @Public() @Get(routes.syncPublicKey.path)
  async publicKey() {
    return { publicKeyPem: await this.tokens.publicKeyPem() };
  }

  /** OFF-002: a fresh grant on every successful connection, with the data the driver needs offline. */
  @Requires("sync.submit") @Post(routes.syncState.path) @HttpCode(200)
  async state(@Ctx() ctx: RequestContext) {
    return this.sync.state(await this.tdb.for(ctx), ctx);
  }

  @Requires("sync.submit") @Post(routes.syncEvents.path) @HttpCode(200)
  async events(@Body(new ZodPipe(routes.syncEvents.body)) b: z.output<typeof routes.syncEvents.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const results = await this.sync.ingest(db, ctx, b.events);
    return { ...(await this.sync.state(db, ctx)), results };
  }

  @Requires("sync.conflict_review") @Get(routes.listSyncConflicts.path)
  async conflicts(@Query(new ZodPipe(routes.listSyncConflicts.query)) q: z.output<typeof routes.listSyncConflicts.query>, @Ctx() ctx: RequestContext) {
    return { items: await this.sync.conflicts(await this.tdb.for(ctx), ctx, q.status) };
  }
}
