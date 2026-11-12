"use client";
import { useState } from "react";
import { authorize } from "@fleet/domain";
import type { Vehicle } from "@fleet/contracts";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { Button, Card } from "./ui";
import { CostForm } from "./cost-form";
import { CostTable } from "./cost-table";

export function VehicleCosts({ vehicle }: { vehicle: Vehicle }) {
  const { api, user } = useSession();
  const { t } = useI18n();
  const C = t.m2.costs;
  const costs = useLoad(() => api.call("listCosts", { query: { vehicleId: vehicle.id } }), [api, vehicle.id]);
  const [open, setOpen] = useState(false);
  const canWrite = !!user && authorize(user.role, "cost.write").allowed;
  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div>
          <h2 className="text-lg font-bold">{C.title}</h2>
          <p className="text-xs text-muted">{C.taxNote}</p>
        </div>
        {canWrite && !open && <Button variant="primary" onClick={() => setOpen(true)}>+ {C.add}</Button>}
      </div>
      {open && <div className="border-b border-line"><CostForm vehicleId={vehicle.id} onCancel={() => setOpen(false)} onDone={() => { setOpen(false); void costs.reload(); }} /></div>}
      {!costs.data?.items.length ? <p className="p-5 text-muted">{C.empty}</p> : <CostTable items={costs.data.items} onChange={() => void costs.reload()} />}
    </Card>
  );
}
