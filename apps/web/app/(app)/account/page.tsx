"use client";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiRequestError } from "@fleet/contracts";
import { fieldError } from "@fleet/i18n";
import { Alert, Button, Card, Field, Input, PageHeader, PasswordInput } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { apiErrorMessage } from "@/lib/errors";

/**
 * My account: name, phone, job title and password (owner decision 14 Nov 2026). After signing in with a temporary
 * password from an admin, this is the only page available until a new password is chosen.
 */
function Account() {
  const { api, user, refreshUser } = useSession();
  const { t } = useI18n();
  const A = t.account;
  const router = useRouter();
  const required = useSearchParams().get("required") === "1" || !!user?.mustChangePassword;
  const account = useLoad(() => api.call("getAccount"), [api]);
  const [form, setForm] = useState({ displayName: "", phone: "", jobTitle: "" });
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (account.data) setForm({ displayName: account.data.displayName, phone: account.data.phone ?? "", jobTitle: account.data.jobTitle ?? "" });
  }, [account.data]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMessage(null);
    setErrors({});
    try {
      await fn();
      setMessage({ tone: "ok", text: ok });
      return true;
    } catch (err) {
      if (err instanceof ApiRequestError) setErrors(err.fields);
      setMessage({ tone: "bad", text: apiErrorMessage(t, err) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const saveProfile = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.call("updateAccount", { body: { displayName: form.displayName, phone: form.phone || null, jobTitle: form.jobTitle || null } });
      await account.reload();
      await refreshUser();
    }, A.saved);
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.newPassword !== pw.confirm) { setErrors({ confirm: "mismatch" }); return; }
    const ok = await run(async () => {
      await api.call("changePassword", { body: { currentPassword: pw.currentPassword, newPassword: pw.newPassword } });
      await refreshUser();
    }, A.passwordChanged);
    if (ok) {
      setPw({ currentPassword: "", newPassword: "", confirm: "" });
      if (required) router.replace(user?.role === "platform_admin" ? "/platform/tenants" : "/vehicles");
    }
  };

  const showLabels = { showLabel: t.auth.showPassword, hideLabel: t.auth.hidePassword };
  return (
    <>
      <PageHeader title={A.title} />
      {required && <div className="mb-4"><Alert tone="info">{A.mustChange}</Alert></div>}
      {message && <div className="mb-4"><Alert tone={message.tone}>{message.text}</Alert></div>}
      <div className="grid gap-6 lg:grid-cols-2">
        {!required && (
          <Card>
            <form onSubmit={saveProfile} noValidate className="flex flex-col gap-4">
              <h2 className="text-lg font-bold">{A.profile}</h2>
              <Field label={t.auth.email}><Input dir="ltr" value={account.data?.email ?? ""} disabled /></Field>
              <Field label={A.name} error={fieldError(t, errors.displayName)}><Input required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field>
              <Field label={A.phone} error={fieldError(t, errors.phone)}><Input dir="ltr" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
              <Field label={A.jobTitle} error={fieldError(t, errors.jobTitle)}><Input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} /></Field>
              <div><Button variant="primary" type="submit" disabled={busy}>{t.common.save}</Button></div>
            </form>
          </Card>
        )}
        <Card>
          <form onSubmit={changePassword} noValidate className="flex flex-col gap-4">
            <h2 className="text-lg font-bold">{A.password}</h2>
            <Field label={required ? A.temporaryPassword : A.currentPassword} error={fieldError(t, errors.currentPassword)}>
              <PasswordInput autoComplete="current-password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} {...showLabels} />
            </Field>
            <Field label={A.newPassword} hint={A.newPasswordHint} error={fieldError(t, errors.newPassword ?? errors.password)}>
              <PasswordInput autoComplete="new-password" required value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} {...showLabels} />
            </Field>
            <Field label={A.confirm} error={errors.confirm ? A.mismatch : undefined}>
              <PasswordInput autoComplete="new-password" required value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} {...showLabels} />
            </Field>
            <div><Button variant="primary" type="submit" disabled={busy}>{A.changePassword}</Button></div>
          </form>
        </Card>
      </div>
    </>
  );
}

export default function AccountPage() {
  return <Suspense><Account /></Suspense>;
}
