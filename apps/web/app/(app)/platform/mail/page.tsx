"use client";
import { useEffect, useState, type FormEvent } from "react";
import { ApiRequestError, type MailSettings } from "@fleet/contracts";
import { Alert, Badge, Button, Card, Checkbox, Field, Input, PageHeader, PasswordInput } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { apiErrorMessage } from "@/lib/errors";
import { fmtDateTime } from "@/lib/format";

type Form = { host: string; port: string; secure: boolean; username: string; password: string; fromAddress: string; fromName: string };
const fromSettings = (m: MailSettings): Form => ({
  host: m.source === "site" ? m.host ?? "" : "", port: m.source === "site" && m.port ? String(m.port) : "465", secure: m.source === "site" ? !!m.secure : true,
  username: m.source === "site" ? m.username ?? "" : "", password: "", fromAddress: m.source === "site" ? m.fromAddress ?? "" : "", fromName: m.source === "site" ? m.fromName ?? "" : "",
});

/**
 * Outgoing email of the platform (sign-in codes, password reset links, invites, alerts). Saving checks the
 * server first; the password is never shown again, only whether one is saved.
 */
export default function MailSettingsPage() {
  const { api } = useSession();
  const { t, locale } = useI18n();
  const M = t.mailSettings;
  const current = useLoad(() => api.call("getMailSettings"), [api]);
  const [f, setF] = useState<Form | null>(null);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (current.data && !f) setF(fromSettings(current.data)); }, [current.data, f]);

  const fail = (err: unknown, fallback: string) => {
    if (err instanceof ApiRequestError) setErrors(err.fields);
    setMessage({ tone: "bad", text: err instanceof ApiRequestError && err.code === "smtp_check_failed" ? `${fallback}: ${err.message.replace(/^The mail server did not accept the settings: /, "")}` : apiErrorMessage(t, err) });
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!f) return;
    setBusy("save");
    setMessage(null);
    setErrors({});
    try {
      const saved = await api.call("saveMailSettings", { body: {
        host: f.host, port: Number(f.port), secure: f.secure, fromAddress: f.fromAddress,
        ...(f.username ? { username: f.username } : {}), ...(f.fromName ? { fromName: f.fromName } : {}), ...(f.password ? { password: f.password } : {}),
      } });
      setF({ ...fromSettings(saved) });
      await current.reload();
      setMessage({ tone: "ok", text: M.saved });
    } catch (err) {
      fail(err, M.checkFailed);
    } finally {
      setBusy(null);
    }
  }

  async function test(e: FormEvent) {
    e.preventDefault();
    setBusy("test");
    setMessage(null);
    try {
      await api.call("testMail", { body: { to } });
      setMessage({ tone: "ok", text: M.testSent });
    } catch (err) {
      setMessage({ tone: "bad", text: err instanceof ApiRequestError && err.code === "mail_not_configured" ? M.notConfigured : apiErrorMessage(t, err) });
    } finally {
      setBusy(null);
    }
  }

  const m = current.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={M.title} />
      <p className="max-w-3xl text-sm text-muted">{M.help}</p>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      {current.error ? <Alert>{apiErrorMessage(t, current.error)}</Alert> : null}
      {!m || !f ? <p className="text-muted">{t.common.loading}</p> : <>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={m.source === "none" ? "warn" : "ok"}>{M.source[m.source]}</Badge>
          {m.source !== "none" && <span dir="ltr" className="text-muted">{m.fromAddress} · {m.host}{m.port ? `:${m.port}` : ""}</span>}
          {m.updatedAt && <span className="text-xs text-muted">{fmtDateTime(m.updatedAt, locale)}</span>}
        </div>
        <Card>
          <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Button type="button" variant="ghost" onClick={() => setF({ ...f, host: "smtp.gmail.com", port: "465", secure: true, username: f.username || f.fromAddress, fromAddress: f.fromAddress || f.username })}>{M.gmail}</Button>
            </div>
            <Field label={M.host} error={errors.host}><Input dir="ltr" required value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} placeholder="smtp.gmail.com" /></Field>
            <Field label={M.port} error={errors.port}><Input dir="ltr" inputMode="numeric" required value={f.port} onChange={(e) => setF({ ...f, port: e.target.value.replace(/\D/g, "") })} /></Field>
            <div className="md:col-span-2"><Checkbox label={M.secure} checked={f.secure} onChange={(e) => setF({ ...f, secure: e.target.checked, port: e.target.checked ? "465" : f.port === "465" ? "587" : f.port })} /></div>
            <Field label={M.username} error={errors.username}><Input dir="ltr" autoComplete="off" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
            <Field label={M.password} hint={m.source === "site" && m.passwordSet ? M.passwordKeep : undefined} error={errors.password}>
              <PasswordInput autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} showLabel={t.auth.showPassword} hideLabel={t.auth.hidePassword} />
            </Field>
            <Field label={M.fromAddress} error={errors.fromAddress}><Input dir="ltr" type="email" required value={f.fromAddress} onChange={(e) => setF({ ...f, fromAddress: e.target.value })} /></Field>
            <Field label={M.fromName} error={errors.fromName}><Input value={f.fromName} onChange={(e) => setF({ ...f, fromName: e.target.value })} /></Field>
            <div className="md:col-span-2"><Button variant="primary" type="submit" disabled={busy !== null}>{busy === "save" ? t.common.loading : M.save}</Button></div>
          </form>
        </Card>
        <Card>
          <form onSubmit={test} className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1"><Field label={M.testTo}><Input dir="ltr" type="email" required value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>
            <Button type="submit" disabled={busy !== null}>{busy === "test" ? t.common.loading : M.test}</Button>
          </form>
        </Card>
      </>}
    </div>
  );
}
