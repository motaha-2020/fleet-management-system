"use client";
import { useMemo, useState, type FormEvent } from "react";
import { COUNTRY_TEMPLATES, EGYPT } from "@fleet/config";
import { allows } from "@fleet/domain";
import { ApiRequestError, type Vehicle } from "@fleet/contracts";
import { fieldError } from "@fleet/i18n";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { apiErrorMessage } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { Alert, Button, Card, Field, Input, Select } from "./ui";
import { FuelTable } from "./fuel-table";
import { MeasuredValue, localInputToIso, nowLocalInput, toMinor, fromMinor } from "./m2-common";

/** E09 on the vehicle page: Full-to-Full per fuel type (with data quality), purchased quantity, entries. */
export function VehicleFuel({ vehicle }: { vehicle: Vehicle }) {
  const { api, user } = useSession();
  const { t, locale } = useI18n();
  const F = t.m2.fuel;
  const country = COUNTRY_TEMPLATES[user?.tenant?.countryCode ?? ""] ?? EGYPT;
  const can = (a: Parameters<typeof allows>[1]) => !!user && allows(user, a).allowed;
  const entries = useLoad(() => api.call("listFuelEntries", { query: { vehicleId: vehicle.id } }), [api, vehicle.id]);
  const stats = useLoad(() => api.call("vehicleFuelStats", { params: { id: vehicle.id } }), [api, vehicle.id]);
  const drivers = useLoad(() => (can("driver.read") ? api.call("listDrivers") : Promise.resolve({ items: [] })), [api]);
  const dName = useMemo(() => new Map((drivers.data?.items ?? []).map((d) => [d.id, d.fullName])), [drivers.data]);
  const fuelName = (code: string) => country.fuelTypes.find((f) => f.code === code)?.name[locale] ?? code;
  const types = [vehicle.primaryFuelType, ...(vehicle.secondaryFuelType ? [vehicle.secondaryFuelType] : [])];

  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ driverId: "", at: nowLocalInput(), odometer: "", fuelType: types[0]!, quantity: "", amount: "", isFull: true, payment: "card" as "cash" | "card", receiptRef: "" });
  const [file, setFile] = useState<File | null>(null);
  const [pendingId, setPendingId] = useState(newId);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = () => Promise.all([entries.reload(), stats.reload()]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.payment === "cash" && !file) return setErrors({ receipt: "required" });
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      const entry = await api.call("createFuelEntry", { body: {
        id: pendingId, vehicleId: vehicle.id, driverId: f.driverId || null, eventAt: localInputToIso(f.at), odometer: Number(f.odometer),
        fuelType: f.fuelType, quantity: Number(f.quantity), amountMinor: toMinor(f.amount), isFull: f.isFull, payment: f.payment, receiptRef: f.receiptRef || null,
      } });
      if (file) await api.upload("uploadFuelReceipt", { id: entry.id }, file, file.name);
      setOpen(false);
      setPendingId(newId());
      setFile(null);
      setF({ ...f, odometer: "", quantity: "", amount: "", receiptRef: "" });
      setMessage({ tone: "ok", text: F.saved });
      await reload();
    } catch (err) {
      if (err instanceof ApiRequestError) setErrors(err.fields);
      setMessage({ tone: "bad", text: apiErrorMessage(t, err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        {(stats.data?.consumption ?? []).map((c) => {
          const p = stats.data!.purchased.find((x) => x.fuelType === c.fuelType);
          return (
            <Card key={c.fuelType}>
              <div className="text-sm font-semibold text-muted">{fuelName(c.fuelType)}</div>
              <div className="mt-2 flex flex-col gap-1.5 text-sm">
                <div>{F.consumption}: <MeasuredValue m={c} format={(v) => `${v.toFixed(1)} ${p?.unit === "m3" ? F.per100m3 : F.per100}`} /></div>
                <div>{F.purchased}: <span className="font-semibold">{p?.quantity ?? 0} {p?.unit === "m3" ? "m³" : "L"}</span> · {fromMinor(p?.grossMinor ?? 0)} EGP</div>
              </div>
            </Card>
          );
        })}
      </div>
      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-lg font-bold">{F.title}</h2>
          {can("fuel.create") && vehicle.status === "active" && !open && <Button variant="primary" onClick={() => setOpen(true)}>+ {F.add}</Button>}
        </div>
        {open && (
          <form onSubmit={submit} noValidate className="grid gap-4 border-b border-line p-5 sm:grid-cols-3 lg:grid-cols-4">
            <Field label={`${F.driver} (${t.common.optional})`}>
              <Select value={f.driverId} onChange={(e) => setF({ ...f, driverId: e.target.value })}>
                <option value="">—</option>
                {(drivers.data?.items ?? []).map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
              </Select>
            </Field>
            <Field label={F.at} error={fieldError(t, errors.eventAt)}><Input type="datetime-local" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} /></Field>
            <Field label={F.odometer} error={fieldError(t, errors.odometer)}><Input type="number" min="0" value={f.odometer} onChange={(e) => setF({ ...f, odometer: e.target.value })} /></Field>
            <Field label={F.type} error={fieldError(t, errors.fuelType)}>
              <Select value={f.fuelType} onChange={(e) => setF({ ...f, fuelType: e.target.value })}>{types.map((x) => <option key={x} value={x}>{fuelName(x)}</option>)}</Select>
            </Field>
            <Field label={F.quantity} error={fieldError(t, errors.quantity)}><Input type="number" min="0" step="0.01" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
            <Field label={`${F.amount} (EGP)`} error={fieldError(t, errors.amountMinor)}><Input type="number" min="0" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
            <Field label={F.payment}>
              <Select value={f.payment} onChange={(e) => setF({ ...f, payment: e.target.value as "cash" | "card" })}><option value="card">{F.card}</option><option value="cash">{F.cash}</option></Select>
            </Field>
            <Field label={`${F.receiptRef} (${t.common.optional})`}><Input value={f.receiptRef} onChange={(e) => setF({ ...f, receiptRef: e.target.value })} /></Field>
            <Field label={F.receipt} error={errors.receipt ? F.receiptRequired : undefined}>
              <Input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="py-1.5" />
            </Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isFull} onChange={(e) => setF({ ...f, isFull: e.target.checked })} />{F.full}</label>
            <div className="flex items-end gap-2 sm:col-span-2">
              <Button variant="primary" type="submit" disabled={busy || !f.odometer || !f.quantity || !f.amount}>{busy ? t.common.loading : t.common.save}</Button>
              <Button type="button" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
            </div>
          </form>
        )}
        {!entries.data?.items.length ? <p className="p-5 text-muted">{F.empty}</p> : (
          <FuelTable items={entries.data.items} onChange={() => void reload()} driverName={(id) => (id ? dName.get(id) ?? "—" : "—")} />
        )}
      </Card>
    </div>
  );
}
