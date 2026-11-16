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
  /** "Forgot password" or "forgot my sign-in name": both answer the same whether or not the email has an account. */
  const [what, setWhat] = useState<"password" | "username">("password");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (what === "password") await api.call("forgotPassword", { body: { email } });
      else await api.call("forgotUsername", { body: { email } });
      setSent(true);
    } catch (err) {
      setError(apiErrorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={what === "password" ? t.auth.forgotTitle : t.auth.forgotUsernameTitle}>
      <div className="mb-4 flex gap-1 rounded-lg bg-[#EEF2F6] p-1 text-sm" role="tablist">
        {(["password", "username"] as const).map((w) => (
          <button key={w} type="button" role="tab" aria-selected={what === w} onClick={() => { setWhat(w); setSent(false); }}
            className={`flex-1 rounded-md px-3 py-1.5 font-medium ${what === w ? "bg-surface text-accent-ink shadow-sm" : "text-ink-2"}`}>
            {w === "password" ? t.auth.forgotPasswordTab : t.auth.forgotUsernameTab}
          </button>
        ))}
      </div>
      {sent ? (
        <div className="flex flex-col gap-4">
          <Alert tone="ok">{what === "password" ? t.auth.forgotSent : t.auth.forgotUsernameSent}</Alert>
          <p className="text-sm text-muted">{t.auth.forgotNoEmail}</p>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <p className="text-sm text-muted">{what === "password" ? t.auth.forgotHelp : t.auth.forgotUsernameHelp}</p>
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
