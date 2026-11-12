import nodemailer from "nodemailer";

export interface MailMessage { to: string; subject: string; text: string; locale: "ar" | "en" }
/** NTF-001 email channel. Returns the provider name recorded with the delivery (NTF-003). */
export interface Mailer { send(m: MailMessage): Promise<{ provider: string }> }

/** Development / no SMTP configured: the message is written to the log and counted as sent by "log". */
export class LogMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  async send(m: MailMessage) {
    this.sent.push(m);
    if (this.sent.length > 500) this.sent.shift();
    console.log(`[mail:log] to=${m.to} subject=${JSON.stringify(m.subject)}`);
    return { provider: "log" };
  }
}

export class SmtpMailer implements Mailer {
  private readonly transport;
  constructor(url: string, private readonly from: string) {
    this.transport = nodemailer.createTransport(url);
  }
  async send(m: MailMessage) {
    await this.transport.sendMail({
      from: this.from, to: m.to, subject: m.subject, text: m.text,
      headers: { "Content-Language": m.locale },
    });
    return { provider: "smtp" };
  }
}
