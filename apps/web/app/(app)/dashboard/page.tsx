"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { authorize } from "@fleet/domain";
import { Alert, Badge, Card, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { apiErrorMessage } from "@/lib/errors";
import { fmtMoney } from "@/lib/format";

type M = { value: number | null; quality: "reliable" | "estimated" | "partial" | "unavailable" };
const qTone = { reliable: "ok", estimated: "info", partial: "warn", unavailable: "muted" } as const;
const iso = (d: Date) => d.toISOString().slice(0, 10);

function Stat({ label, value, sub, href }: { label: string; value: ReactNode; sub?: ReactNode; href?: string }) {
  const body = (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-xs font-medium text-muted">{label}</span>
      <span className="text-2xl font-bold tabular-nums text-ink">{value}</span>
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </Card>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{body}</Link> : body;
}

/** E18 dashboard (PRD §26.2): executive numbers and fleet-manager follow-up, scoped to the user's branches. */
export default function DashboardPage() {
  const { api, user } = useSession();
  const { t, locale } = useI18n();
  const D = t.m5.dash;
  const now = new Date();
  const [period, setPeriod] = useState({ from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now), branchId: "" });
  const can = (a: Parameters<typeof authorize>[1]) => !!user && authorize(user.role, a).allowed;
  const branches = useLoad(() => (can("branch.read") ? api.call("listBranches") : Promise.resolve({ items: [] })), [api, user]);
  const d = useLoad(() => api.call("dashboard", { query: { from: period.from, to: period.to, ...(period.branchId ? { branchId: period.branchId } : {}) } }), [api, period.from, period.to, period.branchId]);
  // US-E16-03: while a month is recalculated, refresh until the new values are in.
  const recalculating = !!d.data?.recalculating;
  const { reload } = d;
  useEffect(() => {
    if (!recalculating) return;
    const id = setInterval(() => void reload(), 10_000);
    return () => clearInterval(id);
  }, [recalculating, reload]);
  const money = (n: number | null | undefined) => fmtMoney(n ?? 0, d.data?.currency ?? "EGP", locale);
  const kpi = (key: string, m: M, fmt: (v: number) => string = (v) => v.toLocaleString(locale)) => (
    <Card key={key} className="flex flex-col gap-1 p-4">
      <span className="text-xs font-medium text-muted">{D.k[key]}</span>
      <span className="text-xl font-bold tabular-nums">{m.value == null ? "—" : fmt(m.value)}</span>
      <span><Badge tone={qTone[m.quality]}>{t.m5.quality[m.quality]}</Badge></span>
    </Card>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={D.title} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label={D.from}><Input type="date" value={period.from} max={period.to} onChange={(e) => setPeriod({ ...period, from: e.target.value })} /></Field>
        <Field label={D.to}><Input type="date" value={period.to} min={period.from} onChange={(e) => setPeriod({ ...period, to: e.target.value })} /></Field>
        {(branches.data?.items.length ?? 0) > 1 && (
          <Field label={D.branch}>
            <Select value={period.branchId} onChange={(e) => setPeriod({ ...period, branchId: e.target.value })}>
              <option value="">{D.allBranches}</option>
              {branches.data!.items.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
        )}
      </div>
      {d.error ? <Alert>{apiErrorMessage(t, d.error)}</Alert> : null}
      {!d.data ? <p className="text-muted">{t.common.loading}</p> : <>
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label={D.vehicles}>
          <Stat label={`${D.vehicles} · ${D.total}`} value={d.data.vehicles.total} href="/vehicles" />
          <Stat label={D.available} value={d.data.vehicles.available} sub={`${D.active}: ${d.data.vehicles.active}`} />
          <Stat label={D.restricted} value={<span className={d.data.vehicles.restricted ? "text-bad" : ""}>{d.data.vehicles.restricted}</span>} href="/readiness" />
          <Stat label={D.openAlerts} value={d.data.openAlerts} sub={`${D.overdue}: ${d.data.overdueMaintenance}`} href="/alerts" />
        </section>
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label={D.costs}>
          <Stat label={`${D.costs} · ${D.operating}`} value={money(d.data.costs.operatingMinor)} href="/reports?r=costs" />
          <Stat label={D.fuel} value={money(d.data.costs.fuelMinor)} href="/reports?r=fuel" />
          <Stat label={D.maintenance} value={money(d.data.costs.maintenanceMinor)} href="/reports?r=maintenance" />
          <Stat label={D.fines} value={money(d.data.costs.finesMinor)} href="/fines" />
        </section>
        <h2 className="flex items-center gap-2 text-lg font-bold">{D.kpis}{d.data.recalculating && <Badge tone="info">{D.recalculating}</Badge>}</h2>
        {d.data.recalculating && <Alert tone="info">{D.recalcNote}</Alert>}
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          {kpi("fuelConsumption", d.data.kpis.fuelConsumption)}
          {kpi("costPerKm", d.data.kpis.costPerKm, (v) => money(v))}
          {kpi("fuelCostPerKm", d.data.kpis.fuelCostPerKm, (v) => money(v))}
          {kpi("availability", d.data.kpis.availability, (v) => `${v}%`)}
          {kpi("maintenanceCompliance", d.data.kpis.maintenanceCompliance, (v) => `${v}%`)}
          {kpi("documentCompliance", d.data.kpis.documentCompliance, (v) => `${v}%`)}
          {kpi("dataCoverage", d.data.kpis.dataCoverage, (v) => `${v}%`)}
          {kpi("syncSuccess", d.data.kpis.syncSuccess, (v) => `${v}%`)}
          {kpi("fuelBudgetVariance", d.data.kpis.fuelBudgetVariance, (v) => `${v > 0 ? "+" : ""}${v}%`)}
          <Card className="flex flex-col gap-1 p-4">
            <span className="text-xs font-medium text-muted">{D.distance}</span>
            <span className="text-xl font-bold tabular-nums">{d.data.distance.value == null ? "—" : `${d.data.distance.value.toLocaleString(locale)} km`}</span>
            <span><Badge tone={qTone[d.data.distance.quality]}>{t.m5.quality[d.data.distance.quality]}</Badge></span>
          </Card>
        </section>
        {d.data.recalculations.length > 0 && (
          <Card>
            <h3 className="mb-2 font-bold">{D.recalcLog}</h3>
            <Table head={[D.recalcMonth, D.recalcReason, D.recalcStatus, `${D.k.costPerKm} · ${D.recalcBefore}`, `${D.k.costPerKm} · ${D.recalcAfter}`, `${D.operating} · ${D.recalcBefore}`, `${D.operating} · ${D.recalcAfter}`]}>
              {d.data.recalculations.map((r) => (
                <tr key={r.id}>
                  <Td>{r.month.slice(0, 7)}</Td>
                  <Td><Link className="text-primary underline" href="/corrections">{r.reason}</Link></Td>
                  <Td><Badge tone={r.status === "pending" ? "info" : "ok"}>{r.status === "pending" ? D.recalcPending : D.recalcDone}</Badge></Td>
                  <Td>{r.before?.costPerKm == null ? "—" : money(r.before.costPerKm)}</Td>
                  <Td>{r.after?.costPerKm == null ? "—" : money(r.after.costPerKm)}</Td>
                  <Td>{r.before?.operatingMinor == null ? "—" : money(r.before.operatingMinor)}</Td>
                  <Td>{r.after?.operatingMinor == null ? "—" : money(r.after.operatingMinor)}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        )}
        <h2 className="text-lg font-bold">{D.fleet}</h2>
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={D.assignments} value={d.data.fleet.activeAssignments} />
          <Stat label={D.docsExpiring} value={d.data.fleet.documentsExpiring} href="/reports?r=documents" />
          <Stat label={D.pendingVerifications} value={d.data.fleet.pendingVerifications} href="/documents" />
          <Stat label={D.maintenanceDue} value={d.data.fleet.maintenanceDue} href="/maintenance" />
          <Stat label={D.openWorkOrders} value={d.data.fleet.openWorkOrders} href="/maintenance" />
          <Stat label={D.fuelVsBudget} value={money(d.data.fleet.fuelSpendMinor)} sub={d.data.fleet.fuelBudgetMinor != null ? `/ ${money(d.data.fleet.fuelBudgetMinor)}` : D.noBudget} href="/budgets" />
          <Stat label={D.syncConflicts} value={d.data.fleet.syncConflicts} href="/sync-conflicts" />
        </section>
        {d.data.fleet.byBranch.length > 1 && (
          <Card>
            <h3 className="mb-2 font-bold">{D.byBranch}</h3>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {d.data.fleet.byBranch.map((b) => (
                <li key={b.branchId} className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
                  <span className="font-medium">{b.name}</span>
                  <span className="text-sm text-muted">{b.vehicles} {D.vehicles}{b.restricted ? <> · <span className="text-bad">{b.restricted} {D.restricted}</span></> : null}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </>}
    </div>
  );
}
