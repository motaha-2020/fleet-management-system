"use client";
import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiRequestError, isMfaChallenge, type MfaChallenge, type TokenResponse } from "@fleet/contracts";
import { AuthCard } from "@/components/auth-card";
import { MfaStep } from "@/components/mfa-step";
import { Alert, Button, Checkbox, Field, Input, PasswordInput } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { apiErrorMessage } from "@/lib/errors";

const homeFor = (r: TokenResponse) => (r.user.role === "platform_admin" ? "/platform/tenants" : "/vehicles");

function Login() {
  const { api, signIn } = useSession();
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);

  const done = (r: TokenResponse) => {
    signIn(r);
    router.replace(homeFor(r));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.call("login", { body: { email, password, remember } });
      if (isMfaChallenge(r)) setChallenge(r);
      else done(r);
    } catch (err) {
      const code = err instanceof ApiRequestError ? err.code : "network";
      setError(code === "account_locked" ? t.auth.locked : code === "invalid_credentials" ? t.auth.invalid
        : code === "email_send_failed" ? t.mfa.emailFailed : apiErrorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  if (challenge) {
    return (
      <AuthCard title={t.auth.loginTitle}>
        <MfaStep challenge={challenge} onDone={done} onRestart={() => { setChallenge(null); setPassword(""); }} />
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t.auth.loginTitle}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <Field label={t.auth.email}><Input type="email" dir="ltr" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label={t.auth.password}>
          <PasswordInput autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}
            showLabel={t.auth.showPassword} hideLabel={t.auth.hidePassword} />
        </Field>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Checkbox label={t.auth.remember} hint={t.auth.rememberHint} checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <Link href={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ""}`} className="shrink-0 text-sm font-semibold text-accent hover:underline">{t.auth.forgot}</Link>
        </div>
        <Button variant="primary" type="submit" disabled={busy}>{busy ? t.common.loading : t.auth.login}</Button>
      </form>
      {/* Drivers install the Android app from here (served by the site, not a store, during the pilot). */}
      <a href="/download/fleet-driver.apk" download className="mt-5 flex items-center gap-3 rounded-lg border border-line p-3 hover:bg-accent-soft" data-testid="download-app">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/driver-app-icon.png" alt="" width={44} height={44} className="rounded-lg" />
        <span className="flex flex-col">
          <span className="font-semibold text-ink">{t.auth.downloadApp}</span>
          <span className="text-xs text-muted">{t.auth.downloadAppHint}</span>
        </span>
      </a>
    </AuthCard>
  );
}

export default function Page() {
  return <Suspense><Login /></Suspense>;
}
