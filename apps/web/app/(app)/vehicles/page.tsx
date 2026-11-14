"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { COUNTRY_TEMPLATES, EGYPT } from "@fleet/config";
import { allows } from "@fleet/domain";
import { Alert, Badge, Button, Card, PageHeader, Table, Td } from "@/components/ui";
import { VehicleForm } from "@/components/vehicle-form";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { newId } from "@/lib/ids";

const vehicleTone = (s: string) => (s === "active" ? "ok" : s === "draft" || s === "disposed" ? "muted" : "warn") as "ok" | "muted" | "warn";

export default function VehiclesPage() {
  const { api, user } = useSession();
  const { t, locale } = useI18n();
  const country = COUNTRY_TEMPLATES[user?.tenant?.countryCode ?? ""] ?? EGYPT;
  const canWrite = !!user && allows(user, "vehicle.write").allowed;
  const vehicles = useLoad(() => api.call("listVehicles"), [api]);
  const branches = useLoad(() => (user && allows(user, "branch.read").allowed ? api.call("listBranches") : Promise.resolve({ items: [] })), [api, user]);
  const branchName = useMemo(() => new Map(branches.data?.items.map((b) => [b.id, b.name]) ?? []), [branches.data]);
  const fuelName = (code: string | null) => country.fuelTypes.find((f) => f.code === code)?.name[locale] ?? code ?? "—";
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState(newId);
  const [created, setCreated] = useState(false);
  const L = t.vehicles;

  return (
    <>
      <PageHeader title={L.title} action={canWrite && !open && <Button variant="primary" onClick={() => { setOpen(true); setCreated(false); }}>+ {L.add}</Button>} />
      {created && <div className="mb-4"><Alert tone="ok">{L.created}</Alert></div>}
      {open && (
        <Card className="mb-6">
          <VehicleForm country={country} branches={branches.data?.items.filter((b) => b.status === "active")} title={L.add} onCancel={() => setOpen(false)}
            onSubmit={async (fields, branchId) => {
              await api.call("createVehicle", { body: { ...fields, id: pendingId, branchId } });
              setPendingId(newId());
              setOpen(false);
              setCreated(true);
              await vehicles.reload();
            }} />
        </Card>
      )}
      <Card className="p-0">
        {vehicles.loading && !vehicles.data ? (
          <p className="p-6 text-muted">{t.common.loading}</p>
        ) : vehicles.error ? (
          <div className="p-6"><Alert>{t.errors.generic}</Alert></div>
        ) : !vehicles.data?.items.length ? (
          <p className="p-6 text-muted">{L.empty}</p>
        ) : (
          <Table head={[L.fleetNumber, L.registrationNumber, `${L.make} / ${L.model}`, L.year, L.primaryFuelType, L.branch, L.status]}>
            {vehicles.data.items.map((v) => (
              <tr key={v.id} className="hover:bg-[#F8FAFC]">
                <Td className="font-semibold"><Link className="text-accent hover:underline" href={`/vehicles/${v.id}`}>{v.fleetNumber}</Link></Td>
                <Td>{v.registrationNumber}</Td>
                <Td>{v.make} {v.model}</Td>
                <Td>{v.year}</Td>
                <Td>{fuelName(v.primaryFuelType)}{v.secondaryFuelType ? ` + ${fuelName(v.secondaryFuelType)}` : ""}</Td>
                <Td>{branchName.get(v.branchId) ?? "—"}</Td>
                <Td><Badge tone={vehicleTone(v.status)}>{L.statuses[v.status]}</Badge></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
