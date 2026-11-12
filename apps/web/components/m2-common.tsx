"use client";
import { useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { apiErrorMessage } from "@/lib/errors";
import { Badge, Button, Input } from "./ui";

type Quality = "reliable" | "estimated" | "partial" | "unavailable";
type M = { value: number | null; quality: Quality };

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold ${value === t.id ? "border-accent text-accent-ink" : "border-transparent text-muted hover:text-ink"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

const qTone = { reliable: "ok", estimated: "info", partial: "warn", unavailable: "muted" } as const;
export function QualityBadge({ q }: { q: Quality }) {
  const { t } = useI18n();
  return <Badge tone={qTone[q]}>{t.m2.quality[q]}</Badge>;
}

/** GEN-005/011: a KPI is shown with its data quality; missing is "Unavailable", never 0. */
export function MeasuredValue({ m, format }: { m: M; format: (v: number) => ReactNode }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-semibold">{m.value === null ? t.m2.quality.unavailable : format(m.value)}</span>
      {m.value !== null && <QualityBadge q={m.quality} />}
    </span>
  );
}

/** EGP minor units ↔ input text. */
export const toMinor = (s: string) => Math.round(Number(s) * 100);
export const fromMinor = (n: number) => (n / 100).toFixed(2);
export const nowLocalInput = () => {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};
export const localInputToIso = (v: string) => new Date(v).toISOString();

/** Inline "request correction" for one field of a record (GEN-003: no silent edits). */
export function CorrectionButton({ recordType, recordId, field, kind, onDone }: {
  recordType: "fuel_entry" | "meter_reading" | "cost_record"; recordId: string; field: string; kind: "int" | "money" | "number"; onDone?: () => void;
}) {
  const { api } = useSession();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!open) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Button variant="ghost" className="min-h-7 px-2 text-xs" onClick={() => { setOpen(true); setMsg(null); }}>{t.m2.odo.correct}</Button>
        {msg && <span role="status" className={`text-xs ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</span>}
      </span>
    );
  }
  return (
    <form className="flex flex-wrap items-center gap-1.5" onSubmit={async (e) => {
      e.preventDefault();
      const to = kind === "money" ? toMinor(value) : kind === "int" ? parseInt(value, 10) : Number(value);
      try {
        await api.call("requestCorrection", { body: { recordType, recordId, changes: { [field]: to }, reason } });
        setMsg({ ok: true, text: t.m2.corr.requestedOk });
        setOpen(false);
        onDone?.();
      } catch (err) {
        setMsg({ ok: false, text: apiErrorMessage(t, err) });
      }
    }}>
      <Input aria-label={t.m2.corr.newValue} placeholder={t.m2.corr.newValue} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className="min-h-8 w-24" />
      <Input aria-label={t.m2.corr.reason} placeholder={t.m2.corr.reason} value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-8 w-40" />
      <Button type="submit" className="min-h-8 px-2 text-xs" disabled={!value || reason.trim().length < 3}>{t.m2.corr.request}</Button>
      <Button type="button" variant="ghost" className="min-h-8 px-2 text-xs" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
      {msg && <span className={`text-xs ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</span>}
    </form>
  );
}
