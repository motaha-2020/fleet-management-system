"use client";
import { useEffect, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { ApiRequestError, type MfaChallenge, type TokenResponse } from "@fleet/contracts";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { apiErrorMessage } from "@/lib/errors";
import { Alert, Button, Field, Input } from "./ui";

/** Second login step: verify a TOTP code, or enrol an authenticator first (SEC-004). */
export function MfaStep({ challenge, onDone, onRestart }: { challenge: MfaChallenge; onDone: (r: TokenResponse) => void; onRestart: () => void }) {
  const { api } = useSession();
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (challenge.otpauthUrl) void QRCode.toDataURL(challenge.otpauthUrl, { margin: 1, width: 200 }).then(setQr);
  }, [challenge.otpauthUrl]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await api.call("mfaVerify", { body: { mfaToken: challenge.mfaToken, code: code.replace(/\s/g, "") } }));
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "mfa_expired") return onRestart();
      setError(err instanceof ApiRequestError && err.status === 401 ? t.mfa.invalid : apiErrorMessage(t, err));
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  const enroll = challenge.mfa === "enroll";
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold">{enroll ? t.mfa.enrollTitle : t.mfa.verifyTitle}</h2>
        <p className="mt-1 text-sm leading-6 text-muted">{enroll ? t.mfa.enrollHelp : t.mfa.verifyHelp}</p>
      </div>
      {enroll && (
        <div className="flex flex-col items-center gap-2 rounded-lg bg-[#F4F6F8] p-4">
          {qr ? <img src={qr} width={180} height={180} alt="QR" className="rounded bg-white p-1" /> : <div className="h-[180px]" />}
          <span className="text-xs text-muted">{t.mfa.manualKey}</span>
          <code dir="ltr" className="break-all text-center font-mono text-sm tracking-wider" data-testid="mfa-secret">{challenge.secret}</code>
        </div>
      )}
      {error && <Alert>{error}</Alert>}
      <Field label={t.mfa.code}>
        <Input dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required autoFocus value={code}
          onChange={(e) => setCode(e.target.value)} className="text-center font-mono text-xl tracking-[0.4em]" />
      </Field>
      <Button variant="primary" type="submit" disabled={busy || code.replace(/\s/g, "").length !== 6}>{busy ? t.common.loading : t.mfa.confirm}</Button>
    </form>
  );
}
