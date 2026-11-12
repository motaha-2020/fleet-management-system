"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { authorize } from "@fleet/domain";
import { Button, Card, Field, Input, PageHeader, Table, Td } from "@/components/ui";
import { CostForm } from "@/components/cost-form";
import { CostTable } from "@/components/cost-table";
import { MeasuredValue, fromMinor } from "@/components/m2-common";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";

const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)).toISOString().slice(0, 10); };

/** Recorded costs (Expense Date view) and cost/km over valid distance (US-E15-03, E3). */
export default function CostsPage() {
  const { api, user } = useSession();
  const { t } = useI18n();
  const C = t.m2.costs;
  const [range, setRange] = useState({ from: monthStart(), to: new Date().toISOString().slice(0, 10) });
  const summary = useLoad(() => api.call("costSummary", { query: range }), [api, range.from, range.to]);
  const costs = useLoad(() => api.call("listCosts", { query: range }), [api, range.from, range.to]);
  const vehicles = useLoad(() => api.call("listVehicles"), [api]);
  const branches = useLoad(() => api.call("listBranches"), [api]);
  const vName = useMemo(() => new Map((vehicles.data?.items ?? []).map((v) => [v.id, v.fleetNumber])), [vehicles.data]);
  const [open, setOpen] = useState(false);
  const canWrite = !!user && authorize(user.role, "cost.write").allowed;
  const reload = () => Promise.all([summary.reload(), costs.reload()]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={C.title} action={
        <div className="flex flex-wrap items-end gap-3">
          <Field label={C.from}><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
          <Field label={C.to}><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
        </div>
      } />
      <Card className="p-0">
        <h2 className="border-b border-line px-5 py-4 text-lg font-bold">{C.summary}</h2>
        {!summary.data ? <p className="p-5 text-muted">{t.common.loading}</p> : (
          <Table head={[C.vehicle, C.total, C.fuelCost, C.distance, C.perKm, C.fuelPerKm]}>
            {summary.data.vehicles.map((v) => (
              <tr key={v.vehicleId}>
                <Td className="font-semibold"><Link className="text-accent hover:underline" href={`/vehicles/${v.vehicleId}`}>{v.fleetNumber}</Link></Td>
                <Td>{fromMinor(v.costMinor)}</Td>
                <Td>{fromMinor(v.fuelCostMinor)}</Td>
                <Td><MeasuredValue m={v.distance} format={(x) => `${x.toLocaleString("en")} km`} /></Td>
                <Td><MeasuredValue m={v.costPerKm} format={(x) => `${fromMinor(x)} ${summary.data!.currency}`} /></Td>
                <Td><MeasuredValue m={v.fuelCostPerKm} format={(x) => `${fromMinor(x)} ${summary.data!.currency}`} /></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div><h2 className="text-lg font-bold">{C.title}</h2><p className="text-xs text-muted">{C.taxNote}</p></div>
          {canWrite && !open && <Button variant="primary" onClick={() => setOpen(true)}>+ {C.add}</Button>}
        </div>
        {open && <div className="border-b border-line"><CostForm vehicles={vehicles.data?.items} branches={branches.data?.items} onCancel={() => setOpen(false)} onDone={() => { setOpen(false); void reload(); }} /></div>}
        {!costs.data?.items.length ? <p className="p-5 text-muted">{C.empty}</p> : <CostTable items={costs.data.items} vehicleName={(id) => (id ? vName.get(id) ?? "—" : "—")} onChange={() => void reload()} />}
      </Card>
    </div>
  );
}
