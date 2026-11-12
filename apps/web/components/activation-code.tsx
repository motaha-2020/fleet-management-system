"use client";
import { useI18n } from "@/lib/i18n";
import { fmtDateTime } from "@/lib/format";
import { Button, Card } from "./ui";

export function ActivationCodeCard({ code, onClose }: { code: { name: string; username: string; code: string; expiresAt: string }; onClose: () => void }) {
  const { t, locale } = useI18n();
  const L = t.drivers;
  return (
    <Card className="border-accent">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">{L.codeTitle} — {code.name}</h2>
          <p className="mt-1 max-w-xl text-sm text-muted">{L.codeHelp}</p>
        </div>
        <Button onClick={onClose}>{t.common.close}</Button>
      </div>
      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        <div><dt className="text-xs text-muted">{L.username}</dt><dd dir="ltr" className="text-start font-mono text-lg font-semibold">{code.username}</dd></div>
        <div><dt className="text-xs text-muted">{L.codeTitle}</dt><dd dir="ltr" data-testid="activation-code" className="text-start font-mono text-2xl font-bold tracking-[0.25em] text-accent-ink">{code.code}</dd></div>
        <div><dt className="text-xs text-muted">{L.expires}</dt><dd className="text-sm">{fmtDateTime(code.expiresAt, locale)}</dd></div>
      </dl>
    </Card>
  );
}
