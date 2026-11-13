import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { schema, newId, randomToken, sha256, type Db } from "@fleet/db";
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

  /**
   * Re-send an invite: earlier open links stop working, a new 7-day link is made and emailed. The link is returned so
   * the inviter can also send it by hand (works before email is set up).
   */
  async reissue(to: { identityId: string; email: string; name: string; locale?: "ar" | "en" }, companyName: string, tenantId: string) {
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600_000);
    await this.db.transaction(async (tx) => {
      await tx.update(schema.invites).set({ usedAt: new Date() }).where(and(eq(schema.invites.identityId, to.identityId), isNull(schema.invites.usedAt)));
      await tx.insert(schema.invites).values({ id: newId(), identityId: to.identityId, tenantId, tokenHash: sha256(token), expiresAt });
    });
    const emailed = await this.send(to, token, companyName, tenantId);
    return { link: this.link(token), expiresAt: expiresAt.toISOString(), emailed, email: to.email };
  }

  private link(token: string) {
    return `${this.config.webUrl}/accept-invite?token=${encodeURIComponent(token)}`;
  }

  async send(to: { identityId: string; email: string; name: string; locale?: "ar" | "en" }, token: string, companyName: string, tenantId: string | null) {
    const link = this.link(token);
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
