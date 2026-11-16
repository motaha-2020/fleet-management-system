"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiRequestError } from "@fleet/contracts";
import { COUNTRY_TEMPLATES } from "@fleet/config";
import { fieldError } from "@fleet/i18n";
import { AuthCard } from "@/components/auth-card";
import { Alert, Button, Field, Input, PasswordInput, Select } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { apiErrorMessage } from "@/lib/errors";

type Step = { kind: "form" } | { kind: "code"; token: string; emailHint: string; codeSent: boolean } | { kind: "wait"; token: string } | { kind: "failed" };

/**
 * Owner decision (14 Nov 2026): a company admin signs up on their own, and the company works at once.
 * 1) company + admin details → a 6-digit code by email; 2) code + password → the company is created;
 * 3) the page waits until the company is ready, then signs in and opens the company profile.
 */
export default function SignupPage() {
  const { api, signIn } = useSession();
  const { t, locale } = useI18n();
  const T = t.signup;
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "form" });
  const [form, setForm] = useState({ companyName: "", countryCode: "EG", adminName: "", email: "" });
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      await fn();
    } catch (err) {
      if (err instanceof ApiRequestError) setErrors(err.fields);
      setError(apiErrorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  const start = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await api.call("signupStart", { body: { ...form, locale } });
      setStep({ kind: "code", token: r.signupToken, emailHint: r.emailHint, codeSent: r.codeSent });
    });
  };

  const verify = (e: FormEvent) => {
    e.preventDefault();
    if (step.kind !== "code") return;
    void run(async () => {
      await api.call("signupVerify", { body: { signupToken: step.token, password, ...(step.codeSent ? { code } : {}) } });
      setStep({ kind: "wait", token: step.token });
    });
  };

  // Step 3: the company database is being made (usually a few seconds).
  useEffect(() => {
    if (step.kind !== "wait") return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await api.call("signupFinish", { body: { signupToken: step.token } });
        if (stop) return;
        if ("accessToken" in r) {
          signIn(r);
          router.replace("/company?welcome=1");
        } else if (r.status === "failed") setStep({ kind: "failed" });
        else setTimeout(() => void tick(), 2000);
      } catch (err) {
        if (!stop) { setError(apiErrorMessage(t, err)); setStep({ kind: "failed" }); }
      }
    };
    void tick();
    return () => { stop = true; };
  }, [step, api, signIn, router, t]);

  return (
    <AuthCard title={T.title}>
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {step.kind === "form" && (
        <form onSubmit={start} className="flex flex-col gap-4" noValidate>
          <p className="text-sm text-muted">{T.intro}</p>
          <Field label={T.companyName} error={fieldError(t, errors.companyName)}><Input required value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} /></Field>
          <Field label={T.country} error={fieldError(t, errors.countryCode)}>
            <Select value={form.countryCode} onChange={(e) => setForm({ ...form, countryCode: e.target.value })}>
              {Object.keys(COUNTRY_TEMPLATES).map((c) => <option key={c} value={c}>{(T.countries as Record<string, string>)[c] ?? c}</option>)}
            </Select>
          </Field>
          <Field label={T.adminName} error={fieldError(t, errors.adminName)}><Input required autoComplete="name" value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} /></Field>
          <Field label={t.auth.email} error={fieldError(t, errors.email)}><Input type="email" dir="ltr" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? t.common.loading : T.sendCode}</Button>
        </form>
      )}
      {step.kind === "code" && (
        <form onSubmit={verify} className="flex flex-col gap-4" noValidate>
          {step.codeSent
            ? <p className="text-sm text-muted">{T.codeSentTo} <span dir="ltr" className="font-semibold">{step.emailHint}</span></p>
            : <Alert tone="info">{T.noEmailYet}</Alert>}
          {step.codeSent && (
            <Field label={T.code} error={fieldError(t, errors.code)}>
              <Input inputMode="numeric" autoComplete="one-time-code" dir="ltr" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            </Field>
          )}
          <Field label={T.password} hint={T.passwordHint} error={fieldError(t, errors.password)}>
            <PasswordInput autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} showLabel={t.auth.showPassword} hideLabel={t.auth.hidePassword} />
          </Field>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? t.common.loading : T.create}</Button>
          <Button type="button" variant="ghost" onClick={() => { setStep({ kind: "form" }); setCode(""); setPassword(""); }}>{T.back}</Button>
        </form>
      )}
      {step.kind === "wait" && <p className="py-6 text-center text-sm text-muted" role="status">{T.preparing}</p>}
      {step.kind === "failed" && <Alert>{T.failed}</Alert>}
      <Link href="/login" className="mt-5 block text-center text-sm font-semibold text-accent hover:underline">{T.haveAccount}</Link>
    </AuthCard>
  );
}
