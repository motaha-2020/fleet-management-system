"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { allows } from "@fleet/domain";
import { Alert, Badge, Button, Card, PageHeader, Select, Table, Td } from "@/components/ui";
import { Tabs } from "@/components/m2-common";
import { ReadinessCard, outcomeTone, useAction } from "@/components/m4-common";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { fmtDateTime } from "@/lib/format";

type Tab = "vehicles" | "overrides" | "rules";
const RISKS = ["R1", "R2", "R3", "R4"] as const;

/** E12: readiness across the fleet, active overrides, and company risk settings (US-E12-01..04). */
export default function ReadinessPage() {
  const { api, user } = useSession();
  const { t, locale } = useI18n();
  const R = t.m4.readiness;
  const can = (a: Parameters<typeof allows>[1]) => !!user && allows(user, a).allowed;
  const [tab, setTab] = useState<Tab>("vehicles");
  const [selected, setSelected] = useState<string | null>(null);
  const vehicles = useLoad(() => api.call("listVehicles"), [api]);
  const names = useMemo(() => new Map((vehicles.data?.items ?? []).map((v) => [v.id, `${v.fleetNumber} · ${v.registrationNumber}`])), [vehicles.data]);
  const rows = useLoad(() => api.call("vehiclesReadiness"), [api]);
  const overrides = useLoad(() => (tab === "overrides" ? api.call("listOverrides", { query: {} }) : Promise.resolve({ items: [] })), [api, tab]);
  const rules = useLoad(() => (tab === "rules" ? api.call("readinessRules") : Promise.resolve({ items: [] })), [api, tab]);
  const act = useAction();
  const order = { restricted: 0, warning: 1, allowed: 2 } as const;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={R.title} />
      <p className="max-w-3xl text-sm text-muted">{R.help}</p>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: "vehicles", label: R.vehicles }, { id: "overrides", label: R.overrides }, { id: "rules", label: R.rulesTitle },
      ]} />
      {act.error && <Alert>{act.error}</Alert>}

      {tab === "vehicles" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <Card className="p-0">
            {!rows.data?.items.length ? <p className="p-5 text-muted">{t.common.none}</p> : (
              <Table head={[R.vehicle, t.m4.maintenance.status, R.codes]}>
                {[...rows.data.items].sort((a, b) => order[a.outcome] - order[b.outcome]).map((r) => (
                  <tr key={r.vehicleId} className={`cursor-pointer ${selected === r.vehicleId ? "bg-accent-soft/50" : ""}`} onClick={() => setSelected(r.vehicleId)}>
                    <Td><button type="button" className="text-accent hover:underline">{names.get(r.vehicleId) ?? r.vehicleId.slice(0, 8)}</button></Td>
                    <Td><Badge tone={outcomeTone[r.outcome]}>{t.m4.outcome[r.outcome]}</Badge></Td>
                    <Td className="whitespace-normal text-xs text-muted">{r.codes.map((c) => t.m4.rules[c] ?? c).join(" · ") || "—"}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
          {selected && (
            <div className="flex flex-col gap-2">
              <ReadinessCard key={selected} vehicleId={selected} title={names.get(selected)} />
              <Link href={`/vehicles/${selected}`} className="text-sm text-accent hover:underline">{t.vehicle.details} ←</Link>
            </div>
          )}
        </div>
      )}

      {tab === "overrides" && (
        <Card className="p-0">
          {!overrides.data?.items.length ? <p className="p-5 text-muted">{t.common.none}</p> : (
            <Table head={[R.rule, R.vehicle, R.overrideReason, R.expiresAt, t.m4.maintenance.status, ""]}>
              {overrides.data.items.map((o) => (
                <tr key={o.id}>
                  <Td>{t.m4.rules[o.ruleCode] ?? o.ruleCode}{o.subject && !/^[0-9a-f-]{36}$/.test(o.subject) && <span className="ms-1 font-mono text-xs text-muted">{o.subject}</span>}</Td>
                  <Td>{o.entityType === "vehicle" ? (names.get(o.entityId) ?? o.entityId.slice(0, 8)) : <Link className="text-accent hover:underline" href={`/drivers/${o.entityId}`}>{t.nav.drivers}</Link>}</Td>
                  <Td className="max-w-xs whitespace-normal">{o.reason}</Td>
                  <Td>{fmtDateTime(o.expiresAt, locale)}</Td>
                  <Td><Badge tone={o.active ? "warn" : "muted"}>{o.active ? R.active : R.ended}</Badge></Td>
                  <Td>{o.active && can("readiness.override") && (
                    <Button variant="ghost" className="min-h-8 px-3" disabled={act.busy} onClick={async () => { if (await act.run(() => api.call("revokeOverride", { params: { id: o.id } }))) await Promise.all([overrides.reload(), rows.reload()]); }}>{R.revoke}</Button>
                  )}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === "rules" && (
        <Card className="p-0">
          <p className="border-b border-line px-5 py-3 text-sm text-muted">{R.rulesHelp}</p>
          <Table head={[R.rule, R.defaultRisk, R.companyRisk]}>
            {rules.data?.items.map((r) => {
              const base = r.defaultRisk === "document_type" ? null : r.defaultRisk;
              const allowed = base ? RISKS.slice(RISKS.indexOf(base)) : [];
              return (
                <tr key={r.code}>
                  <Td className="whitespace-normal">{r.name[locale]}</Td>
                  <Td>{base ? t.m4.risk[base] : R.byDocType}</Td>
                  <Td>
                    {r.configurable && can("readiness.configure") ? (
                      <Select aria-label={`${R.companyRisk} ${r.name[locale]}`} className="w-44" value={r.companyRisk ?? base ?? ""} disabled={act.busy}
                        onChange={async (e) => { if (await act.run(() => api.call("setReadinessRule", { params: { code: r.code }, body: { risk: e.target.value as (typeof RISKS)[number] } }))) await rules.reload(); }}>
                        {allowed.filter((x) => RISKS.indexOf(x) >= RISKS.indexOf((r.companyRisk ?? base)!)).map((x) => <option key={x} value={x}>{t.m4.risk[x]}</option>)}
                      </Select>
                    ) : <span className="text-muted">{r.companyRisk ? t.m4.risk[r.companyRisk] : R.fixed}</span>}
                  </Td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}
    </div>
  );
}
