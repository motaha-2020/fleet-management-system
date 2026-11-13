"use client";
import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { Alert, Button, Field, Input } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { apiErrorMessage } from "@/lib/errors";

/** "Forgot password": the same answer whether or not the email has an account. */
function Forgot() {
  const { api } = useSession();
  const { t } = useI18n();
  const [email, setEmail] = useState(useSearchParams().get("email") ?? "");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.call("forgotPassword", { body: { email } });
      setSent(true);
    } catch (err) {
      setError(apiErrorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t.auth.forgotTitle}>
      {sent ? (
        <div className="flex flex-col gap-4">
          <Alert tone="ok">{t.auth.forgotSent}</Alert>
          <p className="text-sm text-muted">{t.auth.forgotNoEmail}</p>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <p className="text-sm text-muted">{t.auth.forgotHelp}</p>
          {error && <Alert>{error}</Alert>}
          <Field label={t.auth.email}><Input type="email" dir="ltr" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? t.common.loading : t.auth.forgotSend}</Button>
          <p className="text-xs text-muted">{t.auth.forgotNoEmail}</p>
        </form>
      )}
      <Link href="/login" className="mt-5 block text-center text-sm font-semibold text-accent hover:underline">{t.auth.backToLogin}</Link>
    </AuthCard>
  );
}

export default function Page() {
  return <Suspense><Forgot /></Suspense>;
}
