import { Inject, Injectable, Logger } from "@nestjs/common";
import { schema, type Db } from "@fleet/db";
import { CONFIG, CONTROL_DB, MAILER } from "../infra/tokens.js";
import type { AppConfig } from "../config.js";
import type { Mailer } from "../infra/mailer.js";

/**
 * Invites go by email (NTF-001: email is the web users' channel). The link is still shown to the person who
 * invited, so onboarding works before SMTP is set up; a failed send is recorded in the platform audit.
 */
@Injectable()
export class InviteMail {
  private readonly log = new Logger("invite-mail");
  constructor(@Inject(MAILER) private readonly mailer: Mailer, @Inject(CONFIG) private readonly config: AppConfig, @Inject(CONTROL_DB) private readonly db: Db) {}

  async send(to: { identityId: string; email: string; name: string; locale?: "ar" | "en" }, token: string, companyName: string, tenantId: string | null) {
    const link = `${this.config.webUrl}/accept-invite?token=${encodeURIComponent(token)}`;
    const ar = (to.locale ?? "ar") === "ar";
    const subject = ar ? `دعوة للانضمام إلى ${companyName} على منصة الأسطول` : `Invitation to join ${companyName} on the fleet platform`;
    const text = ar
      ? `مرحبًا ${to.name}،\n\nتمت دعوتك للانضمام إلى ${companyName}. افتح الرابط واختر كلمة سر (12 حرفًا على الأقل). الرابط صالح لمدة 7 أيام ويُستخدم مرة واحدة.\n\n${link}\n`
      : `Hello ${to.name},\n\nYou were invited to join ${companyName}. Open the link and choose a password (at least 12 characters). The link works once and expires in 7 days.\n\n${link}\n`;
    try {
      const r = await this.mailer.send({ to: to.email, subject, text, locale: ar ? "ar" : "en" });
      await this.db.insert(schema.platformAudit).values({ actorId: to.identityId, tenantId, action: "invite.email_sent", detail: { provider: r.provider } });
      return true;
    } catch (e) {
      this.log.error(`invite email to ${to.identityId} failed: ${(e as Error).message}`);
      await this.db.insert(schema.platformAudit).values({ actorId: to.identityId, tenantId, action: "invite.email_failed", detail: { error: (e as Error).message.slice(0, 300) } });
      return false;
    }
  }
}
