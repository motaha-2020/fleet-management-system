"use client";
import { useMemo, useState, type FormEvent } from "react";
import { authorize } from "@fleet/domain";
import { fieldError } from "@fleet/i18n";
import { ApiRequestError, type Vehicle } from "@fleet/contracts";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { apiErrorMessage } from "@/lib/errors";
import { fmtDateTime } from "@/lib/format";
import { Alert, Badge, Button, Card, Field, Input, Select, Table, Td } from "./ui";
import { localInputToIso, nowLocalInput } from "./m2-common";

/** E07 on the vehicle page: assignments, handover, custody timeline with explicit gaps. */
export function VehicleCustody({ vehicle }: { vehicle: Vehicle }) {
  const { api, user } = useSession();
  const { t, locale } = useI18n();
  const A = t.m2.assign;
  const can = (a: Parameters<typeof authorize>[1]) => !!user && authorize(user.role, a).allowed;
  const assignments = useLoad(() => api.call("listAssignments", { query: { vehicleId: vehicle.id } }), [api, vehicle.id]);
  const custody = useLoad(() => api.call("vehicleCustody", { params: { id: vehicle.id } }), [api, vehicle.id]);
  const drivers = useLoad(() => (can("driver.read") ? api.call("listDrivers") : Promise.resolve({ items: [] })), [api]);
  const name = useMemo(() => new Map((drivers.data?.items ?? []).map((d) => [d.id, d.fullName])), [drivers.data]);
  const [form, setForm] = useState({ driverId: "", role: "primary" as "primary" | "secondary", startsAt: nowLocalInput() });
  const [ho, setHo] = useState({ toDriverId: "", odometer: "", notes: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const reload = () => Promise.all([assignments.reload(), custody.reload()]);
  async function run(fn: () => Promise<unknown>) {
    setErrors({});
    setMessage(null);
    try { await fn(); await reload(); return true; } catch (err) {
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
    await run(() => api.call("createAssignment", { body: { vehicleId: vehicle.id, driverId: form.driverId, role: form.role, startsAt: localInputToIso(form.startsAt) } }));
  }
  async function handover(e: FormEvent) {
    e.preventDefault();
    if (await run(() => api.call("createHandover", { body: { vehicleId: vehicle.id, toDriverId: ho.toDriverId, odometer: Number(ho.odometer), notes: ho.notes || null } }))) setHo({ toDriverId: "", odometer: "", notes: "" });
  }

  const current = (assignments.data?.items ?? []).filter((a) => !a.endsAt || new Date(a.endsAt) > new Date());
  return (
    <div className="flex flex-col gap-6">
      {message && <Alert>{message}</Alert>}
      <Card className="p-0">
        <h2 className="border-b border-line px-5 py-4 text-lg font-bold">{A.title}</h2>
        {can("assignment.write") && vehicle.status === "active" && (
          <form onSubmit={assign} noValidate className="grid gap-4 border-b border-line p-5 sm:grid-cols-4">
            <Field label={A.driver} error={err("driverId")}>
              <Select value={form.driverId} onChange={(e) => setForm({ ...form, driverId: e.target.value })}>
                <option value="">—</option>
                {(drivers.data?.items ?? []).filter((d) => d.status === "active").map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
              </Select>
            </Field>
            <Field label={A.role}>
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as "primary" | "secondary" })}>
                <option value="primary">{A.primary}</option><option value="secondary">{A.secondary}</option>
              </Select>
            </Field>
            <Field label={A.start} error={err("startsAt")}><Input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></Field>
            <div className="flex items-end"><Button variant="primary" type="submit" disabled={!form.driverId}>{A.add}</Button></div>
            {err("vehicleId") && <p className="text-sm font-medium text-bad sm:col-span-4">{err("vehicleId")}</p>}
          </form>
        )}
        {!assignments.data?.items.length ? <p className="p-5 text-muted">{A.none}</p> : (
          <Table head={[A.driver, A.role, A.start, A.end, ""]}>
            {assignments.data.items.map((a) => (
              <tr key={a.id}>
                <Td className="font-semibold">{name.get(a.driverId) ?? "—"}</Td>
                <Td><Badge tone={a.role === "primary" ? "info" : "muted"}>{a.role === "primary" ? A.primary : A.secondary}</Badge></Td>
                <Td>{fmtDateTime(a.startsAt, locale)}</Td>
                <Td>{a.endsAt ? fmtDateTime(a.endsAt, locale) : <Badge tone="ok">{A.open}</Badge>}</Td>
                <Td>{can("assignment.write") && (!a.endsAt || new Date(a.endsAt) > new Date()) && <Button variant="ghost" className="min-h-8 px-2" onClick={() => run(() => api.call("endAssignment", { params: { id: a.id }, body: {} }))}>{A.endNow}</Button>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {can("handover.create") && current.length > 0 && (
        <Card>
          <h2 className="mb-4 text-lg font-bold">{t.m2.handover.title}</h2>
          <form onSubmit={handover} noValidate className="grid gap-4 sm:grid-cols-4">
            <Field label={t.m2.handover.to} error={err("toDriverId")}>
              <Select value={ho.toDriverId} onChange={(e) => setHo({ ...ho, toDriverId: e.target.value })}>
                <option value="">—</option>
                {current.map((a) => <option key={a.driverId} value={a.driverId}>{name.get(a.driverId) ?? a.driverId}</option>)}
              </Select>
            </Field>
            <Field label={t.m2.handover.odometer} error={err("odometer")}><Input type="number" min="0" value={ho.odometer} onChange={(e) => setHo({ ...ho, odometer: e.target.value })} /></Field>
            <Field label={`${t.m2.handover.notes} (${t.common.optional})`}><Input value={ho.notes} onChange={(e) => setHo({ ...ho, notes: e.target.value })} /></Field>
            <div className="flex items-end"><Button variant="primary" type="submit" disabled={!ho.toDriverId || !ho.odometer}>{t.m2.handover.submit}</Button></div>
          </form>
        </Card>
      )}

      <Card className="p-0">
        <h2 className="border-b border-line px-5 py-4 text-lg font-bold">{t.m2.custody.title}</h2>
        <Table head={[t.m2.custody.from, t.m2.custody.to, A.driver, t.m2.odo.source]}>
          {[...(custody.data?.items ?? [])].reverse().map((c, i) => (
            <tr key={i} className={c.driverId ? "" : "bg-warn-bg/40"}>
              <Td>{fmtDateTime(c.start, locale)}</Td>
              <Td>{fmtDateTime(c.end, locale)}</Td>
              <Td className="font-semibold">{c.driverId ? (name.get(c.driverId) ?? "—") : <span className="text-warn">{t.m2.custody.gap}</span>}</Td>
              <Td>{t.m2.custody.source[c.source]}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
