"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiRequestError } from "@fleet/contracts";
import { AuthCard } from "@/components/auth-card";
import { Alert, Button, Field, Input, PasswordInput } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { apiErrorMessage } from "@/lib/errors";

/**
 * Driver web version (owner decision 14 Nov 2026): the browser is signed in like a phone, with the username and a
 * one-time code from the office. It works online only; the phone app stays the main tool.
 */
export default function DriverLogin() {
  const { api, signIn } = useSession();
  const { t } = useI18n();
  const D = t.driverWeb;
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      signIn(await api.call("driverWebActivate", { body: { username, code } }));
      router.replace("/driver");
    } catch (err) {
      setError(err instanceof ApiRequestError && err.code === "invalid_activation" ? D.invalid : apiErrorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={D.loginTitle}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm text-muted">{D.loginHelp}</p>
        {error && <Alert>{error}</Alert>}
        <Field label={D.username}><Input dir="ltr" autoComplete="username" required autoFocus value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
        <Field label={D.code}>
          <PasswordInput autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} showLabel={t.auth.showPassword} hideLabel={t.auth.hidePassword} />
        </Field>
        <Button variant="primary" type="submit" disabled={busy}>{busy ? t.common.loading : t.auth.login}</Button>
      </form>
      <Link href="/login" className="mt-5 block text-center text-sm font-semibold text-accent hover:underline">{D.officeLogin}</Link>
    </AuthCard>
  );
}
