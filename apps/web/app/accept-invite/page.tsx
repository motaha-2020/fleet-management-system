"use client";
import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiRequestError } from "@fleet/contracts";
import { AuthCard } from "@/components/auth-card";
import { Alert, Button, Field, Input } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { apiErrorMessage } from "@/lib/errors";

function AcceptInvite() {
  const { api, signIn } = useSession();
  const { t } = useI18n();
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.call("acceptInvite", { body: { token, password } });
      signIn(r);
      router.replace(r.user.role === "platform_admin" ? "/platform/tenants" : "/vehicles");
    } catch (err) {
      setError(err instanceof ApiRequestError && err.code === "invalid_invite" ? t.auth.inviteInvalid : apiErrorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t.auth.acceptTitle}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <Field label={t.auth.newPassword}>
          <Input type="password" dir="ltr" autoComplete="new-password" minLength={12} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button variant="primary" type="submit" disabled={busy || !token}>{busy ? t.common.loading : t.auth.activate}</Button>
      </form>
    </AuthCard>
  );
}

export default function Page() {
  return <Suspense><AcceptInvite /></Suspense>;
}
