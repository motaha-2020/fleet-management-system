"use client";
import { useState, type FormEvent } from "react";
import { ApiRequestError, type MfaChallenge, type TokenResponse } from "@fleet/contracts";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { apiErrorMessage } from "@/lib/errors";
import { Alert, Button, Field, Input } from "./ui";

/**
 * Second sign-in step on a browser that is not trusted yet: the 6-digit code sent by email
 * (owner decision, 13 Nov 2026: replaces the authenticator app).
 */
export function MfaStep({ challenge, onDone, onRestart }: { challenge: MfaChallenge; onDone: (r: TokenResponse) => void; onRestart: () => void }) {
  const { api } = useSession();
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clean = code.replace(/\D/g, "");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      onDone(await api.call("mfaVerify", { body: { mfaToken: challenge.mfaToken, code: clean } }));
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "mfa_expired") return onRestart();
      setError(err instanceof ApiRequestError && err.status === 401 ? t.mfa.invalid : apiErrorMessage(t, err));
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    setInfo(null);
    try {
      await api.call("mfaResend", { body: { mfaToken: challenge.mfaToken } });
      setInfo(t.mfa.resent);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "mfa_expired") return onRestart();
      setError(err instanceof ApiRequestError && err.code === "code_resend_too_soon" ? t.mfa.resendWait
        : err instanceof ApiRequestError && err.code === "email_send_failed" ? t.mfa.emailFailed : apiErrorMessage(t, err));
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold text-ink">{t.mfa.title}</h2>
        <p className="text-sm text-muted">{t.mfa.help.replace("{email}", challenge.emailHint)}</p>
      </div>
      {error && <Alert>{error}</Alert>}
      {info && <Alert tone="ok">{info}</Alert>}
      <Field label={t.mfa.code} hint={t.mfa.trustNote}>
        <Input dir="ltr" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={7} placeholder="000000" required
          value={code} onChange={(e) => setCode(e.target.value)} className="text-center font-mono text-xl tracking-[0.4em]" />
      </Field>
      <Button variant="primary" type="submit" disabled={busy || clean.length !== 6}>{busy ? t.common.loading : t.mfa.confirm}</Button>
      <div className="flex flex-wrap justify-between gap-2">
        <Button type="button" variant="ghost" onClick={() => void resend()}>{t.mfa.resend}</Button>
        <Button type="button" variant="ghost" onClick={onRestart}>{t.mfa.restart}</Button>
      </div>
    </form>
  );
}
