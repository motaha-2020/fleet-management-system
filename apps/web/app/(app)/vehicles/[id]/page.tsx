"use client";
import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { COUNTRY_TEMPLATES, EGYPT } from "@fleet/config";
import { authorize, DISPOSAL_REASONS } from "@fleet/domain";
import { ApiRequestError } from "@fleet/contracts";
import { fieldError } from "@fleet/i18n";
import { Alert, Badge, Button, Card, Field, Input, Select, Table, Td } from "@/components/ui";
import { DetailGrid } from "@/components/detail";
import { DocumentsPanel } from "@/components/documents-panel";
import { VehicleForm } from "@/components/vehicle-form";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { apiErrorMessage } from "@/lib/errors";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { Tabs } from "@/components/m2-common";
import { VehicleCustody } from "@/components/vehicle-custody";
import { VehicleOdometer } from "@/components/vehicle-odometer";
import { VehicleFuel } from "@/components/vehicle-fuel";
import { VehicleCosts } from "@/components/vehicle-costs";

type Panel = null | "edit" | "transfer" | "dispose";

export default function VehiclePage() {
  const { id } = useParams<{ id: string }>();
  const { api, user } = useSession();
  const { t, locale } = useI18n();
  const V = t.vehicle;
  const L = t.vehicles;
  const country = COUNTRY_TEMPLATES[user?.tenant?.countryCode ?? ""] ?? EGYPT;
  const can = (a: Parameters<typeof authorize>[1]) => !!user && authorize(user.role, a).allowed;
  const vehicle = useLoad(() => api.call("getVehicle", { params: { id } }), [api, id]);
  const branches = useLoad(() => (can("branch.read") ? api.call("listBranches") : Promise.resolve({ items: [] })), [api, user]);
  const history = useLoad(() => (user?.role !== "driver" ? api.call("vehicleBranchHistory", { params: { id } }) : Promise.resolve({ items: [] })), [api, id, user]);
  const branchName = useMemo(() => new Map(branches.data?.items.map((b) => [b.id, b.name]) ?? []), [branches.data]);
  const fuel = (c: string | null) => country.fuelTypes.find((f) => f.code === c)?.name[locale] ?? c ?? "—";
  const lic = (c: string) => country.licenseCategories.find((l) => l.code === c)?.name[locale] ?? c;

  const [panel, setPanel] = useState<Panel>(null);
  type Tab = "overview" | "custody" | "odometer" | "fuel" | "costs";
  const [tab, setTab] = useState<Tab>("overview");
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [transfer, setTransfer] = useState({ toBranchId: "", reason: "" });
  const [dispose, setDispose] = useState({ date: "", reason: "sold", finalOdometer: "", saleValue: "" });

  const reloadAll = async () => { await Promise.all([vehicle.reload(), history.reload()]); };
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setMessage(null);
    setErrors({});
    try {
      await fn();
      setPanel(null);
      await reloadAll();
    } catch (err) {
      if (err instanceof ApiRequestError) setErrors(err.fields);
      setMessage(apiErrorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  if (vehicle.error) return <Alert>{apiErrorMessage(t, vehicle.error)}</Alert>;
  const v = vehicle.data;
  if (!v) return <p className="text-muted">{t.common.loading}</p>;
  const editable = v.status !== "disposed";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/vehicles" className="text-sm text-accent hover:underline">← {V.back}</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{v.fleetNumber}</h1>
          <span className="rounded-md bg-accent-soft px-2.5 py-1 text-sm font-bold text-accent-ink">{v.registrationNumber}</span>
          <Badge tone={v.status === "active" ? "ok" : v.status === "inactive" ? "warn" : "muted"}>{L.statuses[v.status]}</Badge>
        </div>
      </div>

      {message && <Alert>{message}</Alert>}

      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: "overview", label: t.m2.tabs.overview },
        ...(can("assignment.read") ? [{ id: "custody" as const, label: t.m2.tabs.custody }] : []),
        ...(can("odometer.read") ? [{ id: "odometer" as const, label: t.m2.tabs.odometer }] : []),
        ...(can("fuel.read") && user?.role !== "driver" ? [{ id: "fuel" as const, label: t.m2.tabs.fuel }] : []),
        ...(can("cost.read") ? [{ id: "costs" as const, label: t.m2.tabs.costs }] : []),
      ]} />
      {tab === "custody" && <VehicleCustody vehicle={v} />}
      {tab === "odometer" && <VehicleOdometer vehicle={v} />}
      {tab === "fuel" && <VehicleFuel vehicle={v} />}
      {tab === "costs" && <VehicleCosts vehicle={v} />}

      {tab === "overview" && <>
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">{V.details}</h2>
          {editable && (
            <div className="flex flex-wrap gap-2">
              {can("vehicle.write") && <Button onClick={() => setPanel(panel === "edit" ? null : "edit")}>{V.edit}</Button>}
              {can("vehicle.write") && (v.status === "active"
                ? <Button onClick={() => run(() => api.call("changeVehicleStatus", { params: { id }, body: { status: "inactive" } }))}>{V.deactivate}</Button>
                : <Button onClick={() => run(() => api.call("changeVehicleStatus", { params: { id }, body: { status: "active" } }))}>{V.activate}</Button>)}
              {can("vehicle.transfer") && <Button onClick={() => setPanel(panel === "transfer" ? null : "transfer")}>{V.transfer}</Button>}
              {can("vehicle.dispose") && v.status !== "draft" && <Button onClick={() => setPanel(panel === "dispose" ? null : "dispose")} className="text-bad">{V.dispose}</Button>}
            </div>
          )}
        </div>
        {panel === "edit" ? (
          <VehicleForm country={country} initial={v} title={V.edit} onCancel={() => setPanel(null)}
            onSubmit={async (fields) => { await api.call("updateVehicle", { params: { id }, body: fields }); setPanel(null); await reloadAll(); }} />
        ) : (
          <DetailGrid items={[
            [L.make, `${v.make} ${v.model}`], [L.year, v.year], [L.vin, v.vin ?? "—"],
            [L.primaryFuelType, `${fuel(v.primaryFuelType)} · ${v.primaryTankCapacity}`],
            [L.secondaryFuelType, v.secondaryFuelType ? `${fuel(v.secondaryFuelType)} · ${v.secondaryTankCapacity}` : "—"],
            [L.requiredLicenseCategory, lic(v.requiredLicenseCategory)], [L.meterType, L.meterTypes[v.meterType]],
            [L.ownershipType, L.ownershipTypes[v.ownershipType]], [L.branch, branchName.get(v.branchId) ?? "—"],
            ...(v.disposal ? [
              [V.disposedOn, fmtDate(v.disposal.date, locale)], [V.disposalReason, V.disposalReasons[v.disposal.reason]],
              [V.finalOdometer, v.disposal.finalOdometer ?? "—"], [V.saleValue, fmtMoney(v.disposal.saleValueMinor, "EGP", locale)],
            ] as [string, string | number][] : []),
          ]} />
        )}

        {panel === "transfer" && (
          <form className="mt-5 grid gap-4 rounded-lg border border-line p-4 sm:grid-cols-3" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => api.call("transferVehicle", { params: { id }, body: { toBranchId: transfer.toBranchId, reason: transfer.reason || undefined } })); }}>
            <Field label={V.toBranch} error={fieldError(t, errors.toBranchId)}>
              <Select value={transfer.toBranchId} onChange={(e) => setTransfer({ ...transfer, toBranchId: e.target.value })} required>
                <option value="">—</option>
                {branches.data?.items.filter((b) => b.id !== v.branchId && b.status === "active").map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
            <Field label={`${V.reason} (${t.common.optional})`}><Input value={transfer.reason} onChange={(e) => setTransfer({ ...transfer, reason: e.target.value })} /></Field>
            <div className="flex items-end gap-2">
              <Button variant="primary" type="submit" disabled={busy || !transfer.toBranchId}>{V.transfer}</Button>
              <Button type="button" onClick={() => setPanel(null)}>{t.common.cancel}</Button>
            </div>
          </form>
        )}

        {panel === "dispose" && (
          <form className="mt-5 grid gap-4 rounded-lg border border-bad/30 bg-bad-bg/40 p-4 sm:grid-cols-2 lg:grid-cols-4"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (!window.confirm(V.confirmDispose)) return;
              void run(() => api.call("disposeVehicle", { params: { id }, body: {
                date: dispose.date, reason: dispose.reason as (typeof DISPOSAL_REASONS)[number],
                finalOdometer: dispose.finalOdometer ? Number(dispose.finalOdometer) : null,
                saleValueMinor: dispose.reason === "sold" && dispose.saleValue ? Math.round(Number(dispose.saleValue) * 100) : null,
              } }));
            }}>
            <Field label={V.disposalDate} error={fieldError(t, errors.date)}><Input type="date" required value={dispose.date} onChange={(e) => setDispose({ ...dispose, date: e.target.value })} /></Field>
            <Field label={V.disposalReason}>
              <Select value={dispose.reason} onChange={(e) => setDispose({ ...dispose, reason: e.target.value })}>
                {DISPOSAL_REASONS.map((r) => <option key={r} value={r}>{V.disposalReasons[r]}</option>)}
              </Select>
            </Field>
            <Field label={V.finalOdometer} error={fieldError(t, errors.finalOdometer)}><Input type="number" min="0" value={dispose.finalOdometer} onChange={(e) => setDispose({ ...dispose, finalOdometer: e.target.value })} /></Field>
            {dispose.reason === "sold" && (
              <Field label={`${V.saleValue} (EGP)`} error={fieldError(t, errors.saleValueMinor)}><Input type="number" min="0" step="0.01" value={dispose.saleValue} onChange={(e) => setDispose({ ...dispose, saleValue: e.target.value })} /></Field>
            )}
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
              <Button variant="primary" type="submit" disabled={busy || !dispose.date} className="bg-bad hover:bg-bad">{V.dispose}</Button>
              <Button type="button" onClick={() => setPanel(null)}>{t.common.cancel}</Button>
            </div>
          </form>
        )}
      </Card>

      {can("document.read") && <DocumentsPanel entityType="vehicle" entityId={id} readOnly={!editable} />}

      {user?.role !== "driver" && (
        <Card className="p-0">
          <h2 className="border-b border-line px-5 py-4 text-lg font-bold">{V.history}</h2>
          {!history.data?.items.length ? (
            <p className="p-5 text-muted">{V.noHistory}</p>
          ) : (
            <Table head={[V.effectiveAt, t.vehicles.branch, V.toBranch, V.reason]}>
              {history.data.items.map((h) => (
                <tr key={h.id}>
                  <Td>{fmtDateTime(h.effectiveAt, locale)}</Td>
                  <Td>{branchName.get(h.fromBranchId) ?? "—"}</Td>
                  <Td>{branchName.get(h.toBranchId) ?? "—"}</Td>
                  <Td>{h.reason ?? "—"}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
      </>}
    </div>
  );
}
