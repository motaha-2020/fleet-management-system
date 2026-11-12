"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import { authorize } from "@fleet/domain";
import { ApiRequestError, type Readiness, type WorkOrder } from "@fleet/contracts";
import { fieldError } from "@fleet/i18n";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { apiErrorMessage } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Alert, Badge, Button, Card, Field, Input, Select, Table, Td } from "./ui";

export const outcomeTone = { allowed: "ok", warning: "warn", restricted: "bad" } as const;
export const mntTone = { ok: "ok", upcoming: "info", due: "warn", overdue: "bad", unknown_baseline: "muted" } as const;
export const woTone = { open: "info", scheduled: "info", in_progress: "warn", completed: "ok", closed: "muted", cancelled: "muted" } as const;

/** Busy / error state for one action at a time. */
export function useAction() {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await fn();
      return true;
    } catch (e) {
      if (e instanceof ApiRequestError) setFields(e.fields);
      setError(apiErrorMessage(t, e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const fe = (k: string) => fieldError(t, fields[k]);
  return { busy, error, run, fe, setError };
}

export const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/**
 * E12 readiness of a vehicle (or driver): outcome, reasons with risk, and — for R2/R3 — a time-limited
 * override with a reason (US-E12-04). R4 reasons show that they cannot be overridden.
 */
export function ReadinessCard({ vehicleId, driverId, title }: { vehicleId?: string; driverId?: string; title?: string }) {
  const { api, user } = useSession();
  const { t, locale } = useI18n();
  const R = t.m4.readiness;
  const r = useLoad(() => api.call("readiness", { query: { vehicleId, driverId } }), [api, vehicleId, driverId]);
  const canOverride = !!user && authorize(user.role, "readiness.override").allowed;
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState({ reason: "", expiresOn: inDays(7) });
  const act = useAction();
  const key = (x: Readiness["reasons"][number]) => `${x.code}|${x.entityId}|${x.subject ?? ""}`;

  const submit = async (x: Readiness["reasons"][number]) => {
    const ok = await act.run(() => api.call("createOverride", {
      body: { ruleCode: x.code, entityType: x.entityType, entityId: x.entityId, subject: x.subject, reason: form.reason, expiresAt: new Date(`${form.expiresOn}T23:59:00`).toISOString() },
    }));
    if (ok) { setOpen(null); await r.reload(); }
  };
  const revoke = async (id: string) => { if (await act.run(() => api.call("revokeOverride", { params: { id } }))) await r.reload(); };
  const subject = (s: string | null) => (s && !/^[0-9a-f-]{36}$/.test(s) ? s : null);

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">{title ?? R.title}</h2>
        {r.data && <Badge tone={outcomeTone[r.data.outcome]}>{t.m4.outcome[r.data.outcome]}</Badge>}
      </div>
      {act.error && <div className="mb-3"><Alert>{act.error}</Alert></div>}
      {!r.data ? <p className="text-muted">{t.common.loading}</p> : !r.data.reasons.length ? <p className="text-sm text-ok">{R.none}</p> : (
        <ul className="flex flex-col divide-y divide-line">
          {r.data.reasons.map((x) => (
            <li key={key(x)} className="flex flex-col gap-2 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={outcomeTone[x.outcome]}>{t.m4.risk[x.risk]}</Badge>
                <span className="font-medium">{t.m4.rules[x.code] ?? x.code}</span>
                {subject(x.subject) && <span className="font-mono text-xs text-muted">{x.subject}</span>}
                {x.overrideId && (
                  <span className="text-xs text-muted">
                    {R.overridden} {fmtDateTime(x.overrideExpiresAt!, locale)}
                    {canOverride && <button type="button" className="ms-2 text-accent hover:underline" onClick={() => void revoke(x.overrideId!)}>{R.revoke}</button>}
                  </span>
                )}
                {canOverride && !x.overrideId && (x.risk === "R3" || x.risk === "R2") && x.outcome !== "allowed" && open !== key(x) && (
                  <Button variant="ghost" className="ms-auto min-h-8 px-3" onClick={() => { setOpen(key(x)); setForm({ reason: "", expiresOn: inDays(7) }); }}>{R.override}</Button>
                )}
                {x.risk === "R4" && <span className="ms-auto text-xs text-muted">{R.noOverride}</span>}
              </div>
              {open === key(x) && (
                <form className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1fr_12rem_auto]" onSubmit={(e: FormEvent) => { e.preventDefault(); void submit(x); }}>
                  <Field label={R.overrideReason} error={act.fe("reason")}><Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required minLength={3} /></Field>
                  <Field label={R.expiresAt} error={act.fe("expiresAt")}><Input type="date" value={form.expiresOn} min={inDays(0)} max={inDays(30)} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} required /></Field>
                  <div className="flex items-end gap-2">
                    <Button variant="primary" type="submit" disabled={act.busy || form.reason.trim().length < 3}>{R.create}</Button>
                    <Button type="button" onClick={() => setOpen(null)}>{t.common.cancel}</Button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** WO-003 lifecycle actions available from a status. */
const NEXT: Record<WorkOrder["status"], ("scheduled" | "in_progress" | "completed" | "closed" | "cancelled")[]> = {
  open: ["scheduled", "in_progress", "completed", "cancelled"], scheduled: ["in_progress", "completed", "cancelled"], in_progress: ["completed", "cancelled"],
  completed: ["closed"], closed: [], cancelled: [],
};

export function WorkOrderTable({ items, vehicleName, onChange }: { items: WorkOrder[]; vehicleName?: (id: string) => ReactNode; onChange: () => void }) {
  const { api, user } = useSession();
  const { t, locale } = useI18n();
  const W = t.m4.workOrders;
  const canManage = !!user && authorize(user.role, "maintenance.manage").allowed;
  const [pending, setPending] = useState<{ id: string; status: "closed" | "cancelled" | "scheduled" } | null>(null);
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(inDays(1));
  const act = useAction();
  const go = async (id: string, status: (typeof NEXT)["open"][number], extra: { reason?: string; scheduledFor?: string } = {}) => {
    if (await act.run(() => api.call("workOrderStatus", { params: { id }, body: { status, ...extra } }))) { setPending(null); onChange(); }
  };
  return (
    <div>
      {act.error && <div className="p-4"><Alert>{act.error}</Alert></div>}
      <Table head={[W.woTitle, ...(vehicleName ? [t.m4.readiness.vehicle] : []), W.type, t.m4.maintenance.status, W.downtime, ""]}>
        {items.map((w) => (
          <tr key={w.id} className="align-top">
            <Td className="whitespace-normal">
              <div className="font-medium">{w.title}</div>
              {w.notDrivable && <Badge tone="bad">{W.notDrivable}</Badge>}
              {w.scheduledFor && <div className="text-xs text-muted">{W.scheduledFor}: {fmtDate(w.scheduledFor, locale)}</div>}
              {w.closeReason && <div className="text-xs text-muted">{W.closeReason}: {w.closeReason}</div>}
            </Td>
            {vehicleName && <Td>{vehicleName(w.vehicleId)}</Td>}
            <Td>{W.types[w.type]}</Td>
            <Td>
              <Badge tone={woTone[w.status]}>{W.statuses[w.status]}</Badge>
              {w.hasCompletedVisit && <div className="mt-1 text-xs text-muted">{W.hasVisit}</div>}
            </Td>
            <Td>{w.downtimeHours != null ? `${w.downtimeHours.toLocaleString(locale)} ${W.hours}` : "—"}</Td>
            <Td className="whitespace-normal">
              {canManage && (pending?.id === w.id ? (
                <form className="flex min-w-[14rem] flex-col gap-2" onSubmit={(e) => {
                  e.preventDefault();
                  void go(w.id, pending.status, pending.status === "scheduled" ? { scheduledFor: date } : reason ? { reason } : {});
                }}>
                  {pending.status === "scheduled"
                    ? <Input type="date" aria-label={W.scheduledFor} value={date} onChange={(e) => setDate(e.target.value)} />
                    : <Input aria-label={W.closeReason} placeholder={W.closeReason} value={reason} onChange={(e) => setReason(e.target.value)} />}
                  <div className="flex gap-1">
                    <Button type="submit" variant="primary" className="min-h-8 px-3" disabled={act.busy}>{W.actions[pending.status]}</Button>
                    <Button type="button" variant="ghost" className="min-h-8 px-3" onClick={() => setPending(null)}>{t.common.cancel}</Button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {NEXT[w.status].map((s) => (
                    <Button key={s} className="min-h-8 px-3" disabled={act.busy} onClick={() => {
                      if (s === "cancelled" || s === "scheduled" || (s === "closed" && !w.hasCompletedVisit)) { setPending({ id: w.id, status: s }); setReason(""); }
                      else void go(w.id, s);
                    }}>{W.actions[s]}</Button>
                  ))}
                </div>
              ))}
            </Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

export function WorkOrderForm({ vehicleId, vehicles, onDone, onCancel }: { vehicleId?: string; vehicles?: { id: string; label: string }[]; onDone: () => void; onCancel: () => void }) {
  const { api } = useSession();
  const { t } = useI18n();
  const W = t.m4.workOrders;
  const [f, setF] = useState({ vehicleId: vehicleId ?? "", title: "", type: "corrective" as WorkOrder["type"], notDrivable: false, scheduledFor: "" });
  const act = useAction();
  return (
    <form className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3" onSubmit={async (e) => {
      e.preventDefault();
      if (await act.run(() => api.call("createWorkOrder", { body: { vehicleId: f.vehicleId, title: f.title, type: f.type, notDrivable: f.notDrivable, scheduledFor: f.scheduledFor || null } }))) onDone();
    }}>
      {act.error && <div className="sm:col-span-2 lg:col-span-3"><Alert>{act.error}</Alert></div>}
      {!vehicleId && (
        <Field label={t.m4.readiness.vehicle} error={act.fe("vehicleId")}>
          <Select value={f.vehicleId} onChange={(e) => setF({ ...f, vehicleId: e.target.value })} required>
            <option value="">—</option>
            {vehicles?.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </Select>
        </Field>
      )}
      <Field label={W.woTitle} error={act.fe("title")}><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required minLength={3} /></Field>
      <Field label={W.type}>
        <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as WorkOrder["type"] })}>
          {(["preventive", "corrective", "accident"] as const).map((x) => <option key={x} value={x}>{W.types[x]}</option>)}
        </Select>
      </Field>
      <Field label={`${W.scheduledFor} (${t.common.optional})`}><Input type="date" value={f.scheduledFor} onChange={(e) => setF({ ...f, scheduledFor: e.target.value })} /></Field>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={f.notDrivable} onChange={(e) => setF({ ...f, notDrivable: e.target.checked })} /> {W.notDrivable}
      </label>
      <div className="flex items-end gap-2">
        <Button variant="primary" type="submit" disabled={act.busy}>{t.common.save}</Button>
        <Button type="button" onClick={onCancel}>{t.common.cancel}</Button>
      </div>
    </form>
  );
}
