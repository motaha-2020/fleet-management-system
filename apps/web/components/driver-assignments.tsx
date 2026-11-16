"use client";
import { useMemo, useState, type FormEvent } from "react";
import { allows } from "@fleet/domain";
import { fieldError } from "@fleet/i18n";
import { ApiRequestError, type Driver } from "@fleet/contracts";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { apiErrorMessage } from "@/lib/errors";
import { fmtDateTime } from "@/lib/format";
import { Alert, Badge, Button, Card, Field, Input, Select, Table, Td } from "./ui";
import { localInputToIso, nowLocalInput } from "./m2-common";

/**
 * E07 from the driver's side: which vehicles this driver holds, and assigning one from here. The driver app
 * shows only vehicles with a current assignment, so the page says so when there is none.
 */
export function DriverAssignments({ driver }: { driver: Driver }) {
  const { api, user } = useSession();
  const { t, locale } = useI18n();
  const A = t.m2.assign;
  const can = (a: Parameters<typeof allows>[1]) => !!user && allows(user, a).allowed;
  const assignments = useLoad(() => api.call("listAssignments", { query: { driverId: driver.id } }), [api, driver.id]);
  const vehicles = useLoad(() => (can("vehicle.read") ? api.call("listVehicles") : Promise.resolve({ items: [] })), [api]);
  const vehicleName = useMemo(() => new Map((vehicles.data?.items ?? []).map((v) => [v.id, `${v.fleetNumber} · ${v.registrationNumber}`])), [vehicles.data]);
  const [form, setForm] = useState({ vehicleId: "", role: "primary" as "primary" | "secondary", startsAt: nowLocalInput() });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setErrors({});
    setMessage(null);
    try { await fn(); await assignments.reload(); return true; } catch (err) {
      if (err instanceof ApiRequestError) setErrors(err.fields);
      setMessage(apiErrorMessage(t, err));
      return false;
    }
  }
  const err = (k: string) => {
    const v = errors[k];
    if (!v) return undefined;
    const code = v.split(":")[0]!;
    return (A.blocks as Record<string, string>)[code] ?? (code.endsWith("_primary") || code === "same_pair" ? A.overlap : fieldError(t, v));
  };
  async function assign(e: FormEvent) {
    e.preventDefault();
    if (await run(() => api.call("createAssignment", { body: { vehicleId: form.vehicleId, driverId: driver.id, role: form.role, startsAt: localInputToIso(form.startsAt) } }))) {
      setForm({ vehicleId: "", role: "primary", startsAt: nowLocalInput() });
    }
  }

  const items = assignments.data?.items ?? [];
  const current = items.filter((a) => a.status === "active" && (!a.endsAt || new Date(a.endsAt) > new Date()));
  const usable = (vehicles.data?.items ?? []).filter((v) => v.status === "active");

  return (
    <Card className="p-0">
      <h2 className="border-b border-line px-5 py-4 text-lg font-bold">{A.driverTitle}</h2>
      {message && <div className="p-5 pb-0"><Alert>{message}</Alert></div>}
      {assignments.data && !current.length && <div className="p-5 pb-0"><Alert tone="info">{A.noVehicleHint}</Alert></div>}
      {can("assignment.write") && driver.status === "active" && driver.employmentStatus !== "terminated" && (
        <form onSubmit={assign} noValidate className="grid gap-4 border-b border-line p-5 sm:grid-cols-4">
          <Field label={A.vehicle} error={err("vehicleId")}>
            <Select value={form.vehicleId} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}>
              <option value="">—</option>
              {usable.map((v) => <option key={v.id} value={v.id}>{v.fleetNumber} · {v.registrationNumber}</option>)}
            </Select>
          </Field>
          <Field label={A.role}>
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as "primary" | "secondary" })}>
              <option value="primary">{A.primary}</option><option value="secondary">{A.secondary}</option>
            </Select>
          </Field>
          <Field label={A.start} error={err("startsAt")}><Input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></Field>
          <div className="flex items-end"><Button variant="primary" type="submit" disabled={!form.vehicleId}>{A.assignVehicle}</Button></div>
          {err("driverId") && <p className="text-sm font-medium text-bad sm:col-span-4">{err("driverId")}</p>}
        </form>
      )}
      {!items.length ? <p className="p-5 text-muted">{A.none}</p> : (
        <Table head={[A.vehicle, A.role, A.start, A.end, ""]}>
          {items.map((a) => (
            <tr key={a.id}>
              <Td>{vehicleName.get(a.vehicleId) ?? a.vehicleId.slice(0, 8)}</Td>
              <Td><Badge tone={a.role === "primary" ? "info" : "muted"}>{a.role === "primary" ? A.primary : A.secondary}</Badge></Td>
              <Td>{fmtDateTime(a.startsAt, locale)}</Td>
              <Td>{a.endsAt ? fmtDateTime(a.endsAt, locale) : <Badge tone="ok">{A.open}</Badge>}</Td>
              <Td>{can("assignment.write") && a.status === "active" && (!a.endsAt || new Date(a.endsAt) > new Date()) && (
                <Button variant="ghost" className="min-h-8 px-2" onClick={() => run(() => api.call("endAssignment", { params: { id: a.id }, body: {} }))}>{A.endNow}</Button>
              )}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
