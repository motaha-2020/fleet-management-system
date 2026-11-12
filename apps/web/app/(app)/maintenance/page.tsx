"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { authorize } from "@fleet/domain";
import type { Defect, MaintenanceTemplate } from "@fleet/contracts";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { Tabs } from "@/components/m2-common";
import { WorkOrderForm, WorkOrderTable, mntTone, useAction } from "@/components/m4-common";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { fmtDate, fmtDateTime, saveDownload } from "@/lib/format";

type Tab = "due" | "workOrders" | "defects" | "templates";

/** E10 maintenance desk: what is due across the fleet, work orders, defect triage and templates. */
export default function MaintenancePage() {
  const { api, user } = useSession();
  const { t } = useI18n();
  const can = (a: Parameters<typeof authorize>[1]) => !!user && authorize(user.role, a).allowed;
  const [tab, setTab] = useState<Tab>("due");
  const vehicles = useLoad(() => api.call("listVehicles"), [api]);
  const names = useMemo(() => new Map((vehicles.data?.items ?? []).map((v) => [v.id, `${v.fleetNumber} · ${v.registrationNumber}`])), [vehicles.data]);
  const vehicleName = (id: string) => <Link className="text-accent hover:underline" href={`/vehicles/${id}`}>{names.get(id) ?? id.slice(0, 8)}</Link>;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t.m4.maintenance.title} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: "due", label: t.m4.maintenance.due },
        { id: "workOrders", label: t.m4.workOrders.title },
        { id: "defects", label: t.m4.defects.title },
        ...(can("maintenance_template.manage") ? [{ id: "templates" as const, label: t.m4.templates.title }] : []),
      ]} />
      {tab === "due" && <DueList vehicleName={vehicleName} />}
      {tab === "workOrders" && <WorkOrders vehicleName={vehicleName} vehicles={(vehicles.data?.items ?? []).filter((v) => v.status !== "disposed").map((v) => ({ id: v.id, label: names.get(v.id)! }))} />}
      {tab === "defects" && <Defects vehicleName={vehicleName} />}
      {tab === "templates" && <Templates />}
    </div>
  );
}

function DueList({ vehicleName }: { vehicleName: (id: string) => React.ReactNode }) {
  const { api } = useSession();
  const { t, locale } = useI18n();
  const M = t.m4.maintenance;
  const [status, setStatus] = useState<"" | "upcoming" | "due" | "overdue" | "unknown_baseline">("");
  const due = useLoad(() => api.call("maintenanceDue", { query: status ? { status } : {} }), [api, status]);
  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
        <Select aria-label={M.status} className="w-48" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="">{t.m4.defects.all}</option>
          {(["overdue", "due", "upcoming", "unknown_baseline"] as const).map((s) => <option key={s} value={s}>{M.statuses[s]}</option>)}
        </Select>
      </div>
      {!due.data?.items.length ? <p className="p-5 text-muted">{M.empty}</p> : (
        <Table head={[t.m4.readiness.vehicle, M.item, M.status, M.dueAt, M.remaining, M.forecast]}>
          {due.data.items.map((r) => (
            <tr key={`${r.vehicleId}-${r.code}`}>
              <Td>{vehicleName(r.vehicleId)}</Td>
              <Td>{r.name}{r.safety && <> <Badge tone="bad">{M.safety}</Badge></>}</Td>
              <Td><Badge tone={mntTone[r.due.status]}>{M.statuses[r.due.status]}</Badge></Td>
              <Td>{[r.due.dueKm != null && `${r.due.dueKm.toLocaleString(locale)} ${M.km}`, r.due.dueDate && fmtDate(r.due.dueDate, locale)].filter(Boolean).join(" · ") || "—"}</Td>
              <Td>{[r.due.remainingKm != null && `${r.due.remainingKm.toLocaleString(locale)} ${M.km}`, r.due.remainingDays != null && `${r.due.remainingDays} ${M.days}`].filter(Boolean).join(" · ") || "—"}</Td>
              <Td>{r.due.forecastDate ? fmtDate(r.due.forecastDate, locale) : "—"}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function WorkOrders({ vehicleName, vehicles }: { vehicleName: (id: string) => React.ReactNode; vehicles: { id: string; label: string }[] }) {
  const { api, user } = useSession();
  const { t } = useI18n();
  const W = t.m4.workOrders;
  const [filter, setFilter] = useState<"active" | "all">("active");
  const [open, setOpen] = useState(false);
  const list = useLoad(() => api.call("listWorkOrders", { query: filter === "active" ? { status: "active" } : {} }), [api, filter]);
  const canManage = !!user && authorize(user.role, "maintenance.manage").allowed;
  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <Tabs value={filter} onChange={setFilter} tabs={[{ id: "active", label: W.active }, { id: "all", label: W.all }]} />
        {canManage && !open && <Button variant="primary" onClick={() => setOpen(true)}>+ {W.add}</Button>}
      </div>
      {open && <div className="border-b border-line"><WorkOrderForm vehicles={vehicles} onCancel={() => setOpen(false)} onDone={() => { setOpen(false); void list.reload(); }} /></div>}
      {!list.data?.items.length ? <p className="p-5 text-muted">{W.empty}</p> : <WorkOrderTable items={list.data.items} vehicleName={vehicleName} onChange={() => void list.reload()} />}
    </Card>
  );
}

const sevTone = { low: "muted", medium: "info", high: "warn", critical: "bad" } as const;
const defTone = { reported: "warn", triaged: "info", converted: "ok", rejected: "muted", duplicate: "muted" } as const;

/** WO-002 / US-E10-05: review, reject (with reason), mark duplicate, or convert into a work order. */
function Defects({ vehicleName }: { vehicleName: (id: string) => React.ReactNode }) {
  const { api, user } = useSession();
  const { t, locale } = useI18n();
  const D = t.m4.defects;
  const [filter, setFilter] = useState<"open" | "all">("open");
  const list = useLoad(() => api.call("listDefects", { query: filter === "open" ? { status: "open" } : {} }), [api, filter]);
  const canTriage = !!user && authorize(user.role, "defect.triage").allowed;
  const [pending, setPending] = useState<{ id: string; kind: "reject" | "duplicate" | "convert" } | null>(null);
  const [f, setF] = useState({ reason: "", duplicateOf: "", title: "", notDrivable: false });
  const act = useAction();
  const done = async (fn: () => Promise<unknown>) => { if (await act.run(fn)) { setPending(null); await list.reload(); } };
  const others = (d: Defect) => (list.data?.items ?? []).filter((x) => x.vehicleId === d.vehicleId && x.id !== d.id);
  const photo = async (id: string) => saveDownload(await api.download("downloadDefectPhoto", { id }), `defect-${id}`);

  return (
    <Card className="p-0">
      <div className="border-b border-line px-5 py-4"><Tabs value={filter} onChange={setFilter} tabs={[{ id: "open", label: D.open }, { id: "all", label: D.all }]} /></div>
      {act.error && <div className="p-4"><Alert>{act.error}</Alert></div>}
      {!list.data?.items.length ? <p className="p-5 text-muted">{D.empty}</p> : (
        <Table head={[t.m4.readiness.vehicle, D.description, D.severity, t.m4.maintenance.status, ""]}>
          {list.data.items.map((d) => (
            <tr key={d.id} className="align-top">
              <Td>{vehicleName(d.vehicleId)}<div className="text-xs text-muted">{fmtDateTime(d.reportedAt, locale)}</div></Td>
              <Td className="max-w-sm whitespace-normal">
                <div>{d.description}</div>
                {!d.drivable && <Badge tone="bad">{D.notDrivable}</Badge>}
                {d.hasPhoto && <button type="button" className="ms-2 text-xs text-accent hover:underline" onClick={() => void photo(d.id)}>{D.photo}</button>}
                {d.decisionReason && <div className="text-xs text-muted">{D.reason}: {d.decisionReason}</div>}
              </Td>
              <Td><Badge tone={sevTone[d.severity]}>{D.severities[d.severity]}</Badge></Td>
              <Td><Badge tone={defTone[d.status]}>{D.statuses[d.status]}</Badge></Td>
              <Td className="whitespace-normal">
                {canTriage && (d.status === "reported" || d.status === "triaged") && (pending?.id === d.id ? (
                  <form className="flex min-w-[15rem] flex-col gap-2" onSubmit={(e) => {
                    e.preventDefault();
                    if (pending.kind === "reject") void done(() => api.call("rejectDefect", { params: { id: d.id }, body: { reason: f.reason } }));
                    else if (pending.kind === "duplicate") void done(() => api.call("duplicateDefect", { params: { id: d.id }, body: { duplicateOf: f.duplicateOf, reason: f.reason } }));
                    else void done(() => api.call("convertDefect", { params: { id: d.id }, body: { title: f.title, type: "corrective", notDrivable: f.notDrivable } }));
                  }}>
                    {pending.kind === "convert" ? <>
                      <Input aria-label={D.woTitle} placeholder={D.woTitle} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required minLength={3} />
                      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.notDrivable} onChange={(e) => setF({ ...f, notDrivable: e.target.checked })} /> {t.m4.workOrders.notDrivable}</label>
                    </> : <>
                      {pending.kind === "duplicate" && (
                        <Select aria-label={D.duplicateOf} value={f.duplicateOf} onChange={(e) => setF({ ...f, duplicateOf: e.target.value })} required>
                          <option value="">{D.duplicateOf}</option>
                          {others(d).map((x) => <option key={x.id} value={x.id}>{fmtDateTime(x.reportedAt, locale)} · {x.description.slice(0, 40)}</option>)}
                        </Select>
                      )}
                      <Input aria-label={D.reason} placeholder={D.reason} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required minLength={3} />
                    </>}
                    <div className="flex gap-1">
                      <Button type="submit" variant="primary" className="min-h-8 px-3" disabled={act.busy}>{D[pending.kind]}</Button>
                      <Button type="button" variant="ghost" className="min-h-8 px-3" onClick={() => setPending(null)}>{t.common.cancel}</Button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {d.status === "reported" && <Button className="min-h-8 px-3" disabled={act.busy} onClick={() => void done(() => api.call("triageDefect", { params: { id: d.id } }))}>{D.triage}</Button>}
                    <Button className="min-h-8 px-3" onClick={() => { setPending({ id: d.id, kind: "convert" }); setF({ reason: "", duplicateOf: "", title: d.description.slice(0, 80), notDrivable: !d.drivable }); }}>{D.convert}</Button>
                    <Button className="min-h-8 px-3" onClick={() => { setPending({ id: d.id, kind: "reject" }); setF({ ...f, reason: "" }); }}>{D.reject}</Button>
                    {others(d).length > 0 && <Button className="min-h-8 px-3" onClick={() => { setPending({ id: d.id, kind: "duplicate" }); setF({ ...f, reason: "", duplicateOf: "" }); }}>{D.duplicate}</Button>}
                  </div>
                ))}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

/** MNT-001/002: templates per make/model with distance and/or calendar intervals. */
function Templates() {
  const { api } = useSession();
  const { t } = useI18n();
  const T = t.m4.templates;
  const M = t.m4.maintenance;
  const list = useLoad(() => api.call("listTemplates"), [api]);
  const [open, setOpen] = useState(false);
  const blank = { code: "", name: "", km: "", months: "", safety: false };
  const [f, setF] = useState({ name: "", make: "", model: "", item: blank });
  const [addTo, setAddTo] = useState<string | null>(null);
  const [item, setItem] = useState(blank);
  const act = useAction();
  const itemBody = (i: typeof blank) => ({ code: i.code, name: i.name, intervalKm: i.km ? Number(i.km) : null, intervalMonths: i.months ? Number(i.months) : null, safety: i.safety });
  const itemFields = (i: typeof blank, set: (i: typeof blank) => void) => <>
    <Field label={T.code} error={act.fe("code")}><Input dir="ltr" value={i.code} onChange={(e) => set({ ...i, code: e.target.value.toUpperCase() })} required pattern="[A-Za-z0-9_]{2,32}" /></Field>
    <Field label={T.itemName}><Input value={i.name} onChange={(e) => set({ ...i, name: e.target.value })} required minLength={2} /></Field>
    <Field label={M.km} error={act.fe("intervalKm")}><Input inputMode="numeric" value={i.km} onChange={(e) => set({ ...i, km: e.target.value })} /></Field>
    <Field label={M.months}><Input inputMode="numeric" value={i.months} onChange={(e) => set({ ...i, months: e.target.value })} /></Field>
    <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={i.safety} onChange={(e) => set({ ...i, safety: e.target.checked })} /> {M.safety}</label>
  </>;
  const interval = (km: number | null, months: number | null) => [km != null && `${km} ${M.km}`, months != null && `${months} ${M.months}`].filter(Boolean).join(" / ");

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{T.help}</p>
      {act.error && <Alert>{act.error}</Alert>}
      <div>{!open && <Button variant="primary" onClick={() => setOpen(true)}>+ {T.add}</Button>}</div>
      {open && (
        <Card>
          <form className="grid gap-4 sm:grid-cols-3" onSubmit={async (e) => {
            e.preventDefault();
            if (await act.run(() => api.call("createTemplate", { body: { name: f.name, make: f.make || null, model: f.model || null, items: [itemBody(f.item)] } }))) {
              setOpen(false);
              setF({ name: "", make: "", model: "", item: blank });
              await list.reload();
            }
          }}>
            <Field label={T.name}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} /></Field>
            <Field label={`${T.make} (${t.common.optional})`} error={act.fe("make")}><Input value={f.make} onChange={(e) => setF({ ...f, make: e.target.value })} /></Field>
            <Field label={`${T.model} (${t.common.optional})`}><Input value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} /></Field>
            {itemFields(f.item, (i) => setF({ ...f, item: i }))}
            <div className="flex items-end gap-2 sm:col-span-3">
              <Button variant="primary" type="submit" disabled={act.busy}>{t.common.save}</Button>
              <Button type="button" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
            </div>
          </form>
        </Card>
      )}
      {!list.data?.items.length ? <Card><p className="text-muted">{T.empty}</p></Card> : list.data.items.map((tpl: MaintenanceTemplate) => (
        <Card key={tpl.id} className="p-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
            <h3 className="font-bold">{tpl.name}</h3>
            <span className="text-sm text-muted">{tpl.make ?? T.any} · {tpl.model ?? T.any}</span>
            {tpl.status === "inactive" && <Badge tone="muted">{t.branches.inactive}</Badge>}
            <div className="ms-auto flex gap-1">
              <Button className="min-h-8 px-3" onClick={() => { setAddTo(tpl.id); setItem(blank); }}>+ {T.addItem}</Button>
              <Button className="min-h-8 px-3" disabled={act.busy} onClick={async () => { if (await act.run(() => api.call("updateTemplate", { params: { id: tpl.id }, body: { status: tpl.status === "active" ? "inactive" : "active" } }))) await list.reload(); }}>
                {tpl.status === "active" ? T.deactivate : T.activate}
              </Button>
            </div>
          </div>
          {addTo === tpl.id && (
            <form className="grid gap-4 border-b border-line p-5 sm:grid-cols-3" onSubmit={async (e) => {
              e.preventDefault();
              if (await act.run(() => api.call("addTemplateItem", { params: { id: tpl.id }, body: itemBody(item) }))) { setAddTo(null); await list.reload(); }
            }}>
              {itemFields(item, setItem)}
              <div className="flex items-end gap-2">
                <Button variant="primary" type="submit" disabled={act.busy}>{t.common.save}</Button>
                <Button type="button" onClick={() => setAddTo(null)}>{t.common.cancel}</Button>
              </div>
            </form>
          )}
          <Table head={[T.code, T.itemName, M.interval, ""]}>
            {tpl.items.map((i) => (
              <tr key={i.id} className={i.status === "inactive" ? "opacity-60" : ""}>
                <Td className="font-mono">{i.code}</Td>
                <Td>{i.name}{i.safety && <> <Badge tone="bad">{M.safety}</Badge></>}</Td>
                <Td>{interval(i.intervalKm, i.intervalMonths)}</Td>
                <Td>
                  <Button variant="ghost" className="min-h-8 px-3" disabled={act.busy} onClick={async () => { if (await act.run(() => api.call("updateTemplateItem", { params: { id: i.id }, body: { status: i.status === "active" ? "inactive" : "active" } }))) await list.reload(); }}>
                    {i.status === "active" ? T.deactivate : T.activate}
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      ))}
    </div>
  );
}
