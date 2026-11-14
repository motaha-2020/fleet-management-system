"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { allows } from "@fleet/domain";
import type { Fine } from "@fleet/contracts";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { Tabs, localInputToIso, nowLocalInput, toMinor } from "@/components/m2-common";
import { inDays, useAction } from "@/components/m4-common";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";

const payTone = { unpaid: "warn", paid: "ok", disputed: "info" } as const;

/** E29: fines with the custodian suggested at the violation time (confirmed by a person), one cost each, payment status. */
export default function FinesPage() {
  const { api, user } = useSession();
  const { t, locale } = useI18n();
  const F = t.m5.fines;
  const canWrite = !!user && allows(user, "fine.write").allowed;
  const [tab, setTab] = useState<"unpaid" | "all">("unpaid");
  const list = useLoad(() => api.call("listFines", { query: tab === "unpaid" ? { paymentStatus: "unpaid" } : {} }), [api, tab]);
  const vehicles = useLoad(() => api.call("listVehicles"), [api]);
  const drivers = useLoad(() => (user && allows(user, "driver.read").allowed ? api.call("listDrivers") : Promise.resolve({ items: [] })), [api, user]);
  const vName = useMemo(() => new Map((vehicles.data?.items ?? []).map((v) => [v.id, `${v.fleetNumber} · ${v.registrationNumber}`])), [vehicles.data]);
  const dName = useMemo(() => new Map((drivers.data?.items ?? []).map((d) => [d.id, d.fullName])), [drivers.data]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ vehicleId: "", violationAt: nowLocalInput(), amount: "", ref: "", dueDate: "", description: "", driverId: "" });
  const [suggested, setSuggested] = useState<{ driverId: string | null; driverName: string | null } | null>(null);
  const [pending, setPending] = useState<{ id: string; kind: "pay" | "void" | "driver" } | null>(null);
  const [x, setX] = useState({ paidOn: inDays(0), reason: "", driverId: "" });
  const act = useAction();

  // INC-003: the custodian at the violation time is suggested; the user confirms or changes it.
  useEffect(() => {
    if (!f.vehicleId || !f.violationAt) return setSuggested(null);
    let alive = true;
    void api.call("suggestFineDriver", { query: { vehicleId: f.vehicleId, at: localInputToIso(f.violationAt) } }).then((s) => {
      if (!alive) return;
      setSuggested(s);
      setF((cur) => ({ ...cur, driverId: s.driverId ?? "" }));
    }).catch(() => alive && setSuggested(null));
    return () => { alive = false; };
  }, [api, f.vehicleId, f.violationAt]);

  const save = async () => {
    const ok = await act.run(() => api.call("createFine", {
      body: { vehicleId: f.vehicleId, violationAt: localInputToIso(f.violationAt), amountMinor: toMinor(f.amount), authorityRef: f.ref || null, dueDate: f.dueDate || null,
        description: f.description || null, driverId: f.driverId || null },
    }));
    if (ok) { setOpen(false); setF({ vehicleId: "", violationAt: nowLocalInput(), amount: "", ref: "", dueDate: "", description: "", driverId: "" }); await list.reload(); }
  };
  const after = async (fn: () => Promise<unknown>) => { if (await act.run(fn)) { setPending(null); await list.reload(); } };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={F.title} action={canWrite && !open ? <Button variant="primary" onClick={() => setOpen(true)}>+ {F.add}</Button> : undefined} />
      {act.error && <Alert>{act.error}</Alert>}
      {open && (
        <Card>
          <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <Field label={F.vehicle} error={act.fe("vehicleId")}>
              <Select value={f.vehicleId} onChange={(e) => setF({ ...f, vehicleId: e.target.value })} required>
                <option value="">—</option>
                {vehicles.data?.items.filter((v) => v.status !== "draft").map((v) => <option key={v.id} value={v.id}>{vName.get(v.id)}</option>)}
              </Select>
            </Field>
            <Field label={F.violationAt} error={act.fe("violationAt")}><Input type="datetime-local" value={f.violationAt} onChange={(e) => setF({ ...f, violationAt: e.target.value })} required /></Field>
            <Field label={F.amount}><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required /></Field>
            <Field label={`${F.ref} (${t.common.optional})`} error={act.fe("authorityRef")}><Input dir="ltr" value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} /></Field>
            <Field label={`${F.dueDate} (${t.common.optional})`}><Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
            <Field label={`${F.description} (${t.common.optional})`}><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
            <Field label={F.driver} hint={suggested ? (suggested.driverId ? `${F.suggested}: ${suggested.driverName}` : F.noCustodian) : undefined}>
              <Select value={f.driverId} onChange={(e) => setF({ ...f, driverId: e.target.value })}>
                <option value="">—</option>
                {drivers.data?.items.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
              </Select>
            </Field>
            <div className="flex items-end gap-2 sm:col-span-2">
              <Button variant="primary" type="submit" disabled={act.busy || !f.vehicleId || !f.amount}>{t.common.save}</Button>
              <Button type="button" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
            </div>
          </form>
        </Card>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "unpaid", label: F.unpaid }, { id: "all", label: t.m4.defects.all }]} />
      <Card className="p-0">
        {!list.data?.items.length ? <p className="p-5 text-muted">{F.empty}</p> : (
          <Table head={[F.violationAt, F.vehicle, F.ref, F.amount, F.driver, F.payment, ""]}>
            {list.data.items.map((fine: Fine) => (
              <tr key={fine.id} className="align-top">
                <Td>{fmtDateTime(fine.violationAt, locale)}{fine.dueDate && <div className="text-xs text-muted">{F.dueDate}: {fmtDate(fine.dueDate, locale)}</div>}</Td>
                <Td><Link className="text-accent hover:underline" href={`/vehicles/${fine.vehicleId}`}>{vName.get(fine.vehicleId) ?? fine.vehicleId.slice(0, 8)}</Link></Td>
                <Td className="font-mono text-sm">{fine.authorityRef ?? "—"}</Td>
                <Td className="font-semibold">{fmtMoney(fine.amountMinor, fine.currency, locale)}</Td>
                <Td className="whitespace-normal">
                  {fine.driverConfirmedAt ? (fine.driverId ? dName.get(fine.driverId) ?? "—" : F.noCustodian.split("—")[0]) : <>
                    <Badge tone="warn">{F.notConfirmed}</Badge>
                    {fine.suggestedDriverId && <div className="text-xs text-muted">{F.suggested}: {dName.get(fine.suggestedDriverId)}</div>}
                  </>}
                </Td>
                <Td>
                  <Badge tone={payTone[fine.paymentStatus]}>{F.statuses[fine.paymentStatus]}</Badge>
                  {fine.status === "voided" && <div className="text-xs text-muted">{fine.voidReason}</div>}
                </Td>
                <Td className="whitespace-normal">
                  {canWrite && fine.status === "active" && (pending?.id === fine.id ? (
                    <form className="flex min-w-[14rem] flex-col gap-2" onSubmit={(e) => {
                      e.preventDefault();
                      if (pending.kind === "pay") void after(() => api.call("finePayment", { params: { id: fine.id }, body: { paymentStatus: "paid", paidOn: x.paidOn } }));
                      else if (pending.kind === "void") void after(() => api.call("voidFine", { params: { id: fine.id }, body: { reason: x.reason } }));
                      else void after(() => api.call("confirmFineDriver", { params: { id: fine.id }, body: { driverId: x.driverId || null } }));
                    }}>
                      {pending.kind === "pay" && <Input type="date" aria-label={F.paidOn} value={x.paidOn} onChange={(e) => setX({ ...x, paidOn: e.target.value })} />}
                      {pending.kind === "void" && <Input aria-label={F.voidReason} placeholder={F.voidReason} value={x.reason} onChange={(e) => setX({ ...x, reason: e.target.value })} required minLength={3} />}
                      {pending.kind === "driver" && (
                        <Select aria-label={F.driver} value={x.driverId} onChange={(e) => setX({ ...x, driverId: e.target.value })}>
                          <option value="">—</option>
                          {drivers.data?.items.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
                        </Select>
                      )}
                      <div className="flex gap-1">
                        <Button type="submit" variant="primary" className="min-h-8 px-3" disabled={act.busy}>{pending.kind === "pay" ? F.pay : pending.kind === "void" ? F.void : F.confirm}</Button>
                        <Button type="button" variant="ghost" className="min-h-8 px-3" onClick={() => setPending(null)}>{t.common.cancel}</Button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {!fine.driverConfirmedAt && <Button className="min-h-8 px-3" onClick={() => { setPending({ id: fine.id, kind: "driver" }); setX({ ...x, driverId: fine.suggestedDriverId ?? "" }); }}>{F.confirm}</Button>}
                      {fine.paymentStatus !== "paid" && <Button className="min-h-8 px-3" onClick={() => { setPending({ id: fine.id, kind: "pay" }); setX({ ...x, paidOn: inDays(0) }); }}>{F.pay}</Button>}
                      {fine.paymentStatus === "unpaid" && <Button className="min-h-8 px-3" disabled={act.busy} onClick={() => void after(() => api.call("finePayment", { params: { id: fine.id }, body: { paymentStatus: "disputed" } }))}>{F.dispute}</Button>}
                      <Button variant="ghost" className="min-h-8 px-3 text-bad" onClick={() => { setPending({ id: fine.id, kind: "void" }); setX({ ...x, reason: "" }); }}>{F.void}</Button>
                    </div>
                  ))}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
