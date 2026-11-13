import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post } from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import { routes, type MailSettings } from "@fleet/contracts";
import { schema, type Db, type SecretBox } from "@fleet/db";
import { Ctx, Requires, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { CONFIG, CONTROL_DB, MAILER, SECRETS } from "../infra/tokens.js";
import type { AppConfig } from "../config.js";
import { AppError } from "../infra/errors.js";
import { formatFrom, PlatformMailer, SmtpMailer, type Mailer } from "../infra/mailer.js";

const M = schema.mailSettings;
const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no answer within ${ms / 1000} s`)), ms))]);

/**
 * The platform's outgoing email (sign-in codes, password reset, invites, alerts), set by the platform admin in
 * the site. Saving first checks that the server accepts the connection and the login, so a typo cannot stop
 * sign-in codes. The password is stored encrypted and never sent back.
 */
@Controller()
export class MailSettingsController {
  constructor(
    @Inject(CONTROL_DB) private readonly db: Db,
    @Inject(SECRETS) private readonly secrets: SecretBox,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private async view(): Promise<MailSettings> {
    const [row] = await this.db.select().from(M).where(eq(M.id, 1));
    if (row) {
      return {
        source: "site", host: row.host, port: row.port, secure: row.secure, username: row.username, passwordSet: !!row.passwordEnc,
        fromAddress: row.fromAddress, fromName: row.fromName, updatedAt: row.updatedAt.toISOString(),
      };
    }
    const env = this.config.mail.smtpUrl;
    if (env) {
      const u = new URL(env);
      return {
        source: "environment", host: u.hostname, port: u.port ? Number(u.port) : null, secure: u.protocol === "smtps:", username: decodeURIComponent(u.username) || null,
        passwordSet: !!u.password, fromAddress: this.config.mail.from, fromName: null, updatedAt: null,
      };
    }
    return { source: "none", host: null, port: null, secure: null, username: null, passwordSet: false, fromAddress: null, fromName: null, updatedAt: null };
  }

  @Requires("mail_settings.manage") @Get(routes.getMailSettings.path)
  get() {
    return this.view();
  }

  @Requires("mail_settings.manage") @Post(routes.saveMailSettings.path) @HttpCode(200)
  async save(@Body(new ZodPipe(routes.saveMailSettings.body)) b: z.output<typeof routes.saveMailSettings.body>, @Ctx() ctx: RequestContext) {
    const [prev] = await this.db.select().from(M).where(eq(M.id, 1));
    const password = b.password === undefined ? (prev?.passwordEnc ? this.secrets.open(prev.passwordEnc) : null) : b.password || null;
    const username = b.username || null;
    const fromName = b.fromName || null;
    const smtp = new SmtpMailer({ host: b.host, port: b.port, secure: b.secure, username, password, from: b.fromAddress }, formatFrom(b.fromAddress, fromName));
    try {
      await withTimeout(smtp.verify(), 15_000);
    } catch (e) {
      throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, "smtp_check_failed", `The mail server did not accept the settings: ${(e as Error).message.slice(0, 200)}`);
    }
    const values = { host: b.host, port: b.port, secure: b.secure, username, passwordEnc: password ? this.secrets.seal(password) : null, fromAddress: b.fromAddress, fromName, updatedBy: ctx.identityId, updatedAt: new Date() };
    await this.db.insert(M).values({ id: 1, ...values }).onConflictDoUpdate({ target: M.id, set: values });
    await this.db.insert(schema.platformAudit).values({ actorId: ctx.identityId, action: "mail_settings.saved", detail: { host: b.host, port: b.port, fromAddress: b.fromAddress, passwordChanged: b.password !== undefined } });
    if (this.mailer instanceof PlatformMailer) this.mailer.invalidate();
    return this.view();
  }

  @Requires("mail_settings.manage") @Post(routes.testMail.path) @HttpCode(200)
  async test(@Body(new ZodPipe(routes.testMail.body)) b: z.output<typeof routes.testMail.body>, @Ctx() ctx: RequestContext) {
    try {
      const r = await withTimeout(this.mailer.send({
        to: b.to, locale: "ar", subject: "رسالة تجربة — منصة الأسطول / Test email — fleet platform",
        text: "الإيميل شغال: أكواد الدخول وروابط إعادة تعيين كلمة السر هتوصل من العنوان ده.\n\nEmail works: sign-in codes and password reset links will come from this address.\n",
      }), 20_000);
      await this.db.insert(schema.platformAudit).values({ actorId: ctx.identityId, action: "mail_settings.test_sent", detail: { provider: r.provider } });
      if (r.provider === "log") throw new AppError(HttpStatus.CONFLICT, "mail_not_configured", "No mail server is set: the message was only written to the log");
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(HttpStatus.BAD_GATEWAY, "mail_send_failed", `Sending failed: ${(e as Error).message.slice(0, 200)}`);
    }
    return { ok: true as const };
  }
}
