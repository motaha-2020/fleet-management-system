import nodemailer from "nodemailer";
import { eq } from "drizzle-orm";
import { schema, type Db, type SecretBox } from "@fleet/db";

export interface MailMessage { to: string; subject: string; text: string; locale: "ar" | "en" }
/**
 * NTF-001 email channel. `send` returns the provider name recorded with the delivery (NTF-003).
 * `configured()` says whether mail really leaves the system: sign-in codes are only asked for when it does,
 * so nobody is locked out by an email that can never arrive.
 */
export interface Mailer {
  send(m: MailMessage): Promise<{ provider: string }>;
  configured?(): Promise<boolean>;
}

/** Development / no SMTP configured: the message is written to the log and counted as sent by "log". */
export class LogMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  async send(m: MailMessage) {
    this.sent.push(m);
    if (this.sent.length > 500) this.sent.shift();
    console.log(`[mail:log] to=${m.to} subject=${JSON.stringify(m.subject)}`);
    return { provider: "log" };
  }
  async configured() { return false; }
}

export interface SmtpOptions { host: string; port: number; secure: boolean; username: string | null; password: string | null; from: string }

export class SmtpMailer implements Mailer {
  private readonly transport;
  constructor(urlOrOptions: string | SmtpOptions, private readonly from: string) {
    this.transport = typeof urlOrOptions === "string"
      ? nodemailer.createTransport(urlOrOptions)
      : nodemailer.createTransport({
        host: urlOrOptions.host, port: urlOrOptions.port, secure: urlOrOptions.secure,
        ...(urlOrOptions.username ? { auth: { user: urlOrOptions.username, pass: urlOrOptions.password ?? "" } } : {}),
      });
  }
  async send(m: MailMessage) {
    await this.transport.sendMail({
      from: this.from, to: m.to, subject: m.subject, text: m.text,
      headers: { "Content-Language": m.locale },
    });
    return { provider: "smtp" };
  }
  async configured() { return true; }
  /** Connection + login check for the settings page. */
  verify() { return this.transport.verify(); }
}

export const formatFrom = (address: string, name: string | null) => (name ? `"${name.replace(/"/g, "")}" <${address}>` : address);

/**
 * The platform's outgoing email: the settings saved in the site (platform admin) win; without them, SMTP_URL
 * from the environment; without that, the log. Settings are re-read at most every 30 s, and at once after a save.
 */
export class PlatformMailer implements Mailer {
  private cached: { at: number; mailer: Mailer } | null = null;
  constructor(
    private readonly db: Db,
    private readonly secrets: SecretBox,
    private readonly env: { smtpUrl: string | null; from: string },
  ) {}

  invalidate() { this.cached = null; }

  async current(): Promise<Mailer> {
    if (this.cached && Date.now() - this.cached.at < 30_000) return this.cached.mailer;
    const [row] = await this.db.select().from(schema.mailSettings).where(eq(schema.mailSettings.id, 1));
    const mailer: Mailer = row
      ? new SmtpMailer({
        host: row.host, port: row.port, secure: row.secure, username: row.username,
        password: row.passwordEnc ? this.secrets.open(row.passwordEnc) : null, from: row.fromAddress,
      }, formatFrom(row.fromAddress, row.fromName))
      : this.env.smtpUrl ? new SmtpMailer(this.env.smtpUrl, this.env.from) : new LogMailer();
    this.cached = { at: Date.now(), mailer };
    return mailer;
  }

  async send(m: MailMessage) { return (await this.current()).send(m); }
  async configured() {
    const c = await this.current();
    return c.configured ? c.configured() : true;
  }
}

/** Whether a mailer really delivers (a mailer without `configured` — e.g. a test double — counts as yes). */
export const mailConfigured = async (m: Mailer) => (m.configured ? m.configured() : true);
