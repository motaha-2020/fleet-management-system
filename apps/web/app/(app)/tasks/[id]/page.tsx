"use client";
import { use, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import type { TaskLine } from "@fleet/contracts";
import { allows } from "@fleet/domain";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { taskTone } from "@/components/task-common";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { apiErrorMessage } from "@/lib/errors";
import { fmtDateTime } from "@/lib/format";

type Action = { kind: "swap" | "start" | "finish"; line: TaskLine } | { kind: "cancel" } | null;

/**
 * One task: its crew lines over time. A breakdown or driver change ends a line and starts a replacement (the task and
 * its customer stay); the office can start or finish a line for a driver with the odometer.
 */
export default function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { api, user } = useSession();
  const { t, locale } = useI18n();
  const T = t.tasks;
  const canWrite = allows(user, "task.write").allowed;
  const task = useLoad(() => api.call("getTask", { params: { id } }), [api, id]);
  const vehicles = useLoad(() => api.call("listVehicles"), [api]);
  const drivers = useLoad(() => api.call("listDrivers").catch(() => ({ items: [] })), [api]);
  const vName = useMemo(() => new Map((vehicles.data?.items ?? []).map((v) => [v.id, `${v.fleetNumber} · ${v.registrationNumber}`])), [vehicles.data]);
  const dName = useMemo(() => new Map((drivers.data?.items ?? []).map((d) => [d.id, d.fullName])), [drivers.data]);
  const [action, setAction] = useState<Action>(null);
  const [form, setForm] = useState({ vehicleId: "", driverId: "", reason: "breakdown", odometer: "", note: "", cancelReason: "" });
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const k = task.data;
  const live = !!k && (k.status === "planned" || k.status === "in_progress");
  const avail = useLoad(() => (action?.kind === "swap" && k ? api.call("taskAvailability", { query: { from: new Date().toISOString(), to: k.endsAt, excludeTaskId: k.id } }) : Promise.resolve(null)), [api, action?.kind, k?.id]);

  async function run(fn: () => Promise<unknown>) {
    setMessage(null);
    try {
      await fn();
      setAction(null);
      setForm({ vehicleId: "", driverId: "", reason: "breakdown", odometer: "", note: "", cancelReason: "" });
      await task.reload();
      setMessage({ tone: "ok", text: T.saved });
    } catch (err) {
      setMessage({ tone: "bad", text: apiErrorMessage(t, err) });
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!action || !k) return;
    const odo = form.odometer ? parseInt(form.odometer, 10) : undefined;
    if (action.kind === "cancel") return void run(() => api.call("cancelTask", { params: { id }, body: { reason: form.cancelReason } }));
    if (action.kind === "swap") {
      return void run(() => api.call("swapTaskCrew", { params: { id }, body: {
        lineId: action.line.id, reason: form.reason as "breakdown" | "driver_change" | "other", note: form.note || null,
        ...(form.vehicleId ? { vehicleId: form.vehicleId } : {}), ...(form.driverId ? { driverId: form.driverId } : {}), ...(odo != null ? { odometer: odo } : {}),
      } }));
    }
    if (odo == null) return;
    return void run(() => api.call(action.kind === "start" ? "startTaskLine" : "finishTaskLine", { params: { id }, body: { lineId: action.line.id, odometer: odo } }));
  };

  if (!k) return <p className="text-muted">{task.error ? apiErrorMessage(t, task.error) : t.common.loading}</p>;
  return (
    <>
      <PageHeader title={k.title} action={canWrite && live && <Button variant="ghost" onClick={() => setAction({ kind: "cancel" })}>{T.cancel}</Button>} />
      <p className="mb-4 text-sm"><Link className="text-accent hover:underline" href="/tasks">← {T.title}</Link></p>
      {message && <div className="mb-4"><Alert tone={message.tone}>{message.text}</Alert></div>}
      <Card className="mb-6 grid gap-3 sm:grid-cols-4">
        <div><p className="text-xs text-muted">{T.customer}</p><p className="font-semibold">{k.customerName}</p></div>
        <div><p className="text-xs text-muted">{T.kind}</p><p>{k.kind === "trip" ? `${k.fromPlace} → ${k.toPlace}` : T.kinds.period}{k.dailyStart ? ` · ${k.dailyStart}–${k.dailyEnd}` : ""}</p></div>
        <div><p className="text-xs text-muted">{T.startsAt} / {T.endsAt}</p><p>{fmtDateTime(k.startsAt, locale)}<br />{fmtDateTime(k.endsAt, locale)}</p></div>
        <div><p className="text-xs text-muted">{T.status}</p><Badge tone={taskTone[k.status]}>{T.statuses[k.status]}</Badge>
          <p className="mt-1 text-sm">{T.km}: {k.km.toLocaleString("en")}{k.downtimeMinutes ? ` · ${T.downtime}: ${k.downtimeMinutes} ${T.minutes}` : ""}</p>
          {k.decisionReason && <p className="mt-1 text-xs text-muted">{k.decisionReason}</p>}</div>
      </Card>

      {action && (
        <Card className="mb-6 border-accent">
          <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
            <h2 className="text-lg font-bold sm:col-span-2">
              {action.kind === "swap" ? T.swapTitle : action.kind === "start" ? T.startTitle : action.kind === "finish" ? T.finishTitle : T.cancel}
            </h2>
            {action.kind === "swap" && <>
              <p className="text-sm text-muted sm:col-span-2">{T.swapHelp}</p>
              <Field label={T.reason}>
                <Select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
                  {(["breakdown", "driver_change", "other"] as const).map((r) => <option key={r} value={r}>{T.reasons[r]}</option>)}
                </Select>
              </Field>
              <Field label={T.endOdometer}><Input inputMode="numeric" dir="ltr" value={form.odometer} onChange={(e) => setForm({ ...form, odometer: e.target.value.replace(/\D/g, "") })} /></Field>
              <Field label={T.newVehicle}>
                <Select value={form.vehicleId} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}>
                  <option value="">{T.same}</option>
                  {avail.data?.vehicles.filter((v) => v.id !== action.line.vehicleId).map((v) => <option key={v.id} value={v.id} disabled={v.busy || v.restricted}>{v.label}{v.busy ? ` (${T.busy})` : v.restricted ? ` (${T.restricted})` : ""}</option>)}
                </Select>
              </Field>
              <Field label={T.newDriver}>
                <Select value={form.driverId} onChange={(e) => setForm({ ...form, driverId: e.target.value })}>
                  <option value="">{T.same}</option>
                  {avail.data?.drivers.filter((d) => d.id !== action.line.driverId).map((d) => <option key={d.id} value={d.id} disabled={d.busy}>{d.name}{d.busy ? ` (${T.busy})` : ""}</option>)}
                </Select>
              </Field>
              <div className="sm:col-span-2"><Field label={T.notes}><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field></div>
            </>}
            {(action.kind === "start" || action.kind === "finish") && (
              <Field label={T.odometer}><Input inputMode="numeric" dir="ltr" required value={form.odometer} onChange={(e) => setForm({ ...form, odometer: e.target.value.replace(/\D/g, "") })} /></Field>
            )}
            {action.kind === "cancel" && (
              <div className="sm:col-span-2"><Field label={T.cancelReason}><Input value={form.cancelReason} onChange={(e) => setForm({ ...form, cancelReason: e.target.value })} /></Field></div>
            )}
            <div className="flex gap-2 sm:col-span-2">
              <Button variant="primary" type="submit">{t.common.save}</Button>
              <Button type="button" onClick={() => setAction(null)}>{t.common.cancel}</Button>
            </div>
          </form>
        </Card>
      )}

      <h2 className="mb-3 text-lg font-bold">{T.lines}</h2>
      <Card className="p-0">
        <Table head={[T.vehicle, T.driver, T.from, T.started, T.ended, T.odometer, T.km, T.reason, ""]}>
          {k.lines.map((l) => (
            <tr key={l.id} className={l.endedAt && l.endReason !== "done" ? "opacity-70" : ""}>
              <Td className="font-semibold">{vName.get(l.vehicleId) ?? "—"}{l.replacesLineId && <div className="text-xs font-normal text-muted">{T.replaces}</div>}</Td>
              <Td>{dName.get(l.driverId) ?? "—"}</Td>
              <Td>{fmtDateTime(l.fromAt, locale)}</Td>
              <Td>{l.startedAt ? fmtDateTime(l.startedAt, locale) : "—"}</Td>
              <Td>{l.endedAt ? fmtDateTime(l.endedAt, locale) : "—"}</Td>
              <Td>{l.startOdometer != null ? l.startOdometer.toLocaleString("en") : "—"} → {l.endOdometer != null ? l.endOdometer.toLocaleString("en") : "—"}</Td>
              <Td>{l.km ?? "—"}</Td>
              <Td>{l.endReason ? <Badge tone={l.endReason === "done" ? "ok" : l.endReason === "breakdown" ? "bad" : "warn"}>{T.reasons[l.endReason]}</Badge> : "—"}</Td>
              <Td>
                {canWrite && live && !l.endedAt && (
                  <div className="flex gap-1">
                    {!l.startedAt && <Button variant="ghost" className="min-h-8 px-2" onClick={() => setAction({ kind: "start", line: l })}>{T.start}</Button>}
                    {l.startedAt && <Button variant="ghost" className="min-h-8 px-2" onClick={() => setAction({ kind: "finish", line: l })}>{T.finish}</Button>}
                    <Button variant="ghost" className="min-h-8 px-2" onClick={() => setAction({ kind: "swap", line: l })}>{T.swap}</Button>
                  </div>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
