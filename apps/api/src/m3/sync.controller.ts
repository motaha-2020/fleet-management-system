import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import type { z } from "zod";
import { routes } from "@fleet/contracts";
import { Ctx, Public, Requires, tenantOf, type RequestContext } from "../auth/context.js";
import { TokenService } from "../auth/token.service.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { QUEUE } from "../infra/tokens.js";
import type { JobQueue } from "../infra/infra.module.js";
import { TenantDb } from "../fleet/tenant-db.js";
import { enqueueAlertScan } from "../m5/jobs.js";
import { SyncService } from "./sync.service.js";

/** E14: Offline Grant, offline event inbox, conflict queue. */
@Controller()
export class SyncController {
  constructor(private readonly tdb: TenantDb, private readonly sync: SyncService, private readonly tokens: TokenService, @Inject(QUEUE) private readonly queue: JobQueue) {}

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
    // US-E09-02: an offline fuel entry above tank capacity alerts as soon as it arrives, like an online one.
    if (results.some((r) => r.flags?.includes("tank_exceeded"))) await enqueueAlertScan(this.queue, tenantOf(ctx));
    return { ...(await this.sync.state(db, ctx)), results };
  }

  @Requires("sync.conflict_review") @Get(routes.listSyncConflicts.path)
  async conflicts(@Query(new ZodPipe(routes.listSyncConflicts.query)) q: z.output<typeof routes.listSyncConflicts.query>, @Ctx() ctx: RequestContext) {
    return { items: await this.sync.conflicts(await this.tdb.for(ctx), ctx, q.status) };
  }

  /** US-E14-06: accept / reject / correct, always with a reason; never last-write-wins. */
  @Requires("sync.conflict_review") @Post(routes.resolveSyncConflict.path) @HttpCode(200)
  async resolve(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.resolveSyncConflict.body)) b: z.output<typeof routes.resolveSyncConflict.body>, @Ctx() ctx: RequestContext) {
    return this.sync.resolve(await this.tdb.for(ctx), ctx, id, b);
  }
}
