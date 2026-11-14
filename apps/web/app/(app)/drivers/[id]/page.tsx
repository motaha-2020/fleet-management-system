"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { COUNTRY_TEMPLATES, EGYPT } from "@fleet/config";
import { allows, EMPLOYMENT_STATUSES } from "@fleet/domain";
import { Alert, Badge, Button, Card, Select } from "@/components/ui";
import { DetailGrid } from "@/components/detail";
import { DriverForm } from "@/components/driver-form";
import { DocumentsPanel } from "@/components/documents-panel";
import { ActivationCodeCard } from "@/components/activation-code";
import { DriverAssignments } from "@/components/driver-assignments";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { apiErrorMessage } from "@/lib/errors";
import { fmtDate } from "@/lib/format";

export default function DriverPage() {
  const { id } = useParams<{ id: string }>();
  const { api, user } = useSession();
  const { t, locale } = useI18n();
  const L = t.drivers;
  const D = t.driver;
  const country = COUNTRY_TEMPLATES[user?.tenant?.countryCode ?? ""] ?? EGYPT;
  const can = (a: Parameters<typeof allows>[1]) => !!user && allows(user, a).allowed;
  const driver = useLoad(() => api.call("getDriver", { params: { id } }), [api, id]);
  const branches = useLoad(() => (can("branch.read") ? api.call("listBranches") : Promise.resolve({ items: [] })), [api, user]);
  const branchName = useMemo(() => new Map(branches.data?.items.map((b) => [b.id, b.name]) ?? []), [branches.data]);
  const [edit, setEdit] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "bad" | "info"; text: string } | null>(null);
  const [code, setCode] = useState<{ name: string; username: string; code: string; expiresAt: string } | null>(null);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setMessage(null);
    try {
      await fn();
      if (ok) setMessage({ tone: "info", text: ok });
      await driver.reload();
    } catch (err) {
      setMessage({ tone: "bad", text: apiErrorMessage(t, err) });
    }
  }

  if (driver.error) return <Alert>{apiErrorMessage(t, driver.error)}</Alert>;
  const d = driver.data;
  if (!d) return <p className="text-muted">{t.common.loading}</p>;
  const lic = (c: string) => country.licenseCategories.find((l) => l.code === c)?.name[locale] ?? c;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/drivers" className="text-sm text-accent hover:underline">← {D.back}</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{d.fullName}</h1>
          <Badge tone={d.eligibility.status === "eligible" ? "ok" : "warn"}>{d.eligibility.status === "eligible" ? D.eligible : D.restricted}</Badge>
          {d.eligibility.reasons.map((r) => <Badge key={r} tone="warn">{(D.reasons as Record<string, string>)[r] ?? r}</Badge>)}
        </div>
      </div>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      {code && <ActivationCodeCard code={code} onClose={() => setCode(null)} />}

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">{D.details}</h2>
          {can("driver.write") && (
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => setEdit(!edit)}>{D.edit}</Button>
              <label className="sr-only" htmlFor="employment">{D.employment}</label>
              <Select id="employment" value={d.employmentStatus} className="min-h-10 w-auto"
                onChange={(e) => run(() => api.call("updateDriver", { params: { id }, body: { employmentStatus: e.target.value as (typeof EMPLOYMENT_STATUSES)[number] } }))}>
                {EMPLOYMENT_STATUSES.map((s) => <option key={s} value={s}>{D.employmentStatuses[s]}</option>)}
              </Select>
              {d.status === "active"
                ? <Button onClick={() => run(() => api.call("setDriverAccount", { params: { id }, body: { active: false } }))}>{D.disableAccount}</Button>
                : d.employmentStatus !== "terminated" && <Button onClick={() => run(() => api.call("setDriverAccount", { params: { id }, body: { active: true } }))}>{D.enableAccount}</Button>}
              {can("driver.issue_activation") && d.status === "active" && d.employmentStatus !== "terminated" && (
                <Button variant="primary" onClick={() => run(async () => setCode({ name: d.fullName, ...(await api.call("issueActivationCode", { params: { id } })) }))}>{L.issueCode}</Button>
              )}
            </div>
          )}
        </div>
        {edit ? (
          <DriverForm country={country} branches={branches.data?.items.filter((b) => b.status === "active") ?? []} initial={d} title={D.edit} onCancel={() => setEdit(false)}
            onSubmit={async (f) => {
              const { username: _u, ...rest } = f;
              await api.call("updateDriver", { params: { id }, body: rest });
              setEdit(false);
              await driver.reload();
            }} />
        ) : (
          <DetailGrid items={[
            [L.username, <span dir="ltr" key="u">{d.username}</span>],
            [L.phone, d.phone ? <span dir="ltr" key="p">{d.phone}</span> : "—"],
            [L.branch, branchName.get(d.branchId) ?? "—"],
            [D.employeeRef, d.employeeRef ?? "—"],
            [D.nationalId, (
              <span key="nid" className="flex items-center gap-2">
                <span dir="ltr" className="font-mono" data-testid="national-id">{revealed ?? d.nationalIdMasked ?? "—"}</span>
                {d.nationalIdMasked && !revealed && can("driver.view_sensitive") && (
                  <Button variant="ghost" className="min-h-7 px-2 text-xs"
                    onClick={() => run(async () => setRevealed((await api.call("revealDriverSensitive", { params: { id } })).nationalId), D.revealed)}>{D.reveal}</Button>
                )}
              </span>
            )],
            [D.licenseNumber, d.licenseNumber ?? "—"],
            [D.licenseCategories, d.licenseCategories.length ? d.licenseCategories.map(lic).join("، ") : "—"],
            [D.licenseExpiry, fmtDate(d.licenseExpiry, locale)],
            [D.employment, D.employmentStatuses[d.employmentStatus]],
            [D.account, d.status === "active" ? D.accountActive : D.accountInactive],
            [L.device, d.hasActiveDevice ? L.deviceActive : L.deviceNone],
          ]} />
        )}
      </Card>

      {can("assignment.read") && <DriverAssignments driver={d} />}

      {can("document.read") && <DocumentsPanel entityType="driver" entityId={id} />}
    </div>
  );
}
