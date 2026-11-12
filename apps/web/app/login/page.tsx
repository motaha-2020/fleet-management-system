"use client";
import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiRequestError, isMfaChallenge, type MfaChallenge, type TokenResponse } from "@fleet/contracts";
import { AuthCard } from "@/components/auth-card";
import { MfaStep } from "@/components/mfa-step";
import { Alert, Button, Field, Input } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { apiErrorMessage } from "@/lib/errors";

const homeFor = (r: TokenResponse) => (r.user.role === "platform_admin" ? "/platform/tenants" : "/vehicles");

function Login() {
  const { api, signIn } = useSession();
  const { t } = useI18n();
  const router = useRouter();
  const idle = useSearchParams().get("reason") === "idle";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      const r = await api.call("login", { body: { email, password } });
      if (isMfaChallenge(r)) setChallenge(r);
      else done(r);
    } catch (err) {
      const code = err instanceof ApiRequestError ? err.code : "network";
      setError(code === "account_locked" ? t.auth.locked : code === "invalid_credentials" ? t.auth.invalid : apiErrorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  if (challenge) {
    return (
      <AuthCard title={t.auth.loginTitle}>
        <MfaStep challenge={challenge} onDone={done} onRestart={() => { setChallenge(null); setError(t.mfa.expired); }} />
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t.auth.loginTitle}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {idle && !error && <Alert tone="info">{t.mfa.idle}</Alert>}
        {error && <Alert>{error}</Alert>}
        <Field label={t.auth.email}><Input type="email" dir="ltr" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label={t.auth.password}><Input type="password" dir="ltr" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Button variant="primary" type="submit" disabled={busy}>{busy ? t.common.loading : t.auth.login}</Button>
      </form>
    </AuthCard>
  );
}

export default function Page() {
  return <Suspense><Login /></Suspense>;
}
