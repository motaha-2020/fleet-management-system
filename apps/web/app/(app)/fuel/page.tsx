"use client";
import { useMemo, useState } from "react";
import { Card, PageHeader, Select } from "@/components/ui";
import { FuelTable } from "@/components/fuel-table";
import { FuelMap, type MapPoint } from "@/components/fuel-map";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { fmtDateTime } from "@/lib/format";
import { fromMinor } from "@/components/m2-common";

const DAY = 86_400_000;

/** Review queue: entries with findings wait here; nothing is silently rejected (GEN-012). Below: where fuel was bought. */
export default function FuelReviewPage() {
  const { api } = useSession();
  const { t, locale } = useI18n();
  const F = t.m2.fuel;
  const [days, setDays] = useState(30);
  const queue = useLoad(() => api.call("listFuelEntries", { query: { status: "under_review" } }), [api]);
  const recent = useLoad(() => api.call("listFuelEntries", { query: { from: new Date(Date.now() - days * DAY).toISOString() } }), [api, days]);
  const vehicles = useLoad(() => api.call("listVehicles"), [api]);
  const drivers = useLoad(() => api.call("listDrivers").catch(() => ({ items: [] })), [api]);
  const vName = useMemo(() => new Map((vehicles.data?.items ?? []).map((v) => [v.id, v.fleetNumber])), [vehicles.data]);
  const dName = useMemo(() => new Map((drivers.data?.items ?? []).map((d) => [d.id, d.fullName])), [drivers.data]);

  const entries = useMemo(() => recent.data?.items.filter((e) => e.status !== "voided") ?? [], [recent.data]);
  const points: MapPoint[] = useMemo(() => entries.filter((e) => e.location).map((e) => ({
    id: e.id, lat: e.location!.lat, lng: e.location!.lng, accuracyM: e.location!.accuracyM, flagged: e.flags.length > 0,
    title: `${vName.get(e.vehicleId) ?? "—"} · ${fmtDateTime(e.eventAt, locale)}`,
    lines: [
      `${F.driver}: ${e.driverId ? dName.get(e.driverId) ?? "—" : "—"}`,
      `${e.quantity} ${e.unit === "m3" ? "m³" : "L"} · ${fromMinor(e.grossMinor)} ${e.currency}`,
      `${F.odometer}: ${e.odometer.toLocaleString("en")}`,
    ],
  })), [entries, vName, dName, locale, F]);
  const noLocation = entries.length - points.length;

  return (
    <>
      <PageHeader title={t.m2.fuel.queue} />
      <Card className="p-0">
        {!queue.data ? <p className="p-6 text-muted">{t.common.loading}</p> : !queue.data.items.length ? <p className="p-6 text-muted">{t.m2.fuel.empty}</p> : (
          <FuelTable items={queue.data.items} showVehicle onChange={() => { void queue.reload(); void recent.reload(); }} vehicleName={(id) => vName.get(id) ?? "—"} driverName={(id) => (id ? dName.get(id) ?? "—" : "—")} />
        )}
      </Card>
      <div className="mb-3 mt-8 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">{F.mapTitle}</h2>
        <label className="ms-auto flex items-center gap-2 text-sm">
          {F.mapPeriod}
          <Select className="min-h-9 w-auto py-1" value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 30, 90].map((d) => <option key={d} value={d}>{F.lastDays.replace("{n}", String(d))}</option>)}
          </Select>
        </label>
      </div>
      <Card>
        {!recent.data ? <p className="text-muted">{t.common.loading}</p> : (
          <>
            <FuelMap points={points} />
            <p className="mt-3 text-sm text-muted">
              {F.mapSummary.replace("{n}", String(points.length))}
              {noLocation > 0 && ` · ${F.mapNoLocation.replace("{n}", String(noLocation))}`}
            </p>
          </>
        )}
      </Card>
    </>
  );
}
