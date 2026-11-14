"use client";
import { Button, Card } from "./ui";
import { useI18n } from "@/lib/i18n";

/**
 * A temporary password an admin just made for someone who cannot sign in (owner decision 14 Nov 2026). It is shown
 * once; the admin reads it out or sends it by hand, and the person must choose a new password right after signing in.
 */
export function TempPasswordResult({ name, password, onClose }: { name: string; password: string; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Card className="mb-6 border-accent">
      <p className="mb-2 text-sm font-medium">{t.tempPassword.made.replace("{name}", name)}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code dir="ltr" className="rounded-lg bg-[#EEF1F4] px-3 py-2 text-lg font-bold tracking-wider" data-testid="temp-password">{password}</code>
        <Button onClick={() => void navigator.clipboard?.writeText(password)}>{t.common.copy}</Button>
        <Button variant="ghost" onClick={onClose}>{t.common.close}</Button>
      </div>
      <p className="mt-2 text-xs text-muted">{t.tempPassword.hint}</p>
    </Card>
  );
}
