"use client";
import { useMemo, useState, type FormEvent } from "react";
import { COUNTRY_TEMPLATES, EGYPT } from "@fleet/config";
import { ApiRequestError, type CreateVehicleRequest } from "@fleet/contracts";
import { authorize, METER_TYPES, OWNERSHIP_TYPES } from "@fleet/domain";
import { fieldError } from "@fleet/i18n";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { newId } from "@/lib/ids";
import { apiErrorMessage } from "@/lib/errors";

type Form = Record<string, string>;
const EMPTY: Form = {
  fleetNumber: "", registrationNumber: "", vin: "", make: "", model: "", year: "", primaryFuelType: "", primaryTankCapacity: "",
  secondaryFuelType: "", secondaryTankCapacity: "", meterType: "distance", requiredLicenseCategory: "", ownershipType: "owned", branchId: "",
};

export default function VehiclesPage() {
  const { api, user } = useSession();
  const { t, locale } = useI18n();
  const country = COUNTRY_TEMPLATES[user?.tenant?.countryCode ?? ""] ?? EGYPT;
  const canWrite = !!user && authorize(user.role, "vehicle.write").allowed;

  const vehicles = useLoad(() => api.call("listVehicles"), [api]);
  const branches = useLoad(() => (user && authorize(user.role, "branch.read").allowed ? api.call("listBranches") : Promise.resolve({ items: [] })), [api, user]);
  const branchName = useMemo(() => new Map(branches.data?.items.map((b) => [b.id, b.name]) ?? []), [branches.data]);
  const fuelName = (code: string | null) => country.fuelTypes.find((f) => f.code === code)?.name[locale] ?? code ?? "—";

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [pendingId, setPendingId] = useState(newId);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const num = (s: string) => (s.trim() === "" ? null : Number(s));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage(null);
    const body: CreateVehicleRequest = {
      id: pendingId,
      branchId: form.branchId || branches.data?.items[0]?.id || "",
      fleetNumber: form.fleetNumber!, registrationNumber: form.registrationNumber!, vin: form.vin || null,
      make: form.make!, model: form.model!, year: Number(form.year),
      primaryFuelType: form.primaryFuelType!, primaryTankCapacity: num(form.primaryTankCapacity!),
      secondaryFuelType: form.secondaryFuelType || null, secondaryTankCapacity: num(form.secondaryTankCapacity!),
      meterType: form.meterType as CreateVehicleRequest["meterType"], requiredLicenseCategory: form.requiredLicenseCategory || null,
      ownershipType: form.ownershipType as CreateVehicleRequest["ownershipType"],
    };
    try {
      await api.call("createVehicle", { body });
      setForm(EMPTY);
      setPendingId(newId());
      setOpen(false);
      setMessage({ tone: "ok", text: t.vehicles.created });
      await vehicles.reload();
    } catch (err) {
      if (err instanceof ApiRequestError) setErrors(err.fields);
      setMessage({ tone: "bad", text: apiErrorMessage(t, err) });
    } finally {
      setBusy(false);
    }
  }

  const err = (k: string) => fieldError(t, errors[k]);
  const L = t.vehicles;

  return (
    <>
      <PageHeader title={L.title} action={canWrite && !open && <Button variant="primary" onClick={() => setOpen(true)}>+ {L.add}</Button>} />
      {message && <div className="mb-4"><Alert tone={message.tone}>{message.text}</Alert></div>}

      {open && (
        <Card className="mb-6">
          <form onSubmit={submit} noValidate>
            <h2 className="mb-4 text-lg font-bold">{L.add}</h2>
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
              <Field label={`${L.primaryTankCapacity} (${unit(country, form.primaryFuelType)})`} error={err("primaryTankCapacity")}>
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
                <Field label={`${L.secondaryTankCapacity} (${unit(country, form.secondaryFuelType)})`} error={err("secondaryTankCapacity")}>
                  <Input type="number" inputMode="decimal" min="0" step="0.1" value={form.secondaryTankCapacity} onChange={set("secondaryTankCapacity")} aria-invalid={!!errors.secondaryTankCapacity} />
                </Field>
              )}
              <Field label={L.meterType}>
                <Select value={form.meterType} onChange={set("meterType")}>{METER_TYPES.map((m) => <option key={m} value={m}>{L.meterTypes[m]}</option>)}</Select>
              </Field>
              <Field label={L.ownershipType}>
                <Select value={form.ownershipType} onChange={set("ownershipType")}>{OWNERSHIP_TYPES.map((o) => <option key={o} value={o}>{L.ownershipTypes[o]}</option>)}</Select>
              </Field>
              {(branches.data?.items.length ?? 0) > 1 && (
                <Field label={L.branch} error={err("branchId")}>
                  <Select value={form.branchId} onChange={set("branchId")}>{branches.data!.items.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
                </Field>
              )}
            </div>
            <div className="mt-5 flex gap-2">
              <Button variant="primary" type="submit" disabled={busy}>{busy ? t.common.loading : t.common.save}</Button>
              <Button type="button" onClick={() => { setOpen(false); setErrors({}); setMessage(null); }}>{t.common.cancel}</Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="p-0">
        {vehicles.loading && !vehicles.data ? (
          <p className="p-6 text-muted">{t.common.loading}</p>
        ) : vehicles.error ? (
          <div className="p-6"><Alert>{t.errors.generic}</Alert></div>
        ) : !vehicles.data?.items.length ? (
          <p className="p-6 text-muted">{L.empty}</p>
        ) : (
          <Table head={[L.fleetNumber, L.registrationNumber, `${L.make} / ${L.model}`, L.year, L.primaryFuelType, L.branch, L.status]}>
            {vehicles.data.items.map((v) => (
              <tr key={v.id}>
                <Td className="font-semibold">{v.fleetNumber}</Td>
                <Td>{v.registrationNumber}</Td>
                <Td>{v.make} {v.model}</Td>
                <Td>{v.year}</Td>
                <Td>{fuelName(v.primaryFuelType)}{v.secondaryFuelType ? ` + ${fuelName(v.secondaryFuelType)}` : ""}</Td>
                <Td>{branchName.get(v.branchId) ?? "—"}</Td>
                <Td><Badge tone={v.status === "active" ? "ok" : v.status === "draft" ? "muted" : "warn"}>{L.statuses[v.status]}</Badge></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

function unit(country: typeof EGYPT, code: string | undefined) {
  return country.fuelTypes.find((f) => f.code === code)?.unit === "m3" ? "m³" : "L";
}
