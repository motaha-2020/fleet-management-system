import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import argon2 from "argon2";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { COUNTRY_TEMPLATES, DEFAULTS } from "@fleet/config";
import { schema, newId, sha256, randomToken, JOBS, type Db, type ProvisionTenantJob } from "@fleet/db";
import { CONTROL_DB, MAILER, QUEUE } from "../infra/tokens.js";
import type { JobQueue } from "../infra/infra.module.js";
import { AppError, conflict, uniqueViolation, validation } from "../infra/errors.js";
import { mailConfigured, type Mailer } from "../infra/mailer.js";
import { OpsLog } from "../infra/ops-log.js";
import { AuthService, maskEmail, type IssuedSession, type WebSignIn } from "./auth.service.js";
import { PasswordPolicy } from "./password-policy.js";

const S = schema;
const TTL_MS = 30 * 60_000;
const MAX_CODE_ATTEMPTS = 5;
const PER_EMAIL_PER_HOUR = 3;
const PER_IP_PER_HOUR = 10;
const codeHash = (requestId: string, code: string) => sha256(`signup-code:${requestId}:${code}`);
const TOO_MANY = () => new AppError(HttpStatus.TOO_MANY_REQUESTS, "too_many_requests", "Too many sign-up attempts. Try again in an hour");
const INVALID = () => new AppError(HttpStatus.BAD_REQUEST, "invalid_signup", "This sign-up has expired or was already used. Start again");

/** A company code (slug) from the name: latin letters and digits, plus a short random tail so it is unique. */
export function slugFor(name: string): string {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20).replace(/-+$/g, "");
  const A = "abcdefghjkmnpqrstuvwxyz23456789";
  const tail = Array.from({ length: 4 }, () => A[randomInt(0, A.length)]).join("");
  return `${/^[a-z]/.test(base) ? base : `co${base ? `-${base}` : ""}`}-${tail}`.slice(0, 32);
}

/**
 * Owner decisions (14 Nov 2026): a company admin signs up on their own and the company works at once (no
 * approval, no plans). Three steps: (1) a 6-digit code goes to the email; (2) code + password create the company
 * and its admin, and provisioning starts; (3) once the company database is ready the browser is signed in.
 * Abuse limits: a few attempts per email and per address per hour, and 5 tries per code.
 */
@Injectable()
export class SignupService {
  constructor(
    @Inject(CONTROL_DB) private readonly db: Db,
    @Inject(QUEUE) private readonly queue: JobQueue,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly auth: AuthService,
    private readonly passwords: PasswordPolicy,
    private readonly ops: OpsLog,
  ) {}

  async start(b: { companyName: string; countryCode: string; adminName: string; email: string; locale: "ar" | "en" }, ip: string | null) {
    if (!COUNTRY_TEMPLATES[b.countryCode]) throw validation({ countryCode: "no active country template" });
    const email = b.email.toLowerCase();
    const hourAgo = new Date(Date.now() - 3_600_000);
    const [{ byEmail }] = (await this.db.select({ byEmail: sql<number>`count(*)::int` }).from(S.signupRequests)
      .where(and(eq(S.signupRequests.email, email), gt(S.signupRequests.createdAt, hourAgo)))) as [{ byEmail: number }];
    const [{ byIp }] = ip
      ? ((await this.db.select({ byIp: sql<number>`count(*)::int` }).from(S.signupRequests)
          .where(and(eq(S.signupRequests.ip, ip), gt(S.signupRequests.createdAt, hourAgo)))) as [{ byIp: number }])
      : [{ byIp: 0 }];
    if (byEmail >= PER_EMAIL_PER_HOUR || byIp >= PER_IP_PER_HOUR) throw TOO_MANY();
    const [existing] = await this.db.select({ isPlatformAdmin: S.identities.isPlatformAdmin }).from(S.identities).where(eq(S.identities.email, email));
    if (existing?.isPlatformAdmin) throw conflict("platform_identity", "Platform administrators cannot sign up a company", { email: "taken" });

    const id = newId();
    const token = randomToken(32);
    const canMail = await mailConfigured(this.mailer);
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.db.insert(S.signupRequests).values({
      id, tokenHash: sha256(token), email, companyName: b.companyName, countryCode: b.countryCode, adminName: b.adminName, locale: b.locale,
      codeHash: canMail ? codeHash(id, code) : null, ip, expiresAt: new Date(Date.now() + TTL_MS),
    });
    if (canMail) {
      const ar = b.locale !== "en";
      try {
        await this.mailer.send({
          to: email, locale: b.locale,
          subject: ar ? `كود تسجيل الشركة: ${code}` : `Your company sign-up code: ${code}`,
          text: ar
            ? `مرحبًا ${b.adminName}،\n\nكود تأكيد تسجيل شركة «${b.companyName}» في منصة الأسطول: ${code}\nصالح لمدة 30 دقيقة. لو ما طلبتش التسجيل، تجاهل الرسالة.\n`
            : `Hello ${b.adminName},\n\nYour code to register "${b.companyName}" on the fleet platform: ${code}\nIt works for 30 minutes. If you did not ask for this, ignore this email.\n`,
        });
      } catch (e) {
        await this.ops.record({ tenantId: null, kind: "notification", severity: "error", code: "signup_code_email_failed", detail: { error: (e as Error).message.slice(0, 300) } });
        throw new AppError(HttpStatus.SERVICE_UNAVAILABLE, "email_send_failed", "The code could not be emailed. Try again shortly");
      }
    } else {
      await this.ops.record({ tenantId: null, kind: "security", severity: "warning", code: "signup_code_skipped", detail: { reason: "email_not_configured" } });
    }
    await this.db.insert(S.platformAudit).values({ actorId: null, action: "signup.started", detail: { email, companyName: b.companyName, codeSent: canMail } });
    return { signupToken: token, emailHint: maskEmail(email), codeSent: canMail };
  }

  async verify(token: string, code: string | undefined, password: string) {
    const [req] = await this.db.select().from(S.signupRequests).where(eq(S.signupRequests.tokenHash, sha256(token)));
    if (!req || req.verifiedAt || req.expiresAt <= new Date()) throw INVALID();
    if (req.codeHash) {
      if (req.attempts >= MAX_CODE_ATTEMPTS) throw INVALID();
      if (!code || codeHash(req.id, code) !== req.codeHash) {
        await this.db.update(S.signupRequests).set({ attempts: sql`${S.signupRequests.attempts} + 1` }).where(eq(S.signupRequests.id, req.id));
        throw validation({ code: "invalid_code" });
      }
    }
    const [existing] = await this.db.select().from(S.identities).where(eq(S.identities.email, req.email));
    let hash: string | null = null;
    if (existing?.passwordHash) {
      // Same person signing up another company: they confirm with the password they already use.
      if (!(await argon2.verify(existing.passwordHash, password))) throw validation({ password: "wrong_password" });
    } else {
      await this.passwords.assertAcceptable(password);
      hash = await AuthService.hashPassword(password);
    }
    if (existing?.disabledAt || existing?.isPlatformAdmin) throw INVALID();

    const tenantId = newId();
    for (let attempt = 0; ; attempt++) {
      const slug = slugFor(req.companyName);
      try {
        await this.db.transaction(async (tx) => {
          const [claimed] = await tx.update(S.signupRequests).set({ verifiedAt: new Date() })
            .where(and(eq(S.signupRequests.id, req.id), isNull(S.signupRequests.verifiedAt))).returning({ id: S.signupRequests.id });
          if (!claimed) throw INVALID();
          await tx.insert(S.tenants).values({ id: tenantId, slug, name: req.companyName, countryCode: req.countryCode, homeRegion: "eu-central", status: "provisioning" });
          let identity = existing;
          if (!identity) [identity] = await tx.insert(S.identities).values({ id: newId(), email: req.email, displayName: req.adminName, locale: req.locale, passwordHash: hash }).returning();
          else if (hash) await tx.update(S.identities).set({ passwordHash: hash }).where(eq(S.identities.id, identity.id));
          const membershipId = newId();
          await tx.insert(S.memberships).values({ id: membershipId, identityId: identity!.id, tenantId, role: "company_admin" });
          await tx.update(S.signupRequests).set({ tenantId, identityId: identity!.id, membershipId }).where(eq(S.signupRequests.id, req.id));
          await tx.insert(S.platformAudit).values({ actorId: identity!.id, tenantId, action: "tenant.self_signed_up", detail: { slug, email: req.email } });
        });
        break;
      } catch (e) {
        if (uniqueViolation(e) === "tenants_slug_key" && attempt < 3) continue;
        throw e;
      }
    }
    const job: ProvisionTenantJob = { tenantId };
    await this.queue.send(JOBS.provisionTenant, job, { singletonKey: tenantId });
    return { status: "provisioning" as const };
  }

  /** Signs the new admin in once, when the company database is ready; trusts this browser (the email was proven). */
  async finish(token: string, web: WebSignIn): Promise<IssuedSession | { status: "provisioning" | "failed" }> {
    const [row] = await this.db.select({ r: S.signupRequests, status: S.tenants.status }).from(S.signupRequests)
      .innerJoin(S.tenants, eq(S.tenants.id, S.signupRequests.tenantId))
      .where(eq(S.signupRequests.tokenHash, sha256(token)));
    if (!row || !row.r.verifiedAt || row.r.finishedAt || !row.r.identityId || !row.r.membershipId) throw INVALID();
    if (row.status === "provisioning") return { status: "provisioning" };
    if (row.status !== "active") return { status: "failed" };
    const [done] = await this.db.update(S.signupRequests).set({ finishedAt: new Date() })
      .where(and(eq(S.signupRequests.id, row.r.id), isNull(S.signupRequests.finishedAt))).returning({ id: S.signupRequests.id });
    if (!done) throw INVALID();
    const [identity] = await this.db.select().from(S.identities).where(eq(S.identities.id, row.r.identityId));
    const [membership] = await this.db.select().from(S.memberships).where(eq(S.memberships.id, row.r.membershipId));
    const session = await this.auth.webSession(identity!, membership!, true);
    return { ...session, trusted: await this.auth.trust(identity!.id, web.userAgent ?? null) };
  }
}

export const SIGNUP_LIMITS = { TTL_MS, MAX_CODE_ATTEMPTS, PER_EMAIL_PER_HOUR, PER_IP_PER_HOUR, PASSWORD_MIN: DEFAULTS.PASSWORD_MIN_LENGTH };
