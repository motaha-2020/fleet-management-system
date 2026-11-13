"use client";
import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ApiRequestError } from "@fleet/contracts";
import { fieldError } from "@fleet/i18n";
import { AuthCard } from "@/components/auth-card";
import { Alert, Button, Field, PasswordInput } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { apiErrorMessage } from "@/lib/errors";

/** New password from a reset link (emailed, or made by the company admin). */
function Reset() {
  const { api } = useSession();
  const { t } = useI18n();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.call("resetPassword", { body: { token, password } });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiRequestError && err.code === "invalid_reset" ? t.auth.resetInvalid
        // D-SEC-PWD: say why the password was refused (too common, breached, too short).
        : err instanceof ApiRequestError && err.fields.password ? (fieldError(t, err.fields.password.startsWith("min") ? "password_too_short" : err.fields.password) ?? apiErrorMessage(t, err))
          : apiErrorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t.auth.resetTitle}>
      {done ? (
        <div className="flex flex-col gap-4">
          <Alert tone="ok">{t.auth.resetDone}</Alert>
          <Link href="/login" className="inline-flex min-h-10 items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-ink">{t.auth.login}</Link>
        </div>
      ) : !token ? (
        <Alert>{t.auth.resetInvalid}</Alert>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          {error && <Alert>{error}</Alert>}
          <Field label={t.auth.newPassword}>
            <PasswordInput autoComplete="new-password" minLength={12} required autoFocus value={password} onChange={(e) => setPassword(e.target.value)}
              showLabel={t.auth.showPassword} hideLabel={t.auth.hidePassword} />
          </Field>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? t.common.loading : t.auth.resetSave}</Button>
        </form>
      )}
      {!done && <Link href="/login" className="mt-5 block text-center text-sm font-semibold text-accent hover:underline">{t.auth.backToLogin}</Link>}
    </AuthCard>
  );
}

export default function Page() {
  return <Suspense><Reset /></Suspense>;
}
