"use client";
import { useState, type FormEvent } from "react";
import type { CountryTemplate } from "@fleet/config";
import { ApiRequestError, type Branch, type CreateVehicleRequest, type Vehicle } from "@fleet/contracts";
import { METER_TYPES, OWNERSHIP_TYPES } from "@fleet/domain";
import { fieldError } from "@fleet/i18n";
import { useI18n } from "@/lib/i18n";
import { apiErrorMessage } from "@/lib/errors";
import { Alert, Button, Field, Input, Select } from "./ui";

type Form = Record<string, string>;
export type VehicleFields = Omit<CreateVehicleRequest, "id" | "branchId" | "status">;

const fromVehicle = (v?: Vehicle): Form => ({
  fleetNumber: v?.fleetNumber ?? "", registrationNumber: v?.registrationNumber ?? "", vin: v?.vin ?? "", make: v?.make ?? "", model: v?.model ?? "",
  year: v ? String(v.year) : "", primaryFuelType: v?.primaryFuelType ?? "", primaryTankCapacity: v ? String(v.primaryTankCapacity) : "",
  secondaryFuelType: v?.secondaryFuelType ?? "", secondaryTankCapacity: v?.secondaryTankCapacity != null ? String(v.secondaryTankCapacity) : "",
  meterType: v?.meterType ?? "distance", requiredLicenseCategory: v?.requiredLicenseCategory ?? "", ownershipType: v?.ownershipType ?? "owned", branchId: v?.branchId ?? "",
});

/** One form for create and edit (US-E05-01): server field errors are shown next to each field. */
export function VehicleForm({ country, branches, initial, title, onSubmit, onCancel }: {
  country: CountryTemplate;
  branches?: Branch[];
  initial?: Vehicle;
  title: string;
  onSubmit: (fields: VehicleFields, branchId: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { t, locale } = useI18n();
  const L = t.vehicles;
  const [form, setForm] = useState<Form>(() => fromVehicle(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const num = (s: string | undefined) => (!s || s.trim() === "" ? null : Number(s));
  const unit = (code: string | undefined) => (country.fuelTypes.find((f) => f.code === code)?.unit === "m3" ? "m³" : "L");
  const err = (k: string) => fieldError(t, errors[k]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      await onSubmit({
        fleetNumber: form.fleetNumber!, registrationNumber: form.registrationNumber!, vin: form.vin || null,
        make: form.make!, model: form.model!, year: Number(form.year),
        primaryFuelType: form.primaryFuelType!, primaryTankCapacity: num(form.primaryTankCapacity),
        secondaryFuelType: form.secondaryFuelType || null, secondaryTankCapacity: num(form.secondaryTankCapacity),
        meterType: form.meterType as VehicleFields["meterType"], requiredLicenseCategory: form.requiredLicenseCategory || null,
        ownershipType: form.ownershipType as VehicleFields["ownershipType"],
      }, form.branchId || branches?.[0]?.id || "");
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
        <Field label={L.fleetNumber} error={err("fleetNumber")}><Input value={form.fleetNumber} onChange={set("fleetNumber")} aria-invalid={!!errors.fleetNumber} required /></Field>
        <Field label={L.registrationNumber} error={err("registrationNumber")}><Input value={form.registrationNumber} onChange={set("registrationNumber")} aria-invalid={!!errors.registrationNumber} placeholder="ط ب ع 1234" required /></Field>
        <Field label={`${L.vin} (${t.common.optional})`} error={err("vin")}><Input dir="ltr" maxLength={17} value={form.vin} onChange={set("vin")} aria-invalid={!!errors.vin} /></Field>
        <Field label={L.make} error={err("make")}><Input value={form.make} onChange={set("make")} aria-invalid={!!errors.make} required /></Field>
        <Field label={L.model} error={err("model")}><Input value={form.model} onChange={set("model")} aria-invalid={!!errors.model} required /></Field>
        <Field label={L.year} error={err("year")}><Input type="number" inputMode="numeric" value={form.year} onChange={set("year")} aria-invalid={!!errors.year} required /></Field>
        <Field label={L.primaryFuelType} error={err("primaryFuelType")}>
          <Select value={form.primaryFuelType} onChange={set("primaryFuelType")} aria-invalid={!!errors.primaryFuelType} required>
            <option value="">—</option>
            {country.fuelTypes.map((f) => <option key={f.code} value={f.code}>{f.name[locale]}</option>)}
          </Select>
        </Field>
        <Field label={`${L.primaryTankCapacity} (${unit(form.primaryFuelType)})`} error={err("primaryTankCapacity")}>
          <Input type="number" inputMode="decimal" min="0" step="0.1" value={form.primaryTankCapacity} onChange={set("primaryTankCapacity")} aria-invalid={!!errors.primaryTankCapacity} required />
        </Field>
        <Field label={L.requiredLicenseCategory} error={err("requiredLicenseCategory")}>
          <Select value={form.requiredLicenseCategory} onChange={set("requiredLicenseCategory")} aria-invalid={!!errors.requiredLicenseCategory} required>
            <option value="">—</option>
            {country.licenseCategories.map((l) => <option key={l.code} value={l.code}>{l.name[locale]}</option>)}
          </Select>
        </Field>
        <Field label={`${L.secondaryFuelType} (${t.common.optional})`} error={err("secondaryFuelType")}>
          <Select value={form.secondaryFuelType} onChange={set("secondaryFuelType")} aria-invalid={!!errors.secondaryFuelType}>
            <option value="">{t.common.none}</option>
            {country.fuelTypes.map((f) => <option key={f.code} value={f.code}>{f.name[locale]}</option>)}
          </Select>
        </Field>
        {form.secondaryFuelType && (
          <Field label={`${L.secondaryTankCapacity} (${unit(form.secondaryFuelType)})`} error={err("secondaryTankCapacity")}>
            <Input type="number" inputMode="decimal" min="0" step="0.1" value={form.secondaryTankCapacity} onChange={set("secondaryTankCapacity")} aria-invalid={!!errors.secondaryTankCapacity} />
          </Field>
        )}
        <Field label={L.meterType}>
          <Select value={form.meterType} onChange={set("meterType")}>{METER_TYPES.map((m) => <option key={m} value={m}>{L.meterTypes[m]}</option>)}</Select>
        </Field>
        <Field label={L.ownershipType}>
          <Select value={form.ownershipType} onChange={set("ownershipType")}>{OWNERSHIP_TYPES.map((o) => <option key={o} value={o}>{L.ownershipTypes[o]}</option>)}</Select>
        </Field>
        {!initial && (branches?.length ?? 0) > 1 && (
          <Field label={L.branch} error={err("branchId")}>
            <Select value={form.branchId} onChange={set("branchId")}>{branches!.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
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
