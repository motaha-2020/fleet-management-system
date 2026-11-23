"use client";
import { Children, useEffect, useRef, useState, type ButtonHTMLAttributes, type ChangeEvent, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { useI18n } from "@/lib/i18n";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Button({ variant = "secondary", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  return (
    <button
      {...p}
      className={cx(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
        variant === "primary" && "bg-accent text-white shadow-sm shadow-accent/20 hover:bg-accent-ink dark:text-nav",
        variant === "secondary" && "border border-line-strong bg-surface text-ink-2 hover:bg-hover",
        variant === "ghost" && "text-accent hover:bg-accent-soft",
        variant === "danger" && "bg-bad text-white hover:opacity-90",
        className,
      )}
    />
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgb(14_34_51/0.04)]", className)}>{children}</div>;
}

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-ink-2">{label}</span>
      {children}
      {hint && !error && <span className="text-xs text-muted">{hint}</span>}
      {error && <span className="text-xs font-medium text-bad" role="alert">{error}</span>}
    </label>
  );
}

const control = "min-h-10 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink outline-none focus:border-accent aria-[invalid=true]:border-bad";

/** Full width unless the caller sets its own width class (Tailwind can't reliably override w-full). */
const width = (className?: string) => (/(^|\s)w-/.test(className ?? "") ? "" : "w-full");

export function Input(p: InputHTMLAttributes<HTMLInputElement>) {
  if (p.type === "date") return <DateInput {...p} />;
  return <input {...p} className={cx(control, width(p.className), p.className)} />;
}

const toDmy = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
/** "5/3/2026", "05-03-2026" or "05.03.2026" → "2026-03-05"; null when it is not a real date. */
const toIso = (dmy: string): string | null => {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(dmy.trim());
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

/**
 * A date as Tunisia writes it: day/month/year (journey simulation: the browser's own date field showed
 * month/day/year). Typed, or picked from the browser's calendar behind the button. The value stays ISO
 * (yyyy-mm-dd), so pages keep using <Input type="date" value onChange={(e) => e.target.value}>.
 */
function DateInput({ value, onChange, className, min, max, required, disabled, id, "aria-label": ariaLabel }: InputHTMLAttributes<HTMLInputElement>) {
  const { t, locale } = useI18n();
  const iso = typeof value === "string" ? value : "";
  const [text, setText] = useState(toDmy(iso));
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(toDmy(iso)); setBad(false); }, [iso]);
  const native = useRef<HTMLInputElement>(null);
  const emit = (v: string) => onChange?.({ target: { value: v }, currentTarget: { value: v } } as unknown as ChangeEvent<HTMLInputElement>);
  const commit = (s: string) => {
    if (!s.trim()) { setBad(false); if (iso) emit(""); return; }
    const v = toIso(s);
    if (!v || (typeof min === "string" && min && v < min) || (typeof max === "string" && max && v > max)) { setBad(true); return; }
    setBad(false);
    if (v !== iso) emit(v);
  };
  return (
    <div className={cx("relative", width(className), className)}>
      <input id={id} type="text" inputMode="numeric" dir="ltr" autoComplete="off" placeholder={t.common.datePlaceholder} lang={locale}
        aria-label={ariaLabel} required={required} disabled={disabled} aria-invalid={bad || undefined} value={text}
        onChange={(e) => { setText(e.target.value); if (e.target.value.length === 10) commit(e.target.value); }}
        onBlur={(e) => commit(e.target.value)}
        className={cx(control, "w-full pe-11 text-start tabular-nums")} />
      <input ref={native} type="date" tabIndex={-1} aria-hidden="true" value={iso} min={min} max={max}
        onChange={(e) => emit(e.target.value)} className="pointer-events-none absolute inset-0 h-full w-full opacity-0" />
      <button type="button" disabled={disabled} aria-label={t.common.pickDate} title={t.common.pickDate}
        onClick={() => { const n = native.current; if (!n) return; try { n.showPicker(); } catch { n.focus(); n.click(); } }}
        className="absolute inset-y-0 end-0 flex w-11 items-center justify-center rounded-e-lg text-muted hover:text-ink disabled:opacity-50">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>
      </button>
    </div>
  );
}

/** A password field with a show / hide button (labels come from the caller, so they are translated). */
export function PasswordInput({ showLabel, hideLabel, ...p }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { showLabel: string; hideLabel: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input {...p} type={shown ? "text" : "password"} dir="ltr" className={cx(control, "w-full pe-11", p.className)} />
      <button type="button" onClick={() => setShown((v) => !v)} aria-label={shown ? hideLabel : showLabel} aria-pressed={shown} title={shown ? hideLabel : showLabel}
        className="absolute inset-y-0 end-0 flex w-11 items-center justify-center rounded-e-lg text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />
          {shown && <path d="M3 3l18 18" />}
        </svg>
      </button>
    </div>
  );
}

export function Checkbox({ label, hint, ...p }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input {...p} type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-accent" />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium text-ink-2">{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function Select({ children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cx(control, width(p.className), p.className)}>{children}</select>;
}

export function Badge({ tone = "info", children }: { tone?: "ok" | "warn" | "bad" | "info" | "muted"; children: ReactNode }) {
  const tones = {
    ok: "bg-ok-bg text-ok", warn: "bg-warn-bg text-warn", bad: "bg-bad-bg text-bad", info: "bg-accent-soft text-accent-ink", muted: "bg-sunk text-muted",
  };
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", tones[tone])}>{children}</span>;
}

export function Alert({ tone = "bad", children }: { tone?: "ok" | "bad" | "info"; children: ReactNode }) {
  const tones = { ok: "bg-ok-bg text-ok", bad: "bg-bad-bg text-bad", info: "bg-accent-soft text-accent-ink" };
  return <div role={tone === "bad" ? "alert" : "status"} className={cx("rounded-lg px-4 py-3 text-sm font-medium", tones[tone])}>{children}</div>;
}

/**
 * A data table. On phones each row turns into a card (globals.css .rtable); every cell is labelled with its
 * column name here, after each render, so pages keep writing plain <tr><Td/></tr>.
 */
export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  const { t } = useI18n();
  const hasRows = Children.toArray(children).length > 0;
  const ref = useRef<HTMLTableElement>(null);
  useEffect(() => {
    const table = ref.current;
    if (!table) return;
    const names = [...table.tHead?.rows[0]?.cells ?? []].map((c) => c.innerText.trim());
    for (const row of table.tBodies[0]?.rows ?? []) {
      [...row.cells].forEach((cell, i) => { if (cell.colSpan === 1) cell.dataset.label = names[i] ?? ""; else cell.dataset.label = ""; });
    }
  });
  return (
    <div className="overflow-x-auto">
      <table ref={ref} className="rtable w-full border-collapse">
        <thead>
          <tr>{head.map((h, i) => <th key={i} className="border-b border-line bg-sunk px-3 py-2.5 text-start align-bottom text-xs font-semibold text-muted first:rounded-ss-lg last:rounded-se-lg">{h}</th>)}</tr>
        </thead>
        {/* No rows: say so (on phones the header is hidden, so an empty table showed an empty box). */}
        <tbody>{hasRows ? children : <tr><td colSpan={head.length} className="px-4 py-8 text-center text-sm text-muted">{empty ?? t.common.empty}</td></tr>}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cx("whitespace-nowrap border-b border-line-2 px-3 py-3 text-sm", className)}>{children}</td>;
}

export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">{title}</h1>
      {action}
    </div>
  );
}
