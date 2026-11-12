"use client";
import { useMemo } from "react";
import { Card, PageHeader } from "@/components/ui";
import { FuelTable } from "@/components/fuel-table";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";

/** Review queue: entries with findings wait here; nothing is silently rejected (GEN-012). */
export default function FuelReviewPage() {
  const { api } = useSession();
  const { t } = useI18n();
  const queue = useLoad(() => api.call("listFuelEntries", { query: { status: "under_review" } }), [api]);
  const vehicles = useLoad(() => api.call("listVehicles"), [api]);
  const drivers = useLoad(() => api.call("listDrivers").catch(() => ({ items: [] })), [api]);
  const vName = useMemo(() => new Map((vehicles.data?.items ?? []).map((v) => [v.id, v.fleetNumber])), [vehicles.data]);
  const dName = useMemo(() => new Map((drivers.data?.items ?? []).map((d) => [d.id, d.fullName])), [drivers.data]);
  return (
    <>
      <PageHeader title={t.m2.fuel.queue} />
      <Card className="p-0">
        {!queue.data ? <p className="p-6 text-muted">{t.common.loading}</p> : !queue.data.items.length ? <p className="p-6 text-muted">{t.m2.fuel.empty}</p> : (
          <FuelTable items={queue.data.items} showVehicle onChange={() => void queue.reload()} vehicleName={(id) => vName.get(id) ?? "—"} driverName={(id) => (id ? dName.get(id) ?? "—" : "—")} />
        )}
      </Card>
    </>
  );
}
