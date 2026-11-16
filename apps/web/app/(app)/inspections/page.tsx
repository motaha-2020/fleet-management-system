"use client";
import { useMemo, useState, type FormEvent } from "react";
import { INSPECTION_ITEMS } from "@fleet/config";
import { allows } from "@fleet/domain";
import { fieldError, pick } from "@fleet/i18n";
import { ApiRequestError } from "@fleet/contracts";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { apiErrorMessage } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/format";

/**
 * Owner decision (14 Nov 2026): vehicle inspections with a checklist; how often is set in Policies; they count once
 * approved (Approvals page). Failed critical items alert the fleet manager.
 */
export default function InspectionsPage() {
  const { api, user } = useSession();
  const { t, locale } = useI18n();
  const I = t.inspections;
  const canCreate = allows(user, "inspection.create").allowed;
  const due = useLoad(() => api.call("inspectionsDue"), [api]);
  const list = useLoad(() => api.call("listInspections", { query: {} }), [api]);
  const vehicles = useLoad(() => api.call("listVehicles"), [api]);
  const vName = useMemo(() => new Map((vehicles.data?.items ?? []).map((v) => [v.id, `${v.fleetNumber} · ${v.registrationNumber}`])), [vehicles.data]);
  const name = (code: string) => pick(INSPECTION_ITEMS.find((i) => i.code === code)?.name, locale) ?? code;
  const [open, setOpen] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, { ok: boolean; note: string }>>({});
  const [odometer, setOdometer] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const start = (vehicleId: string) => {
    setOpen(vehicleId);
    setChecks(Object.fromEntries(INSPECTION_ITEMS.map((i) => [i.code, { ok: true, note: "" }])));
    setOdometer("");
    setNotes("");
    setErrors({});
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!open) return;
    setMessage(null);
    try {
      await api.call("createInspection", { body: {
        vehicleId: open, odometer: odometer ? parseInt(odometer, 10) : null, notes: notes || null,
        items: Object.entries(checks).map(([code, c]) => ({ code, ok: c.ok, note: c.note || null })),
      } });
      setOpen(null);
      setMessage({ tone: "ok", text: I.saved });
      await Promise.all([due.reload(), list.reload()]);
    } catch (err) {
      if (err instanceof ApiRequestError) setErrors(err.fields);
      setMessage({ tone: "bad", text: apiErrorMessage(t, err) });
    }
  };

  return (
    <>
      <PageHeader title={I.title} action={canCreate && !open && (
        <Select aria-label={I.add} className="w-auto" value="" onChange={(e) => e.target.value && start(e.target.value)}>
          <option value="">+ {I.add}</option>
          {vehicles.data?.items.filter((v) => v.status === "active").map((v) => <option key={v.id} value={v.id}>{v.fleetNumber} · {v.registrationNumber}</option>)}
        </Select>
      )} />
      {message && <div className="mb-4"><Alert tone={message.tone}>{message.text}</Alert></div>}
      {open && (
        <Card className="mb-6 border-accent">
          <form onSubmit={save} noValidate>
            <h2 className="mb-4 text-lg font-bold">{I.add} — {vName.get(open)}</h2>
            <div className="mb-4 divide-y divide-line rounded-lg border border-line">
              {INSPECTION_ITEMS.map((item) => {
                const c = checks[item.code] ?? { ok: true, note: "" };
                return (
                  <div key={item.code} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                    <span className="min-w-[12rem] flex-1">{pick(item.name, locale)}{item.critical && <span className="ms-1 text-bad">*</span>}</span>
                    <div className="flex gap-1" role="radiogroup" aria-label={pick(item.name, locale)}>
                      <Button type="button" variant={c.ok ? "primary" : "ghost"} className="min-h-8 px-3" onClick={() => setChecks({ ...checks, [item.code]: { ...c, ok: true } })}>{I.ok}</Button>
                      <Button type="button" variant={!c.ok ? "primary" : "ghost"} className="min-h-8 px-3" onClick={() => setChecks({ ...checks, [item.code]: { ...c, ok: false } })}>{I.notOk}</Button>
                    </div>
                    {!c.ok && <Input aria-label={I.note} placeholder={I.note} className="min-h-8 w-56" value={c.note} onChange={(e) => setChecks({ ...checks, [item.code]: { ...c, note: e.target.value } })} />}
                  </div>
                );
              })}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={I.odometer} error={fieldError(t, errors.odometer)}><Input inputMode="numeric" dir="ltr" value={odometer} onChange={(e) => setOdometer(e.target.value.replace(/\D/g, ""))} /></Field>
              <Field label={I.notes}><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            </div>
            <div className="mt-5 flex gap-2">
              <Button variant="primary" type="submit">{t.common.save}</Button>
              <Button type="button" onClick={() => setOpen(null)}>{t.common.cancel}</Button>
            </div>
          </form>
        </Card>
      )}
      <h2 className="mb-1 text-lg font-bold">{I.due}</h2>
      {due.data?.items[0] && <p className="mb-3 text-sm text-muted">{I.everyDays.replace("{n}", String(due.data.items[0].everyDays))}</p>}
      <Card className="mb-8 p-0">
        {!due.data ? <p className="p-6 text-muted">{t.common.loading}</p> : (
          <Table head={[I.vehicle, I.lastAt, I.dueOn, ""]}>
            {due.data.items.map((d) => (
              <tr key={d.vehicleId}>
                <Td className="font-semibold">{d.label}</Td>
                <Td>{d.lastAt ? fmtDateTime(d.lastAt, locale) : I.never}</Td>
                <Td>{d.dueOn ? fmtDate(d.dueOn, locale) : "—"} {d.overdue && <Badge tone="bad">{I.overdue}</Badge>}</Td>
                <Td>{canCreate && !open && <Button variant="ghost" className="min-h-8 px-2" onClick={() => start(d.vehicleId)}>{I.add}</Button>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <h2 className="mb-3 text-lg font-bold">{I.history}</h2>
      <Card className="p-0">
        {!list.data ? <p className="p-6 text-muted">{t.common.loading}</p> : !list.data.items.length ? <p className="p-6 text-muted">{I.empty}</p> : (
          <Table head={[I.at, I.vehicle, I.failed, I.status]}>
            {list.data.items.map((r) => (
              <tr key={r.id}>
                <Td>{fmtDateTime(r.inspectedAt, locale)}</Td>
                <Td className="font-semibold">{vName.get(r.vehicleId) ?? "—"}</Td>
                <Td className="whitespace-normal">{r.items.filter((i) => !i.ok).map((i) => `${name(i.code)}${i.note ? ` (${i.note})` : ""}`).join("، ") || "—"}</Td>
                <Td><Badge tone={r.status === "approved" ? "ok" : r.status === "rejected" ? "bad" : "warn"}>{I.statuses[r.status]}</Badge>{r.decisionReason && <div className="text-xs text-muted">{r.decisionReason}</div>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
