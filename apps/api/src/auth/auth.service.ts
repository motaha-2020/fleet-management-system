import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import argon2 from "argon2";
import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { DEFAULTS, MFA_REQUIRED_ROLES, type Role } from "@fleet/config";
import { normalizeActivationCode } from "@fleet/domain";
import { schema, newId, sha256, randomToken, SecretBox, type Db } from "@fleet/db";
import type { MfaChallenge, SessionUser, TokenResponse } from "@fleet/contracts";
import { CONTROL_DB, SECRETS } from "../infra/tokens.js";
import { newTotpSecret, otpauthUrl, verifyTotp } from "./totp.js";
import { AppError, unauthorized, validation } from "../infra/errors.js";
import { TokenService } from "./token.service.js";
import { parseDeviceKey, verifyDeviceProof } from "./device-key.js";

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
export type LoginResult = IssuedSession | MfaChallenge;
export const isChallenge = (r: LoginResult): r is MfaChallenge => "mfaToken" in r;

const MFA_INVALID = () => new AppError(HttpStatus.UNAUTHORIZED, "invalid_mfa_code", "The verification code is incorrect or expired");

@Injectable()
export class AuthService {
  constructor(
    @Inject(CONTROL_DB) private readonly db: Db,
    private readonly tokens: TokenService,
    @Inject(SECRETS) private readonly secrets: SecretBox,
  ) {}

  static hashPassword(p: string) {
    return argon2.hash(p, { type: argon2.argon2id });
  }

  // ---------------- Web login ----------------
  async login(email: string, password: string, tenantSlug?: string): Promise<LoginResult> {
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
    await this.recordSuccess(identity, "auth.password_ok");

    const membership = identity.isPlatformAdmin ? null : await this.pickMembership(identity.id, tenantSlug);
    return this.secondFactorOrSession(identity, membership);
  }

  // ---------------- MFA (SEC-004, US-E02-01) ----------------
  private needsMfa(identity: Identity, membership: Membership | null) {
    const role: Role = membership ? (membership.role as Role) : "platform_admin";
    return (MFA_REQUIRED_ROLES as readonly string[]).includes(role) || !!identity.mfaEnabledAt;
  }

  /** No session is created until the second factor is verified. */
  private async secondFactorOrSession(identity: Identity, membership: Membership | null): Promise<LoginResult> {
    if (!this.needsMfa(identity, membership)) {
      await this.db.insert(S.platformAudit).values({ actorId: identity.id, tenantId: membership?.tenantId, action: "auth.login" });
      return this.issue(identity, membership, null, DEFAULTS.WEB_REFRESH_TTL_SECONDS);
    }
    const mfaToken = await this.tokens.signMfa({ sub: identity.id, mid: membership?.id ?? null });
    if (identity.mfaEnabledAt && identity.mfaSecretEnc) return { mfa: "verify", mfaToken };
    // First login of an MFA role: enrol. The pending secret only becomes active after a correct code.
    const secret = newTotpSecret();
    await this.db.update(S.identities).set({ mfaPendingSecretEnc: this.secrets.seal(secret) }).where(eq(S.identities.id, identity.id));
    return { mfa: "enroll", mfaToken, secret, otpauthUrl: otpauthUrl(secret, identity.email ?? identity.username ?? identity.id) };
  }

  async verifyMfa(mfaToken: string, code: string): Promise<IssuedSession> {
    let claims;
    try {
      claims = await this.tokens.verifyMfa(mfaToken);
    } catch {
      throw new AppError(HttpStatus.UNAUTHORIZED, "mfa_expired", "The sign-in step expired. Please sign in again");
    }
    const [identity] = await this.db.select().from(S.identities).where(eq(S.identities.id, claims.sub));
    if (!identity || identity.disabledAt) throw unauthorized();
    this.assertNotLocked(identity);
    const enrolling = !identity.mfaEnabledAt;
    const sealed = enrolling ? identity.mfaPendingSecretEnc : identity.mfaSecretEnc;
    if (!sealed) throw MFA_INVALID();
    const step = verifyTotp(this.secrets.open(sealed), code, Date.now(), identity.mfaLastStep ?? null);
    if (step === null) {
      await this.recordFailure(identity, "auth.mfa_failed");
      throw MFA_INVALID();
    }
    // Conditional update = the same code cannot complete two logins (replay).
    const updated = await this.db.update(S.identities)
      .set(enrolling
        ? { mfaSecretEnc: sealed, mfaPendingSecretEnc: null, mfaEnabledAt: new Date(), mfaLastStep: step, failedAttempts: 0 }
        : { mfaLastStep: step, failedAttempts: 0 })
      .where(and(eq(S.identities.id, identity.id), sql`coalesce(${S.identities.mfaLastStep}, -1) < ${step}`))
      .returning({ id: S.identities.id });
    if (!updated.length) throw MFA_INVALID();

    let membership: Membership | null = null;
    if (claims.mid) {
      const [m] = await this.db.select().from(S.memberships).where(and(eq(S.memberships.id, claims.mid), eq(S.memberships.identityId, identity.id), eq(S.memberships.active, true)));
      if (!m) throw unauthorized();
      membership = m;
    } else if (!identity.isPlatformAdmin) throw unauthorized();
    await this.db.insert(S.platformAudit).values({ actorId: identity.id, tenantId: membership?.tenantId, action: enrolling ? "auth.mfa_enrolled" : "auth.login", detail: { mfa: true } });
    return this.issue(identity, membership, null, DEFAULTS.WEB_REFRESH_TTL_SECONDS);
  }

  /** SEC-002: one active role at a time. Switching into an MFA role requires a fresh code. */
  async switchRole(identityId: string, membershipId: string, code?: string): Promise<IssuedSession> {
    const [identity] = await this.db.select().from(S.identities).where(eq(S.identities.id, identityId));
    if (!identity || identity.disabledAt) throw unauthorized();
    const [row] = await this.db.select({ m: S.memberships, status: S.tenants.status }).from(S.memberships)
      .innerJoin(S.tenants, eq(S.tenants.id, S.memberships.tenantId))
      .where(and(eq(S.memberships.id, membershipId), eq(S.memberships.identityId, identityId), eq(S.memberships.active, true)));
    if (!row || row.m.role === "driver" || (row.status !== "active" && row.status !== "suspended")) {
      throw new AppError(HttpStatus.FORBIDDEN, "no_such_role", "This role is not available to you");
    }
    // Moving into an MFA-mandatory role needs a fresh code; moving to a lesser role does not.
    if ((MFA_REQUIRED_ROLES as readonly string[]).includes(row.m.role)) {
      if (!identity.mfaEnabledAt || !identity.mfaSecretEnc) throw new AppError(HttpStatus.FORBIDDEN, "mfa_enrollment_required", "Sign out and sign in again to set up two-step verification");
      if (!code) throw new AppError(HttpStatus.UNAUTHORIZED, "mfa_required", "Enter your verification code");
      const step = verifyTotp(this.secrets.open(identity.mfaSecretEnc), code, Date.now(), identity.mfaLastStep ?? null);
      if (step === null) {
        await this.recordFailure(identity, "auth.mfa_failed");
        throw MFA_INVALID();
      }
      await this.db.update(S.identities).set({ mfaLastStep: step }).where(eq(S.identities.id, identityId));
    }
    await this.db.insert(S.platformAudit).values({ actorId: identityId, tenantId: row.m.tenantId, action: "auth.role_switched", detail: { role: row.m.role } });
    return this.issue(identity, row.m, null, DEFAULTS.WEB_REFRESH_TTL_SECONDS);
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
  async acceptInvite(token: string, password: string): Promise<LoginResult> {
    if (password.length < DEFAULTS.PASSWORD_MIN_LENGTH) throw validation({ password: `min ${DEFAULTS.PASSWORD_MIN_LENGTH} characters` });
    const hash = await AuthService.hashPassword(password);
    const identity = await this.db.transaction(async (tx) => {
      const [inv] = await tx.update(S.invites).set({ usedAt: new Date() })
        .where(and(eq(S.invites.tokenHash, sha256(token)), isNull(S.invites.usedAt), gt(S.invites.expiresAt, new Date())))
        .returning();
      if (!inv) throw new AppError(HttpStatus.BAD_REQUEST, "invalid_invite", "This invite link is invalid, used or expired");
      const [id] = await tx.update(S.identities).set({ passwordHash: hash, failedAttempts: 0, lockedUntil: null })
        .where(eq(S.identities.id, inv.identityId)).returning();
      await tx.insert(S.platformAudit).values({ actorId: inv.identityId, tenantId: inv.tenantId, action: "auth.invite_accepted" });
      return { identity: id!, tenantId: inv.tenantId };
    });
    if (identity.identity.isPlatformAdmin) return this.secondFactorOrSession(identity.identity, null);
    const slug = identity.tenantId
      ? (await this.db.select({ slug: S.tenants.slug }).from(S.tenants).where(eq(S.tenants.id, identity.tenantId)))[0]?.slug
      : undefined;
    return this.secondFactorOrSession(identity.identity, await this.pickMembership(identity.identity.id, slug));
  }

  // ---------------- Driver activation (SEC-005) ----------------
  async activateDriver(username: string, code: string, deviceName: string, platform: string, devicePublicKey?: string): Promise<IssuedSession> {
    // A key that is not EC P-256 is a broken client, not a wrong code: refuse before touching the code.
    if (devicePublicKey && !parseDeviceKey(devicePublicKey)) throw validation({ devicePublicKey: "invalid_device_key" });
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
      await tx.insert(S.devices).values({
        id: deviceId, identityId: identity.id, tenantId: candidate.tenantId, name: deviceName, platform,
        ...(devicePublicKey ? { publicKey: devicePublicKey, keyAlg: "ES256" as const } : {}),
      });
      await tx.update(S.identities).set({ failedAttempts: 0, lockedUntil: null }).where(eq(S.identities.id, identity.id));
      await tx.insert(S.platformAudit).values({ actorId: identity.id, tenantId: candidate.tenantId, action: "auth.device_activated", detail: { deviceId, platform, deviceKey: !!devicePublicKey } });
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
  async refresh(token: string, deviceProof?: string): Promise<IssuedSession> {
    const [rt] = await this.db.select().from(S.refreshTokens).where(eq(S.refreshTokens.tokenHash, sha256(token)));
    if (!rt) throw unauthorized("Session expired");
    // SEC-005: a device with a registered key proves it holds the private key. Checked before rotation, and a
    // failure consumes nothing, so a stolen token gains nothing and the real phone keeps working.
    if (rt.deviceId && !rt.revokedAt) {
      const [device] = await this.db.select().from(S.devices).where(eq(S.devices.id, rt.deviceId));
      if (device?.publicKey) {
        const key = parseDeviceKey(device.publicKey);
        if (!deviceProof || !key || !verifyDeviceProof(key, token, deviceProof)) {
          await this.db.insert(S.platformAudit).values({ actorId: rt.identityId, tenantId: device.tenantId, action: "auth.device_proof_failed", detail: { deviceId: device.id, missing: !deviceProof } });
          throw new AppError(HttpStatus.UNAUTHORIZED, "device_proof_invalid", "This session can only be renewed from the activated device");
        }
      }
    }
    if (rt.revokedAt) {
      // Reuse of a rotated token: assume theft and kill the whole session family.
      await this.db.update(S.refreshTokens).set({ revokedAt: new Date() }).where(and(eq(S.refreshTokens.familyId, rt.familyId), isNull(S.refreshTokens.revokedAt)));
      await this.db.insert(S.platformAudit).values({ actorId: rt.identityId, action: "auth.refresh_reuse_detected", detail: { familyId: rt.familyId } });
      throw unauthorized("Session expired");
    }
    if (rt.expiresAt <= new Date()) throw unauthorized("Session expired");
    // D-SEC-WEBIDLE: each refresh rotates the token, so its age = time since the last activity.
    if (!rt.deviceId && Date.now() - rt.createdAt.getTime() > DEFAULTS.WEB_IDLE_MINUTES * 60_000) {
      await this.db.update(S.refreshTokens).set({ revokedAt: new Date() }).where(eq(S.refreshTokens.id, rt.id));
      throw new AppError(HttpStatus.UNAUTHORIZED, "session_idle", "Signed out after 30 minutes of inactivity");
    }

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
    const all = await this.db.select({ m: S.memberships, t: S.tenants }).from(S.memberships)
      .innerJoin(S.tenants, eq(S.tenants.id, S.memberships.tenantId))
      .where(and(eq(S.memberships.identityId, identityId), eq(S.memberships.active, true), inArray(S.tenants.status, ["active", "suspended"])))
      .orderBy(asc(S.memberships.createdAt));
    const memberships = all.filter((r) => r.m.role !== "driver" || r.m.id === membershipId)
      .map((r) => ({ id: r.m.id, role: r.m.role as Role, tenantSlug: r.t.slug, tenantName: r.t.name }));
    const base = { identityId, displayName: identity.displayName, mfaEnabled: !!identity.mfaEnabledAt, memberships, currentMembershipId: membershipId };
    if (!membershipId) {
      return { ...base, role: "platform_admin", tenant: null, branchIds: [], driverId: null };
    }
    const row = all.find((r) => r.m.id === membershipId);
    if (!row) throw unauthorized();
    return {
      ...base,
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

