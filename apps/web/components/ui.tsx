"use client";
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";

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
  return <input {...p} className={cx(control, width(p.className), p.className)} />;
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
export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
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
          <tr>{head.map((h, i) => <th key={i} className="whitespace-nowrap border-b border-line bg-sunk px-3 py-2.5 text-start text-xs font-semibold text-muted first:rounded-ss-lg last:rounded-se-lg">{h}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
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
