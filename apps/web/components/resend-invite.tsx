"use client";
import type { InviteLink } from "@fleet/contracts";
import { Button, Card } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

/** Result of "resend invite": the new link (old ones stop working), and whether the email went out. */
export function ResendInviteResult({ r, onClose }: { r: InviteLink; onClose: () => void }) {
  const { t } = useI18n();
  const R = t.resendInvite;
  return (
    <Card className={`mb-6 ${r.emailed ? "border-accent" : "border-bad"}`}>
      <p className="mb-2 text-sm font-medium">{(r.emailed ? R.sent : R.notEmailed).replace("{email}", r.email)}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code dir="ltr" className="min-w-0 flex-1 break-all rounded-lg bg-[#EEF1F4] px-3 py-2 text-xs" data-testid="resent-invite-link">{r.link}</code>
        <Button onClick={() => void navigator.clipboard?.writeText(r.link)}>{t.common.copy}</Button>
        <Button variant="ghost" onClick={onClose}>{t.common.close}</Button>
      </div>
    </Card>
  );
}
