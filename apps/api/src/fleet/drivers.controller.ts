import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { and, desc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import type { z } from "zod";
import { COUNTRY_TEMPLATES, DEFAULTS, type CountryTemplate } from "@fleet/config";
import { routes, type Driver } from "@fleet/contracts";
import { schema, newId, type Db } from "@fleet/db";
import {
  branchFilter, canAccessBranch, driverEligibility, formatActivationCode, isValidEgyptianNationalId, localDate,
  maskNationalId, normalizeEgyptianNationalId,
} from "@fleet/domain";
import { Ctx, Requires, tenantOf, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { CONTROL_DB } from "../infra/tokens.js";
import { conflict, forbidden, notFound, uniqueViolation, validation } from "../infra/errors.js";
import { TenantKeys, type TenantCrypto } from "../infra/tenant-keys.js";
import { AuthService } from "../auth/auth.service.js";
import { TenantDb, type Tx } from "./tenant-db.js";

const D = schema.drivers;
const C = schema;
type Row = typeof D.$inferSelect;

@Controller()
export class DriversController {
  constructor(
    private readonly tdb: TenantDb,
    private readonly auth: AuthService,
    private readonly keys: TenantKeys,
    @Inject(CONTROL_DB) private readonly control: Db,
  ) {}

  private async company(db: Db) {
    const [company] = await db.select().from(C.company).limit(1);
    const country = COUNTRY_TEMPLATES[company?.countryCode ?? ""];
    if (!company || !country) throw new Error("tenant has no country template");
    return { company, country, today: localDate(new Date(), company.timezone) };
  }

  private async devicesOf(tenantId: string, identityIds: string[]) {
    if (!identityIds.length) return new Set<string>();
    const active = await this.control.select({ identityId: C.devices.identityId }).from(C.devices)
      .where(and(eq(C.devices.tenantId, tenantId), isNull(C.devices.revokedAt), inArray(C.devices.identityId, identityIds)));
    return new Set(active.map((a) => a.identityId));
  }

  private toDriver(d: Row, hasActiveDevice: boolean, today: string): Driver {
    return {
      id: d.id, branchId: d.branchId, fullName: d.fullName, username: d.username, phone: d.phone,
      status: d.status, employmentStatus: d.employmentStatus, employeeRef: d.employeeRef,
      nationalIdMasked: d.nationalIdMask, licenseNumber: d.licenseNumber, licenseCategories: d.licenseCategories,
      licenseExpiry: d.licenseExpiry,
      eligibility: driverEligibility({ employmentStatus: d.employmentStatus, licenseExpiry: d.licenseExpiry, licenseCategories: d.licenseCategories }, today, DEFAULTS.DOC_GRACE_DAYS),
      hasActiveDevice, createdAt: d.createdAt.toISOString(),
    };
  }

  /** Validates and encrypts the national ID (DRV-007); returns the columns to store. */
  private sensitiveColumns(nationalId: string | null | undefined, country: CountryTemplate, crypto: TenantCrypto) {
    if (nationalId === undefined) return {};
    if (nationalId === null || nationalId === "") return { nationalIdEnc: null, nationalIdBidx: null, nationalIdMask: null };
    const id = normalizeEgyptianNationalId(nationalId);
    if (country.code === "EG" && !isValidEgyptianNationalId(id)) throw validation({ nationalId: "invalid_national_id" });
    return { nationalIdEnc: crypto.box.seal(id), nationalIdBidx: crypto.blindIndex(`${country.code}:${id}`), nationalIdMask: maskNationalId(id) };
  }

  private checkLicenseCategories(cats: readonly string[] | undefined, country: CountryTemplate) {
    if (!cats) return;
    const known = new Set(country.licenseCategories.map((l) => l.code));
    if (cats.some((c) => !known.has(c))) throw validation({ licenseCategories: "unknown_license_category" });
  }

  private mapUnique(e: unknown): never {
    const c = uniqueViolation(e);
    if (c === "drivers_national_id_uq") throw conflict("duplicate", "Another driver has this national ID", { nationalId: "duplicate" });
    if (c === "drivers_employee_ref_uq") throw conflict("duplicate", "Another driver has this employee number", { employeeRef: "duplicate" });
    if (c) throw conflict("username_taken", "This username is already used", { username: "taken" });
    throw e;
  }

  private async lockInScope(tx: Tx, ctx: RequestContext, id: string) {
    const [d] = await tx.select().from(D).where(eq(D.id, id)).for("update");
    if (!d || !canAccessBranch(ctx, ctx.scope!, d.branchId) || (ctx.scope === "own" && ctx.driverId !== d.id)) throw notFound("driver");
    return d;
  }

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
    const { today } = await this.company(db);
    const rows = await db.select().from(D).where(and(...where)).orderBy(desc(D.createdAt)).limit(500);
    const withDevice = await this.devicesOf(tenantOf(ctx), rows.map((r) => r.identityId));
    return { items: rows.map((r) => this.toDriver(r, withDevice.has(r.identityId), today)) };
  }

  @Requires("driver.read") @Get(routes.getDriver.path)
  async get(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const [d] = await db.select().from(D).where(eq(D.id, id));
    if (!d || !canAccessBranch(ctx, ctx.scope!, d.branchId) || (ctx.scope === "own" && ctx.driverId !== d.id)) throw notFound("driver");
    const { today } = await this.company(db);
    return this.toDriver(d, (await this.devicesOf(tenantOf(ctx), [d.identityId])).has(d.identityId), today);
  }

  /**
   * Driver record (tenant DB) is separate from the login identity (control plane) — DRV-002.
   * Control plane first (it owns the globally unique username); if the tenant insert fails the
   * just-created, never-used identity is removed again.
   */
  @Requires("driver.write") @Post(routes.createDriver.path)
  async create(@Body(new ZodPipe(routes.createDriver.body)) b: z.output<typeof routes.createDriver.body>, @Ctx() ctx: RequestContext, @Res({ passthrough: true }) res: Response) {
    if (!canAccessBranch(ctx, ctx.scope!, b.branchId)) throw forbidden("You can only add drivers to your branches");
    const db = await this.tdb.for(ctx);
    const tenantId = tenantOf(ctx);
    const { country, today } = await this.company(db);

    if (b.id) {
      const [existing] = await db.select().from(D).where(eq(D.id, b.id));
      if (existing) {
        if (!canAccessBranch(ctx, ctx.scope!, existing.branchId)) throw conflict("id_in_use", "This id is already used");
        res.status(200);
        return this.toDriver(existing, false, today);
      }
    }
    const [branch] = await db.select({ id: C.branches.id }).from(C.branches).where(eq(C.branches.id, b.branchId));
    if (!branch) throw validation({ branchId: "unknown_branch" });
    this.checkLicenseCategories(b.licenseCategories, country);
    const sensitive = this.sensitiveColumns(b.nationalId, country, await this.keys.for(tenantId));

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
          id: driverId, branchId: b.branchId, identityId, fullName: b.fullName, username: b.username, phone: b.phone ?? null, status: "active",
          employeeRef: b.employeeRef ?? null, licenseNumber: b.licenseNumber ?? null, licenseCategories: b.licenseCategories, licenseExpiry: b.licenseExpiry ?? null,
          ...sensitive, createdBy: ctx.identityId,
        }).returning();
        // The audit trail never contains the plaintext national ID.
        await TenantDb.audit(tx, ctx, "driver.created", "driver", driverId, this.auditView(d!), null, d!.branchId);
        return d!;
      });
      res.status(201);
      return this.toDriver(row, false, today);
    } catch (e) {
      await this.control.transaction(async (tx) => {
        await tx.delete(C.memberships).where(eq(C.memberships.identityId, identityId));
        await tx.delete(C.identities).where(eq(C.identities.id, identityId));
      });
      this.mapUnique(e);
    }
  }

  @Requires("driver.write") @Patch(routes.updateDriver.path)
  async update(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.updateDriver.body)) b: z.output<typeof routes.updateDriver.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const tenantId = tenantOf(ctx);
    const { country, today } = await this.company(db);
    if (b.branchId && !canAccessBranch(ctx, ctx.scope!, b.branchId)) throw forbidden("You need access to the destination branch");
    this.checkLicenseCategories(b.licenseCategories, country);
    const sensitive = this.sensitiveColumns(b.nationalId, country, await this.keys.for(tenantId));
    try {
      const { row, before } = await db.transaction(async (tx) => {
        const before = await this.lockInScope(tx, ctx, id);
        if (b.branchId) {
          const [branch] = await tx.select({ id: C.branches.id }).from(C.branches).where(eq(C.branches.id, b.branchId));
          if (!branch) throw validation({ branchId: "unknown_branch" });
        }
        const { nationalId: _omit, ...rest } = b;
        const [row] = await tx.update(D).set({ ...rest, ...sensitive, updatedAt: new Date() }).where(eq(D.id, id)).returning();
        await TenantDb.audit(tx, ctx, "driver.updated", "driver", id, this.auditView(row!), this.auditView(before), row!.branchId);
        return { row: row!, before };
      });
      if (row.branchId !== before.branchId) {
        await this.control.update(C.memberships).set({ branchIds: [row.branchId], updatedAt: new Date() })
          .where(and(eq(C.memberships.identityId, row.identityId), eq(C.memberships.tenantId, tenantId)));
      }
      // A terminated driver cannot keep logging in; the record and its history stay (DRV-002/003).
      if (row.employmentStatus === "terminated" && before.employmentStatus !== "terminated") await this.setAccount(ctx, row, false);
      return this.get(id, ctx);
    } catch (e) {
      if (uniqueViolation(e)) this.mapUnique(e);
      throw e;
    }
  }

  /** DRV-002: disabling the login keeps all operational history; sessions and devices end at once. */
  @Requires("driver.write") @Post(routes.setDriverAccount.path) @HttpCode(200)
  async account(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.setDriverAccount.body)) b: z.output<typeof routes.setDriverAccount.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const d = await db.transaction((tx) => this.lockInScope(tx, ctx, id));
    if (b.active && d.employmentStatus === "terminated") throw conflict("driver_terminated", "A terminated driver cannot be given access");
    await this.setAccount(ctx, d, b.active);
    return this.get(id, ctx);
  }

  private async setAccount(ctx: RequestContext, d: Row, active: boolean) {
    const tenantId = tenantOf(ctx);
    await this.control.transaction(async (tx) => {
      await tx.update(C.memberships).set({ active, updatedAt: new Date() }).where(and(eq(C.memberships.identityId, d.identityId), eq(C.memberships.tenantId, tenantId)));
      if (!active) {
        await this.auth.revokeDevices(tx, d.identityId, tenantId);
        await tx.update(C.activationCodes).set({ revokedAt: new Date() })
          .where(and(eq(C.activationCodes.identityId, d.identityId), isNull(C.activationCodes.usedAt), isNull(C.activationCodes.revokedAt)));
      }
    });
    const db = await this.tdb.for(ctx);
    await db.transaction(async (tx) => {
      await tx.update(D).set({ status: active ? "active" : "inactive", updatedAt: new Date() }).where(eq(D.id, d.id));
      await TenantDb.audit(tx, ctx, active ? "driver.account_enabled" : "driver.account_disabled", "driver", d.id, null, null, d.branchId);
    });
  }

  /** US-E06-04: reveal needs its own permission and leaves an audit event with the field and time. */
  @Requires("driver.view_sensitive") @Post(routes.revealDriverSensitive.path) @HttpCode(200)
  async reveal(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const [d] = await db.select().from(D).where(eq(D.id, id));
    if (!d || !canAccessBranch(ctx, ctx.scope!, d.branchId)) throw notFound("driver");
    const value = d.nationalIdEnc ? (await this.keys.for(tenantOf(ctx))).box.open(d.nationalIdEnc) : null;
    await TenantDb.audit(db, ctx, "driver.sensitive_revealed", "driver", id, { field: "nationalId" }, null, d.branchId);
    return { nationalId: value };
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
    if (d.status !== "active") throw conflict("driver_inactive", "The driver's account is disabled");
    if (d.employmentStatus === "terminated") throw conflict("driver_terminated", "The driver is terminated");

    const code = formatActivationCode(randomBytes(DEFAULTS.ACTIVATION_CODE_LENGTH * 2), DEFAULTS.ACTIVATION_CODE_LENGTH);
    const expiresAt = new Date(Date.now() + DEFAULTS.ACTIVATION_CODE_TTL_HOURS * 3600_000);
    const codeHash = await argon2.hash(code, { type: argon2.argon2id });
    let revokedDevices = 0;
    await this.control.transaction(async (tx) => {
      await tx.update(C.activationCodes).set({ revokedAt: new Date() })
        .where(and(eq(C.activationCodes.identityId, d.identityId), isNull(C.activationCodes.usedAt), isNull(C.activationCodes.revokedAt)));
      revokedDevices = await this.auth.revokeDevices(tx, d.identityId, tenantId);
      await tx.insert(C.activationCodes).values({ id: newId(), identityId: d.identityId, tenantId, codeHash, expiresAt, createdBy: ctx.identityId });
      await tx.update(C.identities).set({ failedAttempts: 0, lockedUntil: null }).where(eq(C.identities.id, d.identityId));
    });
    await TenantDb.audit(db, ctx, "driver.activation_code_issued", "driver", d.id, { expiresAt, revokedDevices }, null, d.branchId);
    return { code, expiresAt: expiresAt.toISOString(), username: d.username };
  }

  private auditView(d: Row) {
    return {
      fullName: d.fullName, branchId: d.branchId, phone: d.phone, employeeRef: d.employeeRef, nationalId: d.nationalIdMask,
      licenseNumber: d.licenseNumber, licenseCategories: d.licenseCategories, licenseExpiry: d.licenseExpiry, employmentStatus: d.employmentStatus,
    };
  }
}
