"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { COUNTRY_TEMPLATES, EGYPT } from "@fleet/config";
import { authorize } from "@fleet/domain";
import { Alert, Badge, Button, Card, PageHeader, Table, Td } from "@/components/ui";
import { DriverForm } from "@/components/driver-form";
import { ActivationCodeCard } from "@/components/activation-code";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { newId } from "@/lib/ids";
import { apiErrorMessage } from "@/lib/errors";

export default function DriversPage() {
  const { api, user } = useSession();
  const { t } = useI18n();
  const L = t.drivers;
  const D = t.driver;
  const country = COUNTRY_TEMPLATES[user?.tenant?.countryCode ?? ""] ?? EGYPT;
  const can = (a: Parameters<typeof authorize>[1]) => !!user && authorize(user.role, a).allowed;
  const drivers = useLoad(() => api.call("listDrivers"), [api]);
  const branches = useLoad(() => (can("branch.read") ? api.call("listBranches") : Promise.resolve({ items: [] })), [api, user]);
  const branchName = useMemo(() => new Map(branches.data?.items.map((b) => [b.id, b.name]) ?? []), [branches.data]);
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState(newId);
  const [message, setMessage] = useState<string | null>(null);
  const [code, setCode] = useState<{ name: string; username: string; code: string; expiresAt: string } | null>(null);

  async function issue(id: string, name: string) {
    setMessage(null);
    try {
      setCode({ name, ...(await api.call("issueActivationCode", { params: { id } })) });
      await drivers.reload();
    } catch (err) {
      setMessage(apiErrorMessage(t, err));
    }
  }

  return (
    <>
      <PageHeader title={L.title} action={can("driver.write") && !open && <Button variant="primary" onClick={() => setOpen(true)}>+ {L.add}</Button>} />
      {message && <div className="mb-4"><Alert>{message}</Alert></div>}
      {code && <div className="mb-6"><ActivationCodeCard code={code} onClose={() => setCode(null)} /></div>}
      {open && (
        <Card className="mb-6">
          <DriverForm country={country} branches={branches.data?.items.filter((b) => b.status === "active") ?? []} title={L.add} onCancel={() => setOpen(false)}
            onSubmit={async (f) => {
              await api.call("createDriver", { body: { ...f, id: pendingId, nationalId: f.nationalId ?? null } });
              setPendingId(newId());
              setOpen(false);
              await drivers.reload();
            }} />
        </Card>
      )}
      <Card className="p-0">
        {drivers.loading && !drivers.data ? (
          <p className="p-6 text-muted">{t.common.loading}</p>
        ) : !drivers.data?.items.length ? (
          <p className="p-6 text-muted">{L.empty}</p>
        ) : (
          <Table head={[L.fullName, L.username, L.branch, D.employment, D.eligibility, L.device, ""]}>
            {drivers.data.items.map((d) => (
              <tr key={d.id}>
                <Td className="font-semibold"><Link className="text-accent hover:underline" href={`/drivers/${d.id}`}>{d.fullName}</Link></Td>
                <Td><span dir="ltr">{d.username}</span></Td>
                <Td>{branchName.get(d.branchId) ?? "—"}</Td>
                <Td><Badge tone={d.employmentStatus === "active" ? "ok" : d.employmentStatus === "suspended" ? "warn" : "muted"}>{D.employmentStatuses[d.employmentStatus]}</Badge></Td>
                <Td><Badge tone={d.eligibility.status === "eligible" ? "ok" : "warn"}>{d.eligibility.status === "eligible" ? D.eligible : D.restricted}</Badge></Td>
                <Td><Badge tone={d.hasActiveDevice ? "ok" : "muted"}>{d.hasActiveDevice ? L.deviceActive : L.deviceNone}</Badge></Td>
                <Td>{can("driver.issue_activation") && d.status === "active" && d.employmentStatus !== "terminated" && <Button variant="ghost" onClick={() => issue(d.id, d.fullName)}>{L.issueCode}</Button>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
