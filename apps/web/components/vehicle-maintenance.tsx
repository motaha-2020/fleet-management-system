"use client";
import { useState } from "react";
import { authorize } from "@fleet/domain";
import type { Vehicle } from "@fleet/contracts";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Alert, Badge, Button, Card, Field, Input, Table, Td } from "./ui";
import { toMinor } from "./m2-common";
import { ReadinessCard, WorkOrderForm, WorkOrderTable, inDays, mntTone, useAction } from "./m4-common";

/** Vehicle "Maintenance" tab: readiness (E12), items with due status and forecast (E10), work orders and visits. */
export function VehicleMaintenance({ vehicle }: { vehicle: Vehicle }) {
  const { api, user } = useSession();
  const { t, locale } = useI18n();
  const M = t.m4.maintenance;
  const can = (a: Parameters<typeof authorize>[1]) => !!user && authorize(user.role, a).allowed;
  const canManage = can("maintenance.manage");
  const mnt = useLoad(() => api.call("vehicleMaintenance", { params: { id: vehicle.id } }), [api, vehicle.id]);
  const wos = useLoad(() => api.call("listWorkOrders", { query: { vehicleId: vehicle.id } }), [api, vehicle.id]);
  const visits = useLoad(() => api.call("listVisits", { query: { vehicleId: vehicle.id } }), [api, vehicle.id]);
  const [edit, setEdit] = useState<{ code: string; kind: "interval" | "baseline" } | null>(null);
  const [f, setF] = useState({ km: "", months: "", doneOn: inDays(0), odometer: "" });
  const [panel, setPanel] = useState<null | "wo" | "visit">(null);
  const act = useAction();
  const reload = async () => { await Promise.all([mnt.reload(), wos.reload(), visits.reload()]); };

  const save = async () => {
    if (!edit) return;
    const ok = await act.run(() => edit.kind === "interval"
      ? api.call("setMaintenanceOverride", { params: { id: vehicle.id, code: edit.code }, body: { intervalKm: f.km ? Number(f.km) : null, intervalMonths: f.months ? Number(f.months) : null } })
      : api.call("setMaintenanceBaseline", { params: { id: vehicle.id, code: edit.code }, body: { doneOn: f.doneOn, odometer: f.odometer ? Number(f.odometer) : null } }));
    if (ok) { setEdit(null); await mnt.reload(); }
  };
  const interval = (km: number | null, months: number | null) => [km != null && `${km.toLocaleString(locale)} ${M.km}`, months != null && `${months} ${M.months}`].filter(Boolean).join(" / ") || "—";

  return (
    <div className="flex flex-col gap-4">
      {can("readiness.read") && <ReadinessCard vehicleId={vehicle.id} />}

      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="text-lg font-bold">{M.title}</h2>
          {mnt.data && (
            <div className="flex gap-4 text-sm text-muted">
              <span>{M.currentOdometer}: <b className="text-ink">{mnt.data.currentOdometer?.toLocaleString(locale) ?? "—"}</b></span>
              <span>{M.kmPerDay}: <b className="text-ink">{mnt.data.kmPerDay ?? "—"}</b></span>
            </div>
          )}
        </div>
        {act.error && <div className="p-4"><Alert>{act.error}</Alert></div>}
        {!mnt.data ? <p className="p-5 text-muted">{t.common.loading}</p> : !mnt.data.items.length ? <p className="p-5 text-muted">{M.noItems}</p> : (
          <Table head={[M.item, M.interval, M.baseline, M.status, M.dueAt, M.forecast, ""]}>
            {mnt.data.items.map((i) => (
              <tr key={i.code} className="align-top">
                <Td className="whitespace-normal">
                  <div className="font-medium">{i.name}</div>
                  <div className="flex gap-1"><span className="font-mono text-xs text-muted">{i.code}</span>{i.safety && <Badge tone="bad">{M.safety}</Badge>}</div>
                </Td>
                <Td>{interval(i.intervalKm, i.intervalMonths)}{i.overridden && <div><Badge tone="info">{M.overridden}</Badge></div>}</Td>
                <Td>{i.baseline ? <>{fmtDate(i.baseline.doneOn, locale)}<div className="text-xs text-muted">{i.baseline.odometer?.toLocaleString(locale) ?? "—"} · {M[i.baseline.sourceType]}</div></> : "—"}</Td>
                <Td>
                  <Badge tone={mntTone[i.due.status]}>{M.statuses[i.due.status]}</Badge>
                  {i.due.quality === "estimated" && <div className="text-xs text-muted">{M.quality.estimated}</div>}
                </Td>
                <Td>
                  {i.due.dueKm != null && <div>{i.due.dueKm.toLocaleString(locale)} {M.km} <span className="text-xs text-muted">({i.due.remainingKm?.toLocaleString(locale)})</span></div>}
                  {i.due.dueDate && <div>{fmtDate(i.due.dueDate, locale)} <span className="text-xs text-muted">({i.due.remainingDays} {M.days})</span></div>}
                  {i.due.dueKm == null && !i.due.dueDate && "—"}
                </Td>
                <Td>{i.due.forecastDate ? fmtDate(i.due.forecastDate, locale) : "—"}</Td>
                <Td className="whitespace-normal">
                  {canManage && (edit?.code === i.code ? (
                    <form className="flex min-w-[15rem] flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
                      {edit.kind === "interval" ? <>
                        <Input aria-label={M.km} placeholder={M.km} inputMode="numeric" value={f.km} onChange={(e) => setF({ ...f, km: e.target.value })} />
                        <Input aria-label={M.months} placeholder={M.months} inputMode="numeric" value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} />
                      </> : <>
                        <Input aria-label={M.doneOn} type="date" max={inDays(0)} value={f.doneOn} onChange={(e) => setF({ ...f, doneOn: e.target.value })} />
                        <Input aria-label={M.odometer} placeholder={M.odometer} inputMode="numeric" value={f.odometer} onChange={(e) => setF({ ...f, odometer: e.target.value })} />
                      </>}
                      <div className="flex gap-1">
                        <Button type="submit" variant="primary" className="min-h-8 px-3" disabled={act.busy}>{t.common.save}</Button>
                        <Button type="button" variant="ghost" className="min-h-8 px-3" onClick={() => setEdit(null)}>{t.common.cancel}</Button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      <Button className="min-h-8 px-3" onClick={() => { setEdit({ code: i.code, kind: "interval" }); setF({ ...f, km: i.intervalKm?.toString() ?? "", months: i.intervalMonths?.toString() ?? "" }); }}>{M.setInterval}</Button>
                      <Button className="min-h-8 px-3" onClick={() => { setEdit({ code: i.code, kind: "baseline" }); setF({ ...f, doneOn: i.baseline?.doneOn ?? inDays(0), odometer: i.baseline?.odometer?.toString() ?? "" }); }}>{M.setBaseline}</Button>
                    </div>
                  ))}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-lg font-bold">{t.m4.workOrders.title}</h2>
          {canManage && panel !== "wo" && vehicle.status !== "disposed" && <Button variant="primary" onClick={() => setPanel("wo")}>+ {t.m4.workOrders.add}</Button>}
        </div>
        {panel === "wo" && <div className="border-b border-line"><WorkOrderForm vehicleId={vehicle.id} onCancel={() => setPanel(null)} onDone={() => { setPanel(null); void reload(); }} /></div>}
        {!wos.data?.items.length ? <p className="p-5 text-muted">{t.m4.workOrders.empty}</p> : <WorkOrderTable items={wos.data.items} onChange={() => void reload()} />}
      </Card>

      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-lg font-bold">{t.m4.visits.title}</h2>
            <p className="text-xs text-muted">{t.m4.visits.help}</p>
          </div>
          {canManage && panel !== "visit" && vehicle.status !== "disposed" && <Button variant="primary" onClick={() => setPanel("visit")}>+ {t.m4.visits.add}</Button>}
        </div>
        {panel === "visit" && (
          <div className="border-b border-line">
            <VisitForm vehicleId={vehicle.id} items={mnt.data?.items.map((i) => ({ code: i.code, name: i.name })) ?? []}
              workOrders={(wos.data?.items ?? []).filter((w) => w.status !== "closed" && w.status !== "cancelled").map((w) => ({ id: w.id, label: w.title }))}
              onCancel={() => setPanel(null)} onDone={() => { setPanel(null); void reload(); }} />
          </div>
        )}
        {!visits.data?.items.length ? <p className="p-5 text-muted">{t.m4.visits.empty}</p> : (
          <Table head={[t.m4.visits.date, t.m4.visits.items, t.m4.visits.odometer, t.m4.visits.gross, t.m4.visits.unallocated, t.m4.maintenance.status, ""]}>
            {visits.data.items.map((v) => (
              <tr key={v.id}>
                <Td>{fmtDate(v.visitDate, locale)}<div className="text-xs text-muted">{t.m4.workOrders.types[v.type]}</div></Td>
                <Td className="whitespace-normal">{v.items.join("، ") || "—"}{v.invoiceRef && <div className="text-xs text-muted">{t.m4.visits.invoiceRef}: {v.invoiceRef}</div>}</Td>
                <Td>{v.odometer?.toLocaleString(locale) ?? "—"}</Td>
                <Td className="font-semibold">{v.grossMinor != null ? fmtMoney(v.grossMinor, v.currency, locale) : "—"}</Td>
                <Td>{v.unallocatedMinor ? fmtMoney(v.unallocatedMinor, v.currency, locale) : "—"}</Td>
                <Td><Badge tone={v.status === "completed" ? "ok" : v.status === "draft" ? "warn" : "muted"}>{t.m4.visits.statuses[v.status]}</Badge></Td>
                <Td>
                  {canManage && v.status === "draft" && (
                    <Button className="min-h-8 px-3" disabled={act.busy} onClick={async () => { if (await act.run(() => api.call("completeVisit", { params: { id: v.id } }))) await reload(); }}>{t.m4.visits.completeNow}</Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

function VisitForm({ vehicleId, items, workOrders, onDone, onCancel }: {
  vehicleId: string; items: { code: string; name: string }[]; workOrders: { id: string; label: string }[]; onDone: () => void; onCancel: () => void;
}) {
  const { api } = useSession();
  const { t } = useI18n();
  const V = t.m4.visits;
  const [f, setF] = useState({ type: "preventive" as "preventive" | "corrective" | "accident", visitDate: inDays(0), odometer: "", net: "", tax: "", parts: "", labor: "", other: "", invoiceRef: "", workOrderId: "" });
  const [done, setDone] = useState<string[]>([]);
  const act = useAction();
  const money = (s: string) => (s ? toMinor(s) : null);
  const submit = async (complete: boolean) => {
    const ok = await act.run(() => api.call("createVisit", {
      body: {
        vehicleId, type: f.type, visitDate: f.visitDate, odometer: f.odometer ? Number(f.odometer) : null, workOrderId: f.workOrderId || null,
        netMinor: money(f.net), taxMinor: money(f.tax) ?? 0, partsMinor: money(f.parts), laborMinor: money(f.labor), otherMinor: money(f.other),
        invoiceRef: f.invoiceRef || null, items: done, complete,
      },
    }));
    if (ok) onDone();
  };
  const input = (k: keyof typeof f, label: string, extra: Record<string, unknown> = {}) => (
    <Field label={label} error={act.fe(k === "net" ? "netMinor" : k === "parts" ? "partsMinor" : k)}>
      <Input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} />
    </Field>
  );
  return (
    <form className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => { e.preventDefault(); void submit(true); }}>
      {act.error && <div className="sm:col-span-2 lg:col-span-4"><Alert>{act.error}</Alert></div>}
      <Field label={t.m4.workOrders.type}>
        <select className="min-h-10 rounded-lg border border-[#CBD2D9] bg-surface px-3 text-sm" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as typeof f.type })}>
          {(["preventive", "corrective", "accident"] as const).map((x) => <option key={x} value={x}>{t.m4.workOrders.types[x]}</option>)}
        </select>
      </Field>
      {input("visitDate", V.date, { type: "date", max: inDays(0), required: true })}
      {input("odometer", V.odometer, { inputMode: "numeric" })}
      {workOrders.length > 0 && (
        <Field label={`${V.workOrder} (${t.common.optional})`}>
          <select className="min-h-10 rounded-lg border border-[#CBD2D9] bg-surface px-3 text-sm" value={f.workOrderId} onChange={(e) => setF({ ...f, workOrderId: e.target.value })}>
            <option value="">—</option>
            {workOrders.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
          </select>
        </Field>
      )}
      {input("net", V.net, { inputMode: "decimal" })}
      {input("tax", V.tax, { inputMode: "decimal" })}
      {input("parts", V.parts, { inputMode: "decimal" })}
      {input("labor", V.labor, { inputMode: "decimal" })}
      {input("other", V.other, { inputMode: "decimal" })}
      {input("invoiceRef", V.invoiceRef)}
      {items.length > 0 && (
        <fieldset className="sm:col-span-2 lg:col-span-4">
          <legend className="mb-1.5 text-sm font-medium text-ink-2">{V.items}</legend>
          <div className="flex flex-wrap gap-3">
            {items.map((i) => (
              <label key={i.code} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={done.includes(i.code)} onChange={(e) => setDone(e.target.checked ? [...done, i.code] : done.filter((c) => c !== i.code))} />
                {i.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-4">
        <Button variant="primary" type="submit" disabled={act.busy}>{V.complete}</Button>
        <Button type="button" disabled={act.busy} onClick={() => void submit(false)}>{V.draft}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>{t.common.cancel}</Button>
      </div>
    </form>
  );
}
