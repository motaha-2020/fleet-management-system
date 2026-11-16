"use client";
import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { ApiRequestError, TASK_STATUSES } from "@fleet/contracts";
import { allows } from "@fleet/domain";
import { fieldError } from "@fleet/i18n";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { apiErrorMessage } from "@/lib/errors";
import { fmtDateTime } from "@/lib/format";
import { taskTone } from "@/components/task-common";

/** "2026-11-16T08:00" (datetime-local) ⇄ ISO */
const toIso = (local: string) => new Date(local).toISOString();
const localNow = (plusHours = 0) => {
  const d = new Date(Date.now() + plusHours * 3_600_000);
  d.setMinutes(0, 0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

/**
 * Owner decisions (14 Nov 2026): the fleet manager makes a task for one customer — a trip or a period — with one or
 * more vehicles and drivers. Busy vehicles/drivers in the window are marked so they are not double-booked.
 */
export default function TasksPage() {
  const { api, user } = useSession();
  const { t, locale } = useI18n();
  const T = t.tasks;
  const canWrite = allows(user, "task.write").allowed;
  const [status, setStatus] = useState<string>("");
  const list = useLoad(() => api.call("listTasks", { query: status ? { status: status as (typeof TASK_STATUSES)[number] } : {} }), [api, status]);
  const customers = useLoad(() => (canWrite ? api.call("listCustomers") : Promise.resolve({ items: [] })), [api, canWrite]);
  const vehicles = useLoad(() => api.call("listVehicles"), [api]);
  const drivers = useLoad(() => api.call("listDrivers").catch(() => ({ items: [] })), [api]);
  const vName = useMemo(() => new Map((vehicles.data?.items ?? []).map((v) => [v.id, v.fleetNumber])), [vehicles.data]);
  const dName = useMemo(() => new Map((drivers.data?.items ?? []).map((d) => [d.id, d.fullName])), [drivers.data]);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ customerId: "", kind: "trip" as "trip" | "period", title: "", fromPlace: "", toPlace: "", startsAt: localNow(1), endsAt: localNow(9), dailyStart: "", dailyEnd: "", notes: "" });
  const [crew, setCrew] = useState([{ vehicleId: "", driverId: "" }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const win = form.startsAt && form.endsAt && form.endsAt > form.startsAt ? { from: toIso(form.startsAt), to: toIso(form.endsAt) } : null;
  const avail = useLoad(() => (open && win ? api.call("taskAvailability", { query: win }) : Promise.resolve(null)), [api, open, win?.from, win?.to]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setErrors({});
    try {
      await api.call("createTask", { body: {
        customerId: form.customerId, kind: form.kind, title: form.title, fromPlace: form.fromPlace || null, toPlace: form.toPlace || null,
        startsAt: toIso(form.startsAt), endsAt: toIso(form.endsAt), dailyStart: form.dailyStart || null, dailyEnd: form.dailyEnd || null, notes: form.notes || null,
        crew: crew.filter((c) => c.vehicleId && c.driverId),
      } });
      setOpen(false);
      setCrew([{ vehicleId: "", driverId: "" }]);
      await list.reload();
    } catch (err) {
      if (err instanceof ApiRequestError) setErrors(err.fields);
      setMessage(apiErrorMessage(t, err));
    }
  };

  return (
    <>
      <PageHeader title={T.title} action={canWrite && !open && <Button variant="primary" onClick={() => setOpen(true)}>+ {T.add}</Button>} />
      {message && <div className="mb-4"><Alert>{message}</Alert></div>}
      {open && (
        <Card className="mb-6">
          <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
            <Field label={T.customer} error={fieldError(t, errors.customerId)}>
              <Select value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
                <option value="">—</option>
                {customers.data?.items.filter((c) => c.status === "active").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label={T.kind}>
              <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "trip" | "period" })}>
                <option value="trip">{T.kinds.trip}</option><option value="period">{T.kinds.period}</option>
              </Select>
            </Field>
            <div className="sm:col-span-2"><Field label={T.taskTitle} error={fieldError(t, errors.title)}><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field></div>
            {form.kind === "trip" && <>
              <Field label={T.fromPlace} error={fieldError(t, errors.fromPlace)}><Input value={form.fromPlace} onChange={(e) => setForm({ ...form, fromPlace: e.target.value })} /></Field>
              <Field label={T.toPlace} error={fieldError(t, errors.toPlace)}><Input value={form.toPlace} onChange={(e) => setForm({ ...form, toPlace: e.target.value })} /></Field>
            </>}
            <Field label={T.startsAt}><Input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></Field>
            <Field label={T.endsAt} error={fieldError(t, errors.endsAt)}><Input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></Field>
            {form.kind === "period" && (
              <div className="grid grid-cols-2 gap-4 sm:col-span-2">
                <Field label={`${T.dailyHours} — ${T.dailyStart}`}><Input type="time" value={form.dailyStart} onChange={(e) => setForm({ ...form, dailyStart: e.target.value })} /></Field>
                <Field label={T.dailyEnd} error={fieldError(t, errors.dailyEnd)}><Input type="time" value={form.dailyEnd} onChange={(e) => setForm({ ...form, dailyEnd: e.target.value })} /></Field>
              </div>
            )}
            <div className="sm:col-span-2">
              <p className="mb-2 text-sm font-bold">{T.crew}</p>
              {crew.map((c, i) => (
                <div key={i} className="mb-2 grid grid-cols-2 gap-2">
                  <Select aria-label={T.vehicle} value={c.vehicleId} onChange={(e) => setCrew(crew.map((x, j) => (j === i ? { ...x, vehicleId: e.target.value } : x)))}>
                    <option value="">{T.vehicle}</option>
                    {avail.data?.vehicles.map((v) => <option key={v.id} value={v.id} disabled={v.busy}>{v.label}{v.busy ? ` (${T.busy})` : v.restricted ? ` (${T.restricted})` : ""}</option>)}
                  </Select>
                  <Select aria-label={T.driver} value={c.driverId} onChange={(e) => setCrew(crew.map((x, j) => (j === i ? { ...x, driverId: e.target.value } : x)))}>
                    <option value="">{T.driver}</option>
                    {avail.data?.drivers.map((d) => <option key={d.id} value={d.id} disabled={d.busy}>{d.name}{d.busy ? ` (${T.busy})` : ""}</option>)}
                  </Select>
                </div>
              ))}
              {(errors.crew || errors.vehicleId || errors.driverId) && <p className="text-sm text-bad">{fieldError(t, errors.crew ?? errors.vehicleId ?? errors.driverId)}</p>}
              <Button type="button" variant="ghost" onClick={() => setCrew([...crew, { vehicleId: "", driverId: "" }])}>{T.addCrew}</Button>
            </div>
            <div className="sm:col-span-2"><Field label={T.notes}><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field></div>
            <div className="flex gap-2 sm:col-span-2">
              <Button variant="primary" type="submit">{t.common.save}</Button>
              <Button type="button" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
            </div>
          </form>
        </Card>
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        {(["", ...TASK_STATUSES] as const).map((s) => (
          <Button key={s || "all"} variant={status === s ? "primary" : "ghost"} className="min-h-8 px-3" onClick={() => setStatus(s)}>{s ? T.statuses[s] : T.filterAll}</Button>
        ))}
      </div>
      <Card className="p-0">
        {!list.data ? <p className="p-6 text-muted">{t.common.loading}</p> : !list.data.items.length ? <p className="p-6 text-muted">{T.empty}</p> : (
          <Table head={[T.taskTitle, T.customer, T.startsAt, T.crew, T.km, T.status]}>
            {list.data.items.map((k) => (
              <tr key={k.id}>
                <Td className="font-semibold"><Link className="text-accent hover:underline" href={`/tasks/${k.id}`}>{k.title}</Link>
                  <div className="text-xs text-muted">{k.kind === "trip" ? `${k.fromPlace} → ${k.toPlace}` : T.kinds.period}</div></Td>
                <Td>{k.customerName}</Td>
                <Td>{fmtDateTime(k.startsAt, locale)}<div className="text-xs text-muted">{fmtDateTime(k.endsAt, locale)}</div></Td>
                <Td className="whitespace-normal">{k.lines.filter((l) => !l.endedAt || l.endReason === "done").map((l) => `${vName.get(l.vehicleId) ?? "—"} / ${dName.get(l.driverId) ?? "—"}`).join("، ")}</Td>
                <Td>{k.km.toLocaleString("en")}</Td>
                <Td><Badge tone={taskTone[k.status]}>{T.statuses[k.status]}</Badge></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
