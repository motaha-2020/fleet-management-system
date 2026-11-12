"use client";
import { useMemo, useState } from "react";
import { authorize } from "@fleet/domain";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { toMinor } from "@/components/m2-common";
import { useAction } from "@/components/m4-common";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { fmtMoney } from "@/lib/format";

/** FUEL-015 / US-E09-08: monthly fuel budget per company, branch or vehicle, against accepted fuel; alerts at 80% / 100%. */
export default function BudgetsPage() {
  const { api, user } = useSession();
  const { t, locale } = useI18n();
  const B = t.m5.budgets;
  const canSet = !!user && authorize(user.role, "fuel_budget.manage").allowed;
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const list = useLoad(() => api.call("listFuelBudgets", { query: { month } }), [api, month]);
  const vehicles = useLoad(() => api.call("listVehicles"), [api]);
  const branches = useLoad(() => (user && authorize(user.role, "branch.read").allowed ? api.call("listBranches") : Promise.resolve({ items: [] })), [api, user]);
  const vName = useMemo(() => new Map((vehicles.data?.items ?? []).map((v) => [v.id, v.fleetNumber])), [vehicles.data]);
  const bName = useMemo(() => new Map((branches.data?.items ?? []).map((b) => [b.id, b.name])), [branches.data]);
  const [f, setF] = useState({ scope: "branch" as "company" | "branch" | "vehicle", target: "", amount: "", liters: "" });
  const act = useAction();
  const save = async () => {
    const ok = await act.run(() => api.call("setFuelBudget", {
      body: { scope: f.scope, month, branchId: f.scope === "branch" ? f.target : null, vehicleId: f.scope === "vehicle" ? f.target : null,
        amountMinor: f.amount ? toMinor(f.amount) : null, liters: f.liters ? Number(f.liters) : null },
    }));
    if (ok) { setF({ ...f, amount: "", liters: "" }); await list.reload(); }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={B.title} />
      <div className="flex items-end gap-3"><Field label={B.month}><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field></div>
      {act.error && <Alert>{act.error}</Alert>}
      {canSet && (
        <Card>
          <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <Field label={B.scope}>
              <Select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value as typeof f.scope, target: "" })}>
                {(["company", "branch", "vehicle"] as const).map((s) => <option key={s} value={s}>{B.scopes[s]}</option>)}
              </Select>
            </Field>
            {f.scope !== "company" && (
              <Field label={B.target} error={act.fe(f.scope === "branch" ? "branchId" : "vehicleId")}>
                <Select value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} required>
                  <option value="">—</option>
                  {(f.scope === "branch" ? branches.data?.items.map((b) => ({ id: b.id, label: b.name })) : vehicles.data?.items.filter((v) => v.status === "active").map((v) => ({ id: v.id, label: `${v.fleetNumber} · ${v.registrationNumber}` })))
                    ?.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </Select>
              </Field>
            )}
            <Field label={B.amount} error={act.fe("amountMinor")}><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
            <Field label={B.liters}><Input inputMode="decimal" value={f.liters} onChange={(e) => setF({ ...f, liters: e.target.value })} /></Field>
            <div className="flex items-end"><Button variant="primary" type="submit" disabled={act.busy || (!f.amount && !f.liters)}>{B.set}</Button></div>
          </form>
        </Card>
      )}
      <Card className="p-0">
        {!list.data?.items.length ? <p className="p-5 text-muted">{B.empty}</p> : (
          <Table head={[B.scope, B.amount, B.actual, B.usage, B.variance, B.liters]}>
            {list.data.items.map((b) => (
              <tr key={b.id}>
                <Td>{B.scopes[b.scope]}{b.branchId ? ` · ${bName.get(b.branchId) ?? ""}` : ""}{b.vehicleId ? ` · ${vName.get(b.vehicleId) ?? ""}` : ""}</Td>
                <Td>{b.amountMinor != null ? fmtMoney(b.amountMinor, "EGP", locale) : "—"}</Td>
                <Td className="font-semibold">{fmtMoney(b.actualMinor, "EGP", locale)}</Td>
                <Td>{b.amountPercent != null ? <Badge tone={b.threshold === 100 ? "bad" : b.threshold === 80 ? "warn" : "ok"}>{b.amountPercent}%</Badge> : "—"}</Td>
                <Td className={b.varianceMinor != null && b.varianceMinor > 0 ? "text-bad" : ""}>{b.varianceMinor != null ? fmtMoney(b.varianceMinor, "EGP", locale) : "—"}</Td>
                <Td>{b.liters != null ? `${b.actualLiters} / ${b.liters}` : b.actualLiters}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
