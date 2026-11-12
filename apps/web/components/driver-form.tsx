"use client";
import { useState, type FormEvent } from "react";
import type { CountryTemplate } from "@fleet/config";
import { ApiRequestError, type Branch, type Driver } from "@fleet/contracts";
import { fieldError } from "@fleet/i18n";
import { useI18n } from "@/lib/i18n";
import { apiErrorMessage } from "@/lib/errors";
import { Alert, Button, Field, Input, Select } from "./ui";

export interface DriverFields {
  fullName: string; username: string; phone: string | null; branchId: string; employeeRef: string | null;
  nationalId: string | null | undefined; licenseNumber: string | null; licenseCategories: string[]; licenseExpiry: string | null;
}

/** Create and edit. On edit, the national ID field stays empty unless the user types a new one. */
export function DriverForm({ country, branches, initial, title, onSubmit, onCancel }: {
  country: CountryTemplate; branches: Branch[]; initial?: Driver; title: string;
  onSubmit: (f: DriverFields) => Promise<void>; onCancel: () => void;
}) {
  const { t, locale } = useI18n();
  const L = t.drivers;
  const D = t.driver;
  const [f, setF] = useState({
    fullName: initial?.fullName ?? "", username: initial?.username ?? "", phone: initial?.phone ?? "", branchId: initial?.branchId ?? "",
    employeeRef: initial?.employeeRef ?? "", nationalId: "", licenseNumber: initial?.licenseNumber ?? "",
    licenseCategories: initial?.licenseCategories ?? ([] as string[]), licenseExpiry: initial?.licenseExpiry ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const err = (k: string) => fieldError(t, errors[k]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      await onSubmit({
        fullName: f.fullName, username: f.username, phone: f.phone || null, branchId: f.branchId || branches[0]?.id || "",
        employeeRef: f.employeeRef || null, nationalId: f.nationalId ? f.nationalId : initial ? undefined : null,
        licenseNumber: f.licenseNumber || null, licenseCategories: f.licenseCategories, licenseExpiry: f.licenseExpiry || null,
      });
    } catch (error) {
      if (error instanceof ApiRequestError) setErrors(error.fields);
      setMessage(apiErrorMessage(t, error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <h2 className="mb-4 text-lg font-bold">{title}</h2>
      {message && <div className="mb-4"><Alert>{message}</Alert></div>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={L.fullName} error={err("fullName")}><Input value={f.fullName} onChange={set("fullName")} required /></Field>
        {!initial && <Field label={L.username} error={err("username")} hint="a-z 0-9 . _ -"><Input dir="ltr" autoCapitalize="none" value={f.username} onChange={set("username")} required /></Field>}
        <Field label={`${L.phone} (${t.common.optional})`} error={err("phone")}><Input dir="ltr" type="tel" value={f.phone} onChange={set("phone")} placeholder="01xxxxxxxxx" /></Field>
        <Field label={`${D.employeeRef} (${t.common.optional})`} error={err("employeeRef")}><Input dir="ltr" value={f.employeeRef} onChange={set("employeeRef")} /></Field>
        <Field label={`${D.nationalId} (${t.common.optional})`} error={err("nationalId")} hint={initial?.nationalIdMasked ?? undefined}>
          <Input dir="ltr" inputMode="numeric" maxLength={20} value={f.nationalId} onChange={set("nationalId")} autoComplete="off" />
        </Field>
        <Field label={`${D.licenseNumber} (${t.common.optional})`} error={err("licenseNumber")}><Input dir="ltr" value={f.licenseNumber} onChange={set("licenseNumber")} /></Field>
        <Field label={`${D.licenseExpiry} (${t.common.optional})`} error={err("licenseExpiry")}><Input type="date" value={f.licenseExpiry} onChange={set("licenseExpiry")} /></Field>
        <fieldset className="flex flex-col gap-1.5 text-sm sm:col-span-2">
          <legend className="mb-1.5 font-medium text-ink-2">{D.licenseCategories}</legend>
          <div className="flex flex-wrap gap-3">
            {country.licenseCategories.map((l) => (
              <label key={l.code} className="flex items-center gap-1.5">
                <input type="checkbox" checked={f.licenseCategories.includes(l.code)}
                  onChange={(e) => setF((x) => ({ ...x, licenseCategories: e.target.checked ? [...x.licenseCategories, l.code] : x.licenseCategories.filter((c) => c !== l.code) }))} />
                {l.name[locale]}
              </label>
            ))}
          </div>
          {err("licenseCategories") && <span className="text-xs font-medium text-bad">{err("licenseCategories")}</span>}
        </fieldset>
        {branches.length > 1 && (
          <Field label={L.branch} error={err("branchId")}>
            <Select value={f.branchId || branches[0]?.id} onChange={set("branchId")}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
          </Field>
        )}
      </div>
      <div className="mt-5 flex gap-2">
        <Button variant="primary" type="submit" disabled={busy}>{busy ? t.common.loading : t.common.save}</Button>
        <Button type="button" onClick={onCancel}>{t.common.cancel}</Button>
      </div>
    </form>
  );
}
