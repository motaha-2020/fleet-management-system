import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import argon2 from "argon2";
import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { DEFAULTS, type Role } from "@fleet/config";
import { normalizeActivationCode } from "@fleet/domain";
import { schema, newId, sha256, randomToken, type Db } from "@fleet/db";
import type { SessionUser, TokenResponse } from "@fleet/contracts";
import { CONTROL_DB } from "../infra/tokens.js";
import { AppError, unauthorized, validation } from "../infra/errors.js";
import { TokenService } from "./token.service.js";

const S = schema;
const INVALID = () => new AppError(HttpStatus.UNAUTHORIZED, "invalid_credentials", "Email or password is incorrect");
const LOCKED = () => new AppError(HttpStatus.LOCKED, "account_locked", `Too many failed attempts. Try again in ${DEFAULTS.LOCKOUT_MINUTES} minutes`);

// Verifying against a fixed hash keeps response time similar for unknown accounts.
let dummyHash: Promise<string> | undefined;
const dummy = () => (dummyHash ??= argon2.hash("not-a-real-password-just-timing"));

type Identity = typeof S.identities.$inferSelect;
type Membership = typeof S.memberships.$inferSelect;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface IssuedSession extends TokenResponse { refreshToken: string; refreshExpiresAt: Date }

@Injectable()
export class AuthService {
  constructor(@Inject(CONTROL_DB) private readonly db: Db, private readonly tokens: TokenService) {}

  static hashPassword(p: string) {
    return argon2.hash(p, { type: argon2.argon2id });
  }

  // ---------------- Web login ----------------
  async login(email: string, password: string, tenantSlug?: string): Promise<IssuedSession> {
    const [identity] = await this.db.select().from(S.identities).where(eq(S.identities.email, email.toLowerCase()));
    if (!identity || !identity.passwordHash || identity.disabledAt) {
      await argon2.verify(await dummy(), password).catch(() => false);
      throw INVALID();
    }
    this.assertNotLocked(identity);
    if (!(await argon2.verify(identity.passwordHash, password))) {
      await this.recordFailure(identity, "auth.login_failed");
      throw INVALID();
    }
    await this.recordSuccess(identity, "auth.login");

    if (identity.isPlatformAdmin) return this.issue(identity, null, null, DEFAULTS.WEB_REFRESH_TTL_SECONDS);
    const membership = await this.pickMembership(identity.id, tenantSlug);
    return this.issue(identity, membership, null, DEFAULTS.WEB_REFRESH_TTL_SECONDS);
  }

  private async pickMembership(identityId: string, tenantSlug?: string): Promise<Membership> {
    const rows = await this.db
      .select({ m: S.memberships, slug: S.tenants.slug })
      .from(S.memberships)
      .innerJoin(S.tenants, eq(S.tenants.id, S.memberships.tenantId))
      .where(and(
        eq(S.memberships.identityId, identityId),
        eq(S.memberships.active, true),
        inArray(S.tenants.status, ["active", "suspended"]),
        sql`${S.memberships.role} <> 'driver'`,
      ))
      .orderBy(asc(S.memberships.createdAt));
    const pick = tenantSlug ? rows.find((r) => r.slug === tenantSlug) : rows[0];
    if (!pick) throw new AppError(HttpStatus.FORBIDDEN, "no_active_membership", "Your account has no access to an active company yet");
    return pick.m;
  }

  // ---------------- Invite ----------------
  async acceptInvite(token: string, password: string): Promise<IssuedSession> {
    if (password.length < DEFAULTS.PASSWORD_MIN_LENGTH) throw validation({ password: `min ${DEFAULTS.PASSWORD_MIN_LENGTH} characters` });
    const hash = await AuthService.hashPassword(password);
    const identity = await this.db.transaction(async (tx) => {
      const [inv] = await tx.update(S.invites).set({ usedAt: new Date() })
        .where(and(eq(S.invites.tokenHash, sha256(token)), isNull(S.invites.usedAt), gt(S.invites.expiresAt, new Date())))
        .returning();
      if (!inv) throw new AppError(HttpStatus.BAD_REQUEST, "invalid_invite", "This invite link is invalid, used or expired");
      const [id] = await tx.update(S.identities).set({ passwordHash: hash, failedAttempts: 0, lockedUntil: null })
        .where(eq(S.identities.id, inv.identityId)).returning();
      await tx.insert(S.platformAudit).values({ actorId: inv.identityId, action: "auth.invite_accepted" });
      return id!;
    });
    if (identity.isPlatformAdmin) return this.issue(identity, null, null, DEFAULTS.WEB_REFRESH_TTL_SECONDS);
    return this.issue(identity, await this.pickMembership(identity.id), null, DEFAULTS.WEB_REFRESH_TTL_SECONDS);
  }

  // ---------------- Driver activation (SEC-005) ----------------
  async activateDriver(username: string, code: string, deviceName: string, platform: string): Promise<IssuedSession> {
    const [identity] = await this.db.select().from(S.identities).where(eq(S.identities.username, username.trim().toLowerCase()));
    const BAD = () => new AppError(HttpStatus.UNAUTHORIZED, "invalid_activation", "Username or activation code is incorrect, expired or already used");
    if (!identity || identity.disabledAt) {
      await argon2.verify(await dummy(), code).catch(() => false);
      throw BAD();
    }
    this.assertNotLocked(identity);

    const candidates = await this.db.select().from(S.activationCodes)
      .where(and(eq(S.activationCodes.identityId, identity.id), isNull(S.activationCodes.usedAt), isNull(S.activationCodes.revokedAt), gt(S.activationCodes.expiresAt, new Date())))
      .orderBy(desc(S.activationCodes.expiresAt))
      .limit(1);
    const candidate = candidates[0];
    const normalized = normalizeActivationCode(code);
    if (!candidate || !(await argon2.verify(candidate.codeHash, normalized))) {
      await this.recordFailure(identity, "auth.activation_failed");
      throw BAD();
    }

    const [membership] = await this.db.select().from(S.memberships)
      .innerJoin(S.tenants, eq(S.tenants.id, S.memberships.tenantId))
      .where(and(eq(S.memberships.identityId, identity.id), eq(S.memberships.tenantId, candidate.tenantId), eq(S.memberships.role, "driver"), eq(S.memberships.active, true), eq(S.tenants.status, "active")));
    if (!membership) throw BAD();

    const deviceId = newId();
    await this.db.transaction(async (tx) => {
      // Single use: only one concurrent activation can claim the code.
      const claimed = await tx.update(S.activationCodes).set({ usedAt: new Date() })
        .where(and(eq(S.activationCodes.id, candidate.id), isNull(S.activationCodes.usedAt))).returning({ id: S.activationCodes.id });
      if (!claimed.length) throw BAD();
      await this.revokeDevices(tx, identity.id, candidate.tenantId);
      await tx.insert(S.devices).values({ id: deviceId, identityId: identity.id, tenantId: candidate.tenantId, name: deviceName, platform });
      await tx.update(S.identities).set({ failedAttempts: 0, lockedUntil: null }).where(eq(S.identities.id, identity.id));
      await tx.insert(S.platformAudit).values({ actorId: identity.id, tenantId: candidate.tenantId, action: "auth.device_activated", detail: { deviceId, platform } });
    });
    return this.issue(identity, membership.memberships, deviceId, DEFAULTS.DEVICE_REFRESH_TTL_SECONDS);
  }

  /** Revoke all active devices (and their sessions) of a driver in a tenant. */
  async revokeDevices(tx: Tx | Db, identityId: string, tenantId: string) {
    const revoked = await tx.update(S.devices).set({ revokedAt: new Date() })
      .where(and(eq(S.devices.identityId, identityId), eq(S.devices.tenantId, tenantId), isNull(S.devices.revokedAt)))
      .returning({ id: S.devices.id });
    if (revoked.length) {
      await tx.update(S.refreshTokens).set({ revokedAt: new Date() })
        .where(and(inArray(S.refreshTokens.deviceId, revoked.map((d) => d.id)), isNull(S.refreshTokens.revokedAt)));
    }
    return revoked.length;
  }

  // ---------------- Refresh / logout ----------------
  async refresh(token: string): Promise<IssuedSession> {
    const [rt] = await this.db.select().from(S.refreshTokens).where(eq(S.refreshTokens.tokenHash, sha256(token)));
    if (!rt) throw unauthorized("Session expired");
    if (rt.revokedAt) {
      // Reuse of a rotated token: assume theft and kill the whole session family.
      await this.db.update(S.refreshTokens).set({ revokedAt: new Date() }).where(and(eq(S.refreshTokens.familyId, rt.familyId), isNull(S.refreshTokens.revokedAt)));
      await this.db.insert(S.platformAudit).values({ actorId: rt.identityId, action: "auth.refresh_reuse_detected", detail: { familyId: rt.familyId } });
      throw unauthorized("Session expired");
    }
    if (rt.expiresAt <= new Date()) throw unauthorized("Session expired");

    const [identity] = await this.db.select().from(S.identities).where(eq(S.identities.id, rt.identityId));
    if (!identity || identity.disabledAt) throw unauthorized("Account disabled");
    let membership: Membership | null = null;
    if (rt.membershipId) {
      const [m] = await this.db.select().from(S.memberships).where(eq(S.memberships.id, rt.membershipId));
      if (!m || !m.active) throw unauthorized();
      membership = m;
    }
    const newIdValue = newId();
    const revoked = await this.db.update(S.refreshTokens).set({ revokedAt: new Date(), replacedBy: newIdValue })
      .where(and(eq(S.refreshTokens.id, rt.id), isNull(S.refreshTokens.revokedAt))).returning({ id: S.refreshTokens.id });
    if (!revoked.length) throw unauthorized("Session expired"); // lost a race with a parallel refresh

    const ttl = rt.deviceId ? DEFAULTS.DEVICE_REFRESH_TTL_SECONDS : Math.max(60, Math.floor((rt.expiresAt.getTime() - Date.now()) / 1000));
    return this.issue(identity, membership, rt.deviceId, ttl, { familyId: rt.familyId, id: newIdValue });
  }

  async logout(token: string) {
    await this.db.update(S.refreshTokens).set({ revokedAt: new Date() })
      .where(and(eq(S.refreshTokens.tokenHash, sha256(token)), isNull(S.refreshTokens.revokedAt)));
  }

  // ---------------- Session description ----------------
  async describe(identityId: string, membershipId: string | null): Promise<SessionUser> {
    const [identity] = await this.db.select().from(S.identities).where(eq(S.identities.id, identityId));
    if (!identity) throw unauthorized();
    if (!membershipId) {
      return { identityId, displayName: identity.displayName, role: "platform_admin", tenant: null, branchIds: [], driverId: null };
    }
    const [row] = await this.db.select({ m: S.memberships, t: S.tenants }).from(S.memberships)
      .innerJoin(S.tenants, eq(S.tenants.id, S.memberships.tenantId)).where(eq(S.memberships.id, membershipId));
    if (!row) throw unauthorized();
    return {
      identityId,
      displayName: identity.displayName,
      role: row.m.role as Role,
      tenant: { id: row.t.id, slug: row.t.slug, name: row.t.name, countryCode: row.t.countryCode },
      branchIds: row.m.branchIds,
      driverId: row.m.driverId,
    };
  }

  // ---------------- helpers ----------------
  private assertNotLocked(identity: Identity) {
    if (identity.lockedUntil && identity.lockedUntil > new Date()) throw LOCKED();
  }

  private async recordFailure(identity: Identity, action: string) {
    const [updated] = await this.db.update(S.identities)
      .set({ failedAttempts: sql`${S.identities.failedAttempts} + 1` })
      .where(eq(S.identities.id, identity.id)).returning({ attempts: S.identities.failedAttempts });
    const attempts = updated?.attempts ?? 0;
    if (attempts >= DEFAULTS.LOCKOUT_MAX_ATTEMPTS) {
      await this.db.update(S.identities)
        .set({ lockedUntil: new Date(Date.now() + DEFAULTS.LOCKOUT_MINUTES * 60_000), failedAttempts: 0 })
        .where(eq(S.identities.id, identity.id));
      await this.db.insert(S.platformAudit).values({ actorId: identity.id, action: "auth.locked", detail: { reason: action } });
    }
    await this.db.insert(S.platformAudit).values({ actorId: identity.id, action, detail: { attempts } });
  }

  private async recordSuccess(identity: Identity, action: string) {
    if (identity.failedAttempts || identity.lockedUntil) {
      await this.db.update(S.identities).set({ failedAttempts: 0, lockedUntil: null }).where(eq(S.identities.id, identity.id));
    }
    await this.db.insert(S.platformAudit).values({ actorId: identity.id, action });
  }

  private async issue(
    identity: Identity,
    membership: Membership | null,
    deviceId: string | null,
    refreshTtlSeconds: number,
    rotate?: { familyId: string; id: string },
  ): Promise<IssuedSession> {
    const refreshToken = randomToken(32);
    const refreshExpiresAt = new Date(Date.now() + refreshTtlSeconds * 1000);
    await this.db.insert(S.refreshTokens).values({
      id: rotate?.id ?? newId(),
      identityId: identity.id,
      membershipId: membership?.id ?? null,
      deviceId,
      familyId: rotate?.familyId ?? newId(),
      tokenHash: sha256(refreshToken),
      expiresAt: refreshExpiresAt,
    });
    const access = await this.tokens.signAccess({ sub: identity.id, mid: membership?.id ?? null, tid: membership?.tenantId ?? null, did: deviceId });
    return {
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken,
      refreshExpiresAt,
      user: await this.describe(identity.id, membership?.id ?? null),
    };
  }
}

