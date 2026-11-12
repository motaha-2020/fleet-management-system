"use client";
import { useState, type FormEvent } from "react";
import { ApiRequestError, COST_CATEGORIES } from "@fleet/contracts";
import { fieldError } from "@fleet/i18n";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { apiErrorMessage } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { Alert, Button, Field, Input, Select } from "./ui";
import { toMinor } from "./m2-common";

type Category = (typeof COST_CATEGORIES)[number];

/** Manual cost (FIN-001). Fuel costs come from fuel entries only (FIN-003). */
export function CostForm({ vehicleId, vehicles, branches, onDone, onCancel }: {
  vehicleId?: string; vehicles?: { id: string; fleetNumber: string }[]; branches?: { id: string; name: string }[]; onDone: () => void; onCancel: () => void;
}) {
  const { api } = useSession();
  const { t } = useI18n();
  const C = t.m2.costs;
  const [f, setF] = useState({ category: "corrective" as Category, vehicleId: vehicleId ?? "", branchId: "", net: "", tax: "", date: new Date().toISOString().slice(0, 10), eInvoice: "", description: "" });
  const [id] = useState(newId);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setMessage(null);
    try {
      await api.call("createCost", { body: {
        id, category: f.category, vehicleId: f.vehicleId || null, branchId: f.vehicleId ? null : f.branchId || null,
        netMinor: toMinor(f.net), taxMinor: f.tax ? toMinor(f.tax) : 0, expenseDate: f.date, eInvoiceUuid: f.eInvoice || null, description: f.description || null,
      } });
      onDone();
    } catch (err) {
      if (err instanceof ApiRequestError) setErrors(err.fields);
      setMessage(apiErrorMessage(t, err));
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 p-5 sm:grid-cols-3 lg:grid-cols-4">
      {message && <div className="sm:col-span-3 lg:col-span-4"><Alert>{message}</Alert></div>}
      <Field label={C.category} error={fieldError(t, errors.category)}>
        <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as Category })}>
          {COST_CATEGORIES.filter((c) => c !== "fuel").map((c) => <option key={c} value={c}>{C.categories[c]}</option>)}
        </Select>
      </Field>
      {!vehicleId && vehicles && (
        <Field label={C.vehicle} error={fieldError(t, errors.vehicleId)}>
          <Select value={f.vehicleId} onChange={(e) => setF({ ...f, vehicleId: e.target.value })}>
            <option value="">—</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.fleetNumber}</option>)}
          </Select>
        </Field>
      )}
      {!vehicleId && !f.vehicleId && branches && (
        <Field label={C.branch} error={fieldError(t, errors.branchId)}>
          <Select value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
            <option value="">—</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
      )}
      <Field label={`${C.net} (EGP)`} error={fieldError(t, errors.netMinor)}><Input type="number" min="0" step="0.01" value={f.net} onChange={(e) => setF({ ...f, net: e.target.value })} /></Field>
      <Field label={`${C.tax} (${t.common.optional})`} error={fieldError(t, errors.taxMinor)}><Input type="number" min="0" step="0.01" value={f.tax} onChange={(e) => setF({ ...f, tax: e.target.value })} /></Field>
      <Field label={C.date} error={fieldError(t, errors.expenseDate)}><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label={`${C.eInvoice} (${t.common.optional})`}><Input dir="ltr" value={f.eInvoice} onChange={(e) => setF({ ...f, eInvoice: e.target.value })} /></Field>
      <Field label={`${C.description} (${t.common.optional})`}><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <div className="flex items-end gap-2">
        <Button variant="primary" type="submit" disabled={!f.net}>{t.common.save}</Button>
        <Button type="button" onClick={onCancel}>{t.common.cancel}</Button>
      </div>
    </form>
  );
}
