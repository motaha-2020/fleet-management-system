"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiRequestError } from "@fleet/contracts";
import { AuthCard } from "@/components/auth-card";
import { Alert, Button, Field, Input } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { apiErrorMessage } from "@/lib/errors";

export default function LoginPage() {
  const { api, signIn } = useSession();
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.call("login", { body: { email, password } });
      signIn(r);
      router.replace(r.user.role === "platform_admin" ? "/platform/tenants" : "/vehicles");
    } catch (err) {
      const code = err instanceof ApiRequestError ? err.code : "network";
      setError(code === "account_locked" ? t.auth.locked : code === "invalid_credentials" ? t.auth.invalid : apiErrorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t.auth.loginTitle}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <Field label={t.auth.email}><Input type="email" dir="ltr" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label={t.auth.password}><Input type="password" dir="ltr" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Button variant="primary" type="submit" disabled={busy}>{busy ? t.common.loading : t.auth.login}</Button>
      </form>
    </AuthCard>
  );
}
