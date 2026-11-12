import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { and, desc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import type { z } from "zod";
import { DEFAULTS } from "@fleet/config";
import { routes, type Driver } from "@fleet/contracts";
import { schema, newId, type Db } from "@fleet/db";
import { branchFilter, canAccessBranch, formatActivationCode } from "@fleet/domain";
import { Ctx, Requires, tenantOf, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { CONTROL_DB } from "../infra/tokens.js";
import { conflict, forbidden, notFound, uniqueViolation, validation } from "../infra/errors.js";
import { AuthService } from "../auth/auth.service.js";
import { TenantDb } from "./tenant-db.js";

const D = schema.drivers;
const C = schema;

@Controller()
export class DriversController {
  constructor(
    private readonly tdb: TenantDb,
    private readonly auth: AuthService,
    @Inject(CONTROL_DB) private readonly control: Db,
  ) {}

  @Requires("driver.read") @Get(routes.listDrivers.path)
  async list(@Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const where: SQL[] = [];
    if (ctx.scope === "own") {
      if (!ctx.driverId) return { items: [] };
      where.push(eq(D.id, ctx.driverId));
    } else {
      const filter = branchFilter(ctx, ctx.scope!);
      if (filter && !filter.length) return { items: [] };
      if (filter) where.push(inArray(D.branchId, [...filter]));
    }
    const rows = await db.select().from(D).where(and(...where)).orderBy(desc(D.createdAt)).limit(500);
    const active = rows.length
      ? await this.control.select({ identityId: C.devices.identityId }).from(C.devices)
          .where(and(eq(C.devices.tenantId, tenantOf(ctx)), isNull(C.devices.revokedAt), inArray(C.devices.identityId, rows.map((r) => r.identityId))))
      : [];
    const withDevice = new Set(active.map((a) => a.identityId));
    return { items: rows.map((r) => toDriver(r, withDevice.has(r.identityId))) };
  }

  /**
   * Creates the driver in the tenant DB and the login identity + membership in the control plane.
   * Control plane first (it owns the globally unique username); if the tenant insert fails the
   * just-created, never-used identity is removed again.
   */
  @Requires("driver.write") @Post(routes.createDriver.path)
  async create(
    @Body(new ZodPipe(routes.createDriver.body)) b: z.output<typeof routes.createDriver.body>,
    @Ctx() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!canAccessBranch(ctx, ctx.scope!, b.branchId)) throw forbidden("You can only add drivers to your branches");
    const db = await this.tdb.for(ctx);
    const tenantId = tenantOf(ctx);

    if (b.id) {
      const [existing] = await db.select().from(D).where(eq(D.id, b.id));
      if (existing) {
        res.status(200);
        return toDriver(existing, false);
      }
    }
    const [branch] = await db.select({ id: C.branches.id }).from(C.branches).where(eq(C.branches.id, b.branchId));
    if (!branch) throw validation({ branchId: "unknown_branch" });

    const driverId = b.id ?? newId();
    const identityId = newId();
    try {
      await this.control.transaction(async (tx) => {
        await tx.insert(C.identities).values({ id: identityId, username: b.username, displayName: b.fullName });
        await tx.insert(C.memberships).values({ id: newId(), identityId, tenantId, role: "driver", branchIds: [b.branchId], driverId });
      });
    } catch (e) {
      if (uniqueViolation(e) === "identities_username_key") throw conflict("username_taken", "This username is already used", { username: "taken" });
      throw e;
    }

    try {
      const row = await db.transaction(async (tx) => {
        const [d] = await tx.insert(D).values({
          id: driverId, branchId: b.branchId, identityId, fullName: b.fullName, username: b.username, phone: b.phone ?? null, status: "active", createdBy: ctx.identityId,
        }).returning();
        await TenantDb.audit(tx, ctx, "driver.created", "driver", driverId, { fullName: b.fullName, username: b.username, branchId: b.branchId });
        return d!;
      });
      res.status(201);
      return toDriver(row, false);
    } catch (e) {
      await this.control.transaction(async (tx) => {
        await tx.delete(C.memberships).where(eq(C.memberships.identityId, identityId));
        await tx.delete(C.identities).where(eq(C.identities.id, identityId));
      });
      if (uniqueViolation(e)) throw conflict("username_taken", "This username is already used", { username: "taken" });
      throw e;
    }
  }

  /**
   * SEC-005: one-time code valid 24h. Issuing a new code revokes any earlier unused code
   * and the driver's current device (lost-device flow) immediately.
   */
  @Requires("driver.issue_activation") @Post(routes.issueActivationCode.path) @HttpCode(200)
  async issueCode(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const tenantId = tenantOf(ctx);
    const [d] = await db.select().from(D).where(eq(D.id, id));
    if (!d || !canAccessBranch(ctx, ctx.scope!, d.branchId)) throw notFound("driver");
    if (d.status !== "active") throw conflict("driver_inactive", "Driver is not active");

    const code = formatActivationCode(randomBytes(DEFAULTS.ACTIVATION_CODE_LENGTH * 2), DEFAULTS.ACTIVATION_CODE_LENGTH);
    const expiresAt = new Date(Date.now() + DEFAULTS.ACTIVATION_CODE_TTL_HOURS * 3600_000);
    const codeHash = await argon2.hash(code, { type: argon2.argon2id });
    let revokedDevices = 0;
    await this.control.transaction(async (tx) => {
      await tx.update(C.activationCodes).set({ revokedAt: new Date() })
        .where(and(eq(C.activationCodes.identityId, d.identityId), isNull(C.activationCodes.usedAt), isNull(C.activationCodes.revokedAt)));
      revokedDevices = await this.auth.revokeDevices(tx, d.identityId, tenantId);
      await tx.insert(C.activationCodes).values({ id: newId(), identityId: d.identityId, tenantId, codeHash, expiresAt, createdBy: ctx.identityId });
      // Unlock so a driver who locked themselves out can use the new code.
      await tx.update(C.identities).set({ failedAttempts: 0, lockedUntil: null }).where(eq(C.identities.id, d.identityId));
    });
    await db.transaction((tx) => TenantDb.audit(tx, ctx, "driver.activation_code_issued", "driver", d.id, { expiresAt, revokedDevices }));
    return { code, expiresAt: expiresAt.toISOString(), username: d.username };
  }
}

function toDriver(d: typeof D.$inferSelect, hasActiveDevice: boolean): Driver {
  return {
    id: d.id,
    branchId: d.branchId,
    fullName: d.fullName,
    username: d.username,
    phone: d.phone,
    status: d.status,
    hasActiveDevice,
    createdAt: d.createdAt.toISOString(),
  };
}
