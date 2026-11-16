import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import argon2 from "argon2";
import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { DEFAULTS, type Role } from "@fleet/config";
import { normalizeActivationCode } from "@fleet/domain";
import { schema, newId, sha256, randomToken, type Db } from "@fleet/db";
import type { MfaChallenge, SessionUser, TokenResponse } from "@fleet/contracts";
import { CONFIG, CONTROL_DB, MAILER } from "../infra/tokens.js";
import type { AppConfig } from "../config.js";
import { AppError, unauthorized, validation } from "../infra/errors.js";
import { mailConfigured, type Mailer } from "../infra/mailer.js";
import { TokenService } from "./token.service.js";
import { parseDeviceKey, verifyDeviceProof } from "./device-key.js";
import { PasswordPolicy } from "./password-policy.js";
import { OpsLog } from "../infra/ops-log.js";
import { PermissionService } from "./permissions.service.js";
import { randomInt } from "node:crypto";

const S = schema;
const INVALID = () => new AppError(HttpStatus.UNAUTHORIZED, "invalid_credentials", "Email or password is incorrect");
const LOCKED = () => new AppError(HttpStatus.LOCKED, "account_locked", `Too many failed attempts. Try again in ${DEFAULTS.LOCKOUT_MINUTES} minutes`);
const CODE_INVALID = () => new AppError(HttpStatus.UNAUTHORIZED, "invalid_mfa_code", "The code is incorrect or expired");
const SESSION_EXPIRED = () => new AppError(HttpStatus.UNAUTHORIZED, "session_expired", "Session expired");

// Verifying against a fixed hash keeps response time similar for unknown accounts.
let dummyHash: Promise<string> | undefined;
const dummy = () => (dummyHash ??= argon2.hash("not-a-real-password-just-timing"));

/** m***d@gmail.com — enough to recognise the address, not to learn it. */
export function maskEmail(email: string) {
  const [user = "", domain = ""] = email.split("@");
  return `${user.slice(0, 1)}***${user.length > 2 ? user.slice(-1) : ""}@${domain}`;
}
const codeHash = (identityId: string, code: string) => sha256(`login-code:${identityId}:${code}`);

type Identity = typeof S.identities.$inferSelect;
type Membership = typeof S.memberships.$inferSelect;
type RefreshRow = typeof S.refreshTokens.$inferSelect;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** 12 characters from an alphabet without look-alikes (no 0/O, 1/l/I), shown as 4-4-4 so it can be read out. */
export function temporaryPassword(): string {
  const A = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const c = Array.from({ length: 12 }, () => A[randomInt(0, A.length)]).join("");
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
}

/** A browser that passed the email code gets this token (HttpOnly cookie) and is not asked again. */
export interface TrustedToken { token: string; expiresAt: Date }
export interface IssuedSession extends TokenResponse { refreshToken: string; refreshExpiresAt: Date; trusted?: TrustedToken }
export type LoginResult = IssuedSession | MfaChallenge;
export const isChallenge = (r: LoginResult): r is MfaChallenge => "mfaToken" in r;
/** What the browser brings to a web sign-in. */
export interface WebSignIn { remember?: boolean; trustedToken?: string | null; userAgent?: string | null }

@Injectable()
export class AuthService {
  constructor(
    @Inject(CONTROL_DB) private readonly db: Db,
    private readonly tokens: TokenService,
    private readonly passwords: PasswordPolicy,
    private readonly ops: OpsLog,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly perms: PermissionService,
  ) {}

  static hashPassword(p: string) {
    return argon2.hash(p, { type: argon2.argon2id });
  }

  // ---------------- Web sign-in ----------------
  async login(email: string, password: string, tenantSlug?: string, web: WebSignIn = {}): Promise<LoginResult> {
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
    return this.codeOrSession(identity, membership, web);
  }

  /**
   * Owner decision (13 Nov 2026): no authenticator app. A browser that is not trusted yet gets a 6-digit code
   * by email; once it is entered, the browser is trusted for TRUSTED_DEVICE_DAYS. When email cannot be sent
   * at all (no SMTP set), the code is skipped rather than locking everyone out; that is logged.
   */
  private async codeOrSession(identity: Identity, membership: Membership | null, web: WebSignIn): Promise<LoginResult> {
    const trusted = web.trustedToken ? await this.isTrusted(identity.id, web.trustedToken) : false;
    const canMail = !!identity.email && (await mailConfigured(this.mailer));
    // A temporary password came from an admin out of band (often because the email is not reachable): no email
    // code; the person must choose a new password before anything else (AuthGuard).
    if (identity.mustChangePassword) {
      await this.db.insert(S.platformAudit).values({ actorId: identity.id, tenantId: membership?.tenantId, action: "auth.login_temporary_password" });
      return this.webSession(identity, membership, false);
    }
    if (trusted || !canMail) {
      await this.db.insert(S.platformAudit).values({ actorId: identity.id, tenantId: membership?.tenantId, action: "auth.login", detail: { trustedDevice: trusted, ...(!trusted ? { codeSkipped: "email_not_configured" } : {}) } });
      return this.webSession(identity, membership, !!web.remember);
    }
    await this.sendLoginCode(identity, membership?.id ?? null, !!web.remember);
    const mfaToken = await this.tokens.signMfa({ sub: identity.id, mid: membership?.id ?? null });
    return { mfa: "email", mfaToken, emailHint: maskEmail(identity.email!) };
  }

  /** A new code replaces any open one; the email is in the account's language. */
  private async sendLoginCode(identity: Identity, membershipId: string | null, remember: boolean) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.db.transaction(async (tx) => {
      await tx.update(S.loginCodes).set({ usedAt: new Date() }).where(and(eq(S.loginCodes.identityId, identity.id), isNull(S.loginCodes.usedAt)));
      await tx.insert(S.loginCodes).values({
        id: newId(), identityId: identity.id, membershipId, codeHash: codeHash(identity.id, code), remember,
        expiresAt: new Date(Date.now() + DEFAULTS.LOGIN_CODE_TTL_MINUTES * 60_000),
      });
    });
    const ar = identity.locale !== "en";
    const minutes = DEFAULTS.LOGIN_CODE_TTL_MINUTES;
    try {
      await this.mailer.send({
        to: identity.email!, locale: ar ? "ar" : "en",
        subject: ar ? `كود الدخول: ${code}` : `Your sign-in code: ${code}`,
        text: ar
          ? `مرحبًا ${identity.displayName}،\n\nكود الدخول لمنصة الأسطول: ${code}\nصالح لمدة ${minutes} دقائق. لو ما طلبتش الدخول، تجاهل الرسالة دي وغيّر كلمة السر.\n`
          : `Hello ${identity.displayName},\n\nYour fleet platform sign-in code: ${code}\nIt works for ${minutes} minutes. If you did not try to sign in, ignore this email and change your password.\n`,
      });
    } catch (e) {
      await this.ops.record({ tenantId: null, kind: "notification", severity: "error", code: "login_code_email_failed", detail: { identityId: identity.id, error: (e as Error).message.slice(0, 300) } });
      throw new AppError(HttpStatus.SERVICE_UNAVAILABLE, "email_send_failed", "The sign-in code could not be emailed. Try again shortly");
    }
    await this.db.insert(S.platformAudit).values({ actorId: identity.id, action: "auth.login_code_sent" });
  }

  private async challengeIdentity(mfaToken: string) {
    let claims;
    try {
      claims = await this.tokens.verifyMfa(mfaToken);
    } catch {
      throw new AppError(HttpStatus.UNAUTHORIZED, "mfa_expired", "The sign-in step expired. Please sign in again");
    }
    const [identity] = await this.db.select().from(S.identities).where(eq(S.identities.id, claims.sub));
    if (!identity || identity.disabledAt) throw unauthorized();
    this.assertNotLocked(identity);
    return { claims, identity };
  }

  async verifyMfa(mfaToken: string, code: string, web: WebSignIn = {}): Promise<IssuedSession> {
    const { claims, identity } = await this.challengeIdentity(mfaToken);
    const [row] = await this.db.select().from(S.loginCodes)
      .where(and(eq(S.loginCodes.identityId, identity.id), isNull(S.loginCodes.usedAt), gt(S.loginCodes.expiresAt, new Date())))
      .orderBy(desc(S.loginCodes.createdAt)).limit(1);
    if (!row || row.attempts >= DEFAULTS.LOGIN_CODE_MAX_ATTEMPTS) throw CODE_INVALID();
    if (row.codeHash !== codeHash(identity.id, code)) {
      await this.db.update(S.loginCodes).set({ attempts: sql`${S.loginCodes.attempts} + 1` }).where(eq(S.loginCodes.id, row.id));
      await this.recordFailure(identity, "auth.login_code_failed");
      throw CODE_INVALID();
    }
    // Single use: only one request can claim the code.
    const claimed = await this.db.update(S.loginCodes).set({ usedAt: new Date() })
      .where(and(eq(S.loginCodes.id, row.id), isNull(S.loginCodes.usedAt))).returning({ id: S.loginCodes.id });
    if (!claimed.length) throw CODE_INVALID();
    await this.recordSuccess(identity, "auth.login_code_ok");

    let membership: Membership | null = null;
    if (claims.mid) {
      const [m] = await this.db.select().from(S.memberships).where(and(eq(S.memberships.id, claims.mid), eq(S.memberships.identityId, identity.id), eq(S.memberships.active, true)));
      if (!m) throw unauthorized();
      membership = m;
    } else if (!identity.isPlatformAdmin) throw unauthorized();
    await this.db.insert(S.platformAudit).values({ actorId: identity.id, tenantId: membership?.tenantId, action: "auth.login", detail: { emailCode: true, remember: row.remember } });
    const session = await this.webSession(identity, membership, row.remember);
    return { ...session, trusted: await this.trust(identity.id, web.userAgent ?? null) };
  }

  /** A new code for the same sign-in step, at most once per LOGIN_CODE_RESEND_SECONDS. */
  async resendCode(mfaToken: string) {
    const { claims, identity } = await this.challengeIdentity(mfaToken);
    const [last] = await this.db.select().from(S.loginCodes).where(eq(S.loginCodes.identityId, identity.id)).orderBy(desc(S.loginCodes.createdAt)).limit(1);
    if (last && Date.now() - last.createdAt.getTime() < DEFAULTS.LOGIN_CODE_RESEND_SECONDS * 1000) {
      throw new AppError(HttpStatus.TOO_MANY_REQUESTS, "code_resend_too_soon", "Wait a minute before asking for a new code");
    }
    if (!identity.email) throw unauthorized();
    await this.sendLoginCode(identity, claims.mid, last?.remember ?? false);
  }

  private async isTrusted(identityId: string, token: string) {
    const [row] = await this.db.update(S.trustedDevices).set({ lastUsedAt: new Date() })
      .where(and(eq(S.trustedDevices.tokenHash, sha256(token)), eq(S.trustedDevices.identityId, identityId), isNull(S.trustedDevices.revokedAt), gt(S.trustedDevices.expiresAt, new Date())))
      .returning({ id: S.trustedDevices.id });
    return !!row;
  }

  async trust(identityId: string, userAgent: string | null): Promise<TrustedToken> {
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + DEFAULTS.TRUSTED_DEVICE_DAYS * 86_400_000);
    await this.db.insert(S.trustedDevices).values({ id: newId(), identityId, tokenHash: sha256(token), userAgent: userAgent?.slice(0, 300) ?? null, expiresAt });
    return { token, expiresAt };
  }

  /** 24 hours, or 30 days renewed on every use with "keep me signed in". */
  webSession(identity: Identity, membership: Membership | null, remember: boolean) {
    return this.issue(identity, membership, null, remember ? DEFAULTS.WEB_REMEMBER_TTL_SECONDS : DEFAULTS.WEB_REFRESH_TTL_SECONDS, undefined, remember);
  }

  /** SEC-002: one active role at a time. The new role keeps the session's "keep me signed in". */
  async switchRole(identityId: string, membershipId: string, currentRefreshToken?: string): Promise<IssuedSession> {
    const [identity] = await this.db.select().from(S.identities).where(eq(S.identities.id, identityId));
    if (!identity || identity.disabledAt) throw unauthorized();
    const [row] = await this.db.select({ m: S.memberships, status: S.tenants.status }).from(S.memberships)
      .innerJoin(S.tenants, eq(S.tenants.id, S.memberships.tenantId))
      .where(and(eq(S.memberships.id, membershipId), eq(S.memberships.identityId, identityId), eq(S.memberships.active, true)));
    if (!row || row.m.role === "driver" || (row.status !== "active" && row.status !== "suspended")) {
      throw new AppError(HttpStatus.FORBIDDEN, "no_such_role", "This role is not available to you");
    }
    const [current] = currentRefreshToken ? await this.db.select({ persistent: S.refreshTokens.persistent }).from(S.refreshTokens).where(eq(S.refreshTokens.tokenHash, sha256(currentRefreshToken))) : [];
    await this.db.insert(S.platformAudit).values({ actorId: identityId, tenantId: row.m.tenantId, action: "auth.role_switched", detail: { role: row.m.role } });
    return this.webSession(identity, row.m, !!current?.persistent);
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
  /** The invite link came by email, so it already proves the address: sign in and trust this browser. */
  async acceptInvite(token: string, password: string, web: WebSignIn = {}): Promise<IssuedSession> {
    // D-SEC-PWD before the invite is consumed, so a refused password can be retried with the same link.
    await this.passwords.assertAcceptable(password);
    const hash = await AuthService.hashPassword(password);
    const accepted = await this.db.transaction(async (tx) => {
      const [inv] = await tx.update(S.invites).set({ usedAt: new Date() })
        .where(and(eq(S.invites.tokenHash, sha256(token)), isNull(S.invites.usedAt), gt(S.invites.expiresAt, new Date())))
        .returning();
      if (!inv) throw new AppError(HttpStatus.BAD_REQUEST, "invalid_invite", "This invite link is invalid, used or expired");
      const [id] = await tx.update(S.identities).set({ passwordHash: hash, failedAttempts: 0, lockedUntil: null })
        .where(eq(S.identities.id, inv.identityId)).returning();
      await tx.insert(S.platformAudit).values({ actorId: inv.identityId, tenantId: inv.tenantId, action: "auth.invite_accepted" });
      return { identity: id!, tenantId: inv.tenantId };
    });
    const { identity, tenantId } = accepted;
    let membership: Membership | null = null;
    if (!identity.isPlatformAdmin) {
      const slug = tenantId ? (await this.db.select({ slug: S.tenants.slug }).from(S.tenants).where(eq(S.tenants.id, tenantId)))[0]?.slug : undefined;
      membership = await this.pickMembership(identity.id, slug);
    }
    const session = await this.webSession(identity, membership, !!web.remember);
    return { ...session, trusted: await this.trust(identity.id, web.userAgent ?? null) };
  }

  // ---------------- Password reset ----------------
  /** A reset link (single use). By email ("forgot password", 1 h) or made by an admin (24 h). */
  async createResetLink(identityId: string, createdBy: string | null) {
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + (createdBy ? DEFAULTS.PASSWORD_RESET_ADMIN_TTL_HOURS * 3_600_000 : DEFAULTS.PASSWORD_RESET_TTL_MINUTES * 60_000));
    await this.db.transaction(async (tx) => {
      // Only the newest link works.
      await tx.update(S.passwordResets).set({ usedAt: new Date() }).where(and(eq(S.passwordResets.identityId, identityId), isNull(S.passwordResets.usedAt)));
      await tx.insert(S.passwordResets).values({ id: newId(), identityId, tokenHash: sha256(token), createdBy, expiresAt });
      await tx.insert(S.platformAudit).values({ actorId: createdBy ?? identityId, action: createdBy ? "auth.reset_link_created" : "auth.reset_requested", detail: { identityId } });
    });
    return { link: `${this.config.webUrl}/reset-password?token=${encodeURIComponent(token)}`, expiresAt };
  }

  /** Emails a reset link in the account's language; false when it could not be sent. */
  async emailResetLink(identity: Pick<Identity, "id" | "email" | "displayName" | "locale">, link: string, byAdmin: boolean) {
    if (!identity.email || !(await mailConfigured(this.mailer))) return false;
    const ar = identity.locale !== "en";
    try {
      await this.mailer.send({
        to: identity.email, locale: ar ? "ar" : "en",
        subject: ar ? "إعادة تعيين كلمة السر — منصة الأسطول" : "Reset your password — fleet platform",
        text: ar
          ? `مرحبًا ${identity.displayName}،\n\n${byAdmin ? "مدير الحساب جهّز لك رابط" : "وصلنا طلب"} لإعادة تعيين كلمة السر. افتح الرابط واختر كلمة سر جديدة (12 حرفًا على الأقل). الرابط يُستخدم مرة واحدة.\n\n${link}\n\nلو ما طلبتش ده، تجاهل الرسالة.\n`
          : `Hello ${identity.displayName},\n\n${byAdmin ? "Your administrator made a link" : "We received a request"} to reset your password. Open the link and choose a new password (at least 12 characters). The link works once.\n\n${link}\n\nIf you did not ask for this, ignore this email.\n`,
      });
      return true;
    } catch (e) {
      await this.ops.record({ tenantId: null, kind: "notification", severity: "error", code: "reset_email_failed", detail: { identityId: identity.id, error: (e as Error).message.slice(0, 300) } });
      return false;
    }
  }

  /** Same answer whether or not the email exists (no account discovery). */
  async forgotPassword(email: string) {
    const [identity] = await this.db.select().from(S.identities).where(eq(S.identities.email, email.toLowerCase()));
    if (!identity || identity.disabledAt) return;
    const { link } = await this.createResetLink(identity.id, null);
    await this.emailResetLink(identity, link, false);
  }

  /** New password; every other web session of the person ends and the lock is cleared. */
  async resetPassword(token: string, password: string) {
    await this.passwords.assertAcceptable(password);
    const hash = await AuthService.hashPassword(password);
    await this.db.transaction(async (tx) => {
      const [r] = await tx.update(S.passwordResets).set({ usedAt: new Date() })
        .where(and(eq(S.passwordResets.tokenHash, sha256(token)), isNull(S.passwordResets.usedAt), gt(S.passwordResets.expiresAt, new Date())))
        .returning();
      if (!r) throw new AppError(HttpStatus.BAD_REQUEST, "invalid_reset", "This reset link is invalid, used or expired");
      const [identity] = await tx.update(S.identities).set({ passwordHash: hash, failedAttempts: 0, lockedUntil: null })
        .where(and(eq(S.identities.id, r.identityId), isNull(S.identities.disabledAt))).returning({ id: S.identities.id });
      if (!identity) throw new AppError(HttpStatus.BAD_REQUEST, "invalid_reset", "This reset link is invalid, used or expired");
      await tx.update(S.refreshTokens).set({ revokedAt: new Date() })
        .where(and(eq(S.refreshTokens.identityId, r.identityId), isNull(S.refreshTokens.deviceId), isNull(S.refreshTokens.revokedAt)));
      // A link opened in someone else's mailbox must not leave their browsers trusted.
      await tx.update(S.trustedDevices).set({ revokedAt: new Date() }).where(and(eq(S.trustedDevices.identityId, r.identityId), isNull(S.trustedDevices.revokedAt)));
      await tx.insert(S.platformAudit).values({ actorId: r.identityId, action: "auth.password_reset", detail: { byAdmin: !!r.createdBy } });
    });
  }

  // ---------------- My account (owner decision 14 Nov 2026) ----------------
  async account(identityId: string) {
    const [i] = await this.db.select().from(S.identities).where(eq(S.identities.id, identityId));
    if (!i) throw unauthorized();
    return { email: i.email, displayName: i.displayName, phone: i.phone, jobTitle: i.jobTitle, locale: i.locale, mustChangePassword: i.mustChangePassword };
  }

  async updateAccount(identityId: string, b: { displayName?: string; phone?: string | null; jobTitle?: string | null; locale?: "ar" | "en" }) {
    const set: Partial<Identity> = {};
    if (b.displayName !== undefined) set.displayName = b.displayName;
    if (b.phone !== undefined) set.phone = b.phone || null;
    if (b.jobTitle !== undefined) set.jobTitle = b.jobTitle || null;
    if (b.locale !== undefined) set.locale = b.locale;
    if (Object.keys(set).length) {
      await this.db.update(S.identities).set(set).where(eq(S.identities.id, identityId));
      await this.db.insert(S.platformAudit).values({ actorId: identityId, action: "account.updated", detail: { fields: Object.keys(set) } });
    }
    return this.account(identityId);
  }

  /**
   * Change the password with the current one. The other web sessions end (the one making the change stays),
   * and a temporary password stops being temporary.
   */
  async changePassword(identityId: string, current: string, next: string, keepRefreshToken?: string) {
    const [i] = await this.db.select().from(S.identities).where(eq(S.identities.id, identityId));
    if (!i || !i.passwordHash || i.disabledAt) throw unauthorized();
    this.assertNotLocked(i);
    if (!(await argon2.verify(i.passwordHash, current))) {
      await this.recordFailure(i, "account.password_change_failed");
      throw validation({ currentPassword: "wrong_password" });
    }
    if (current === next) throw validation({ newPassword: "same_as_current" });
    await this.passwords.assertAcceptable(next);
    const hash = await AuthService.hashPassword(next);
    let keepFamily: string | null = null;
    if (keepRefreshToken) {
      const [rt] = await this.db.select({ familyId: S.refreshTokens.familyId }).from(S.refreshTokens).where(eq(S.refreshTokens.tokenHash, sha256(keepRefreshToken)));
      keepFamily = rt?.familyId ?? null;
    }
    await this.db.transaction(async (tx) => {
      await tx.update(S.identities).set({ passwordHash: hash, mustChangePassword: false, failedAttempts: 0, lockedUntil: null }).where(eq(S.identities.id, identityId));
      await tx.update(S.refreshTokens).set({ revokedAt: new Date() }).where(and(
        eq(S.refreshTokens.identityId, identityId), isNull(S.refreshTokens.deviceId), isNull(S.refreshTokens.revokedAt),
        keepFamily ? sql`${S.refreshTokens.familyId} <> ${keepFamily}` : undefined,
      ));
      await tx.insert(S.platformAudit).values({ actorId: identityId, action: "account.password_changed", detail: { wasTemporary: i.mustChangePassword } });
    });
    return this.account(identityId);
  }

  /**
   * Owner decision (14 Nov 2026): an admin gives a colleague who cannot sign in a temporary password. It works
   * without the email code and must be changed right after signing in. Every web session and trusted browser ends.
   */
  async setTemporaryPassword(identityId: string, by: string, tenantId: string | null) {
    const password = temporaryPassword();
    const hash = await AuthService.hashPassword(password);
    await this.db.transaction(async (tx) => {
      const [i] = await tx.update(S.identities).set({ passwordHash: hash, mustChangePassword: true, failedAttempts: 0, lockedUntil: null })
        .where(and(eq(S.identities.id, identityId), isNull(S.identities.disabledAt))).returning({ id: S.identities.id });
      if (!i) throw new AppError(HttpStatus.NOT_FOUND, "not_found", "user not found");
      await tx.update(S.refreshTokens).set({ revokedAt: new Date() })
        .where(and(eq(S.refreshTokens.identityId, identityId), isNull(S.refreshTokens.deviceId), isNull(S.refreshTokens.revokedAt)));
      await tx.update(S.trustedDevices).set({ revokedAt: new Date() }).where(and(eq(S.trustedDevices.identityId, identityId), isNull(S.trustedDevices.revokedAt)));
      await tx.update(S.passwordResets).set({ usedAt: new Date() }).where(and(eq(S.passwordResets.identityId, identityId), isNull(S.passwordResets.usedAt)));
      await tx.insert(S.platformAudit).values({ actorId: by, tenantId, action: "auth.temporary_password_set", detail: { identityId } });
    });
    return { password };
  }

  /**
   * "Forgot my sign-in name": emails which address to sign in with, the companies, and for drivers their app
   * username. Same answer whether or not the email has an account.
   */
  async forgotUsername(email: string) {
    const [i] = await this.db.select().from(S.identities).where(eq(S.identities.email, email.toLowerCase()));
    if (!i || i.disabledAt || !i.email || !(await mailConfigured(this.mailer))) return;
    const rows = await this.db.select({ name: S.tenants.name }).from(S.memberships)
      .innerJoin(S.tenants, eq(S.tenants.id, S.memberships.tenantId))
      .where(and(eq(S.memberships.identityId, i.id), eq(S.memberships.active, true)));
    const companies = [...new Set(rows.map((r) => r.name))];
    const ar = i.locale !== "en";
    const lines = ar
      ? [`مرحبًا ${i.displayName}،`, "", `اسم الدخول (البريد): ${i.email}`, ...(i.username ? [`اسم المستخدم في تطبيق السائق: ${i.username}`] : []), ...(companies.length ? [`الشركات: ${companies.join("، ")}`] : []), "", `لو نسيت كلمة السر: ${this.config.webUrl}/forgot-password`]
      : [`Hello ${i.displayName},`, "", `Sign in with (email): ${i.email}`, ...(i.username ? [`Driver app username: ${i.username}`] : []), ...(companies.length ? [`Companies: ${companies.join(", ")}`] : []), "", `Forgot your password? ${this.config.webUrl}/forgot-password`];
    try {
      await this.mailer.send({ to: i.email, locale: ar ? "ar" : "en", subject: ar ? "بيانات الدخول — منصة الأسطول" : "Your sign-in details — fleet platform", text: `${lines.join("\n")}\n` });
      await this.db.insert(S.platformAudit).values({ actorId: i.id, action: "auth.username_reminder_sent" });
    } catch (e) {
      await this.ops.record({ tenantId: null, kind: "notification", severity: "error", code: "username_email_failed", detail: { identityId: i.id, error: (e as Error).message.slice(0, 300) } });
    }
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
  /**
   * Rotates the refresh token. Reusing a rotated token means theft and ends the whole session family,
   * except right after the rotation when the replacement was never used: that is the same device retrying
   * because the reply was lost (weak network) or two refreshes crossed (app + background sync). The driver
   * app then kept being sent back to its activation code; now it gets a fresh token instead.
   */
  async refresh(token: string, deviceProof?: string, retried = false): Promise<IssuedSession> {
    const [rt] = await this.db.select().from(S.refreshTokens).where(eq(S.refreshTokens.tokenHash, sha256(token)));
    if (!rt) throw SESSION_EXPIRED();
    // SEC-005: a device with a registered key proves it holds the private key — also for the retry of a just-
    // rotated token. Checked first; a failure consumes nothing, so a stolen token gains nothing.
    if (rt.deviceId) {
      const [device] = await this.db.select().from(S.devices).where(eq(S.devices.id, rt.deviceId));
      if (device?.publicKey) {
        const key = parseDeviceKey(device.publicKey);
        if (!deviceProof || !key || !verifyDeviceProof(key, token, deviceProof)) {
          await this.db.insert(S.platformAudit).values({ actorId: rt.identityId, tenantId: device.tenantId, action: "auth.device_proof_failed", detail: { deviceId: device.id, missing: !deviceProof } });
          throw new AppError(HttpStatus.UNAUTHORIZED, "device_proof_invalid", "This session can only be renewed from the activated device");
        }
      }
    }
    let from: RefreshRow = rt;
    if (rt.revokedAt) {
      const next = await this.unusedReplacement(rt);
      if (!next) {
        await this.db.update(S.refreshTokens).set({ revokedAt: new Date() }).where(and(eq(S.refreshTokens.familyId, rt.familyId), isNull(S.refreshTokens.revokedAt)));
        await this.db.insert(S.platformAudit).values({ actorId: rt.identityId, action: "auth.refresh_reuse_detected", detail: { familyId: rt.familyId } });
        throw SESSION_EXPIRED();
      }
      await this.db.insert(S.platformAudit).values({ actorId: rt.identityId, action: "auth.refresh_retry", detail: { familyId: rt.familyId } });
      from = next; // rotate the replacement the client never received
    }
    if (from.expiresAt <= new Date()) throw SESSION_EXPIRED();

    const [identity] = await this.db.select().from(S.identities).where(eq(S.identities.id, from.identityId));
    if (!identity || identity.disabledAt) throw new AppError(HttpStatus.UNAUTHORIZED, "account_disabled", "Account disabled");
    let membership: Membership | null = null;
    if (from.membershipId) {
      const [m] = await this.db.select().from(S.memberships).where(eq(S.memberships.id, from.membershipId));
      if (!m || !m.active) throw unauthorized();
      membership = m;
    }
    const newIdValue = newId();
    const revoked = await this.db.update(S.refreshTokens).set({ revokedAt: new Date(), replacedBy: newIdValue })
      .where(and(eq(S.refreshTokens.id, from.id), isNull(S.refreshTokens.revokedAt))).returning({ id: S.refreshTokens.id });
    if (!revoked.length) {
      // Lost a race with a parallel refresh of the same token: take the retry path once.
      if (!retried) return this.refresh(token, deviceProof, true);
      throw SESSION_EXPIRED();
    }

    const ttl = from.deviceId ? DEFAULTS.DEVICE_REFRESH_TTL_SECONDS
      : from.persistent ? DEFAULTS.WEB_REMEMBER_TTL_SECONDS
        : Math.max(60, Math.floor((from.expiresAt.getTime() - Date.now()) / 1000));
    return this.issue(identity, membership, from.deviceId, ttl, { familyId: from.familyId, id: newIdValue }, from.persistent);
  }

  /** The token that replaced `rt`, if it was made within the grace window and has not been used yet. */
  private async unusedReplacement(rt: RefreshRow): Promise<RefreshRow | null> {
    if (!rt.replacedBy || !rt.revokedAt || Date.now() - rt.revokedAt.getTime() > DEFAULTS.REFRESH_REUSE_GRACE_SECONDS * 1000) return null;
    const [next] = await this.db.select().from(S.refreshTokens).where(eq(S.refreshTokens.id, rt.replacedBy));
    return next && !next.revokedAt && next.familyId === rt.familyId ? next : null;
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
    const visible = all.filter((r) => r.m.role !== "driver" || r.m.id === membershipId);
    // Custom roles are named by the company; a switched-off custom role is not offered in the role switcher.
    const resolved = await Promise.all(visible.map(async (r) => ({ r, p: await this.perms.resolve(r.m.tenantId, r.m.role as Role, r.m.roleId) })));
    const memberships = resolved.filter(({ r, p }) => r.m.role !== "custom" || p.info?.active || r.m.id === membershipId)
      .map(({ r, p }) => ({ id: r.m.id, role: r.m.role as Role, roleName: p.info ? { ar: p.info.nameAr, en: p.info.nameEn } : null, tenantSlug: r.t.slug, tenantName: r.t.name }));
    const base = { identityId, displayName: identity.displayName, memberships, currentMembershipId: membershipId, mustChangePassword: identity.mustChangePassword };
    if (!membershipId) {
      return { ...base, role: "platform_admin", roleId: null, roleName: null, permissions: (await this.perms.resolve(null, "platform_admin", null)).permissions, tenant: null, branchIds: [], driverId: null };
    }
    const cur = resolved.find(({ r }) => r.m.id === membershipId);
    if (!cur) throw unauthorized();
    const row = cur.r;
    return {
      ...base,
      role: row.m.role as Role,
      roleId: row.m.roleId,
      roleName: cur.p.info ? { ar: cur.p.info.nameAr, en: cur.p.info.nameEn } : null,
      permissions: cur.p.permissions,
      tenant: { id: row.t.id, slug: row.t.slug, name: row.t.name, countryCode: row.t.countryCode },
      branchIds: row.m.branchIds,
      driverId: row.m.driverId,
    };
  }

  /** NTF-001: the push token of this activated device; the same token on another device moves here. */
  async setPushToken(identityId: string, deviceId: string, token: string | null) {
    if (token) await this.db.update(S.devices).set({ pushToken: null, pushTokenAt: new Date() }).where(and(eq(S.devices.pushToken, token), sql`${S.devices.id} <> ${deviceId}`));
    const [d] = await this.db.update(S.devices).set({ pushToken: token, pushTokenAt: new Date() })
      .where(and(eq(S.devices.id, deviceId), eq(S.devices.identityId, identityId), isNull(S.devices.revokedAt))).returning({ id: S.devices.id });
    if (!d) throw unauthorized("Device has been revoked");
  }

  async tenantInfo(tenantId: string) {
    const [t] = await this.db.select().from(S.tenants).where(eq(S.tenants.id, tenantId));
    if (!t) throw unauthorized();
    return { id: t.id, slug: t.slug, name: t.name, countryCode: t.countryCode };
  }
  async grantExpiry(grantId: string) {
    const [g] = await this.db.select({ e: S.breakGlassGrants.expiresAt }).from(S.breakGlassGrants).where(eq(S.breakGlassGrants.id, grantId));
    return g?.e?.toISOString() ?? new Date().toISOString();
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
      await this.ops.record({ tenantId: null, kind: "security", severity: "warning", code: "account_locked", detail: { identityId: identity.id, reason: action } });
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
    persistent = false,
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
      persistent,
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

