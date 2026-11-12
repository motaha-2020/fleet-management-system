"use client";
import { useMemo, useState } from "react";
import type { SyncConflict as Conflict } from "@fleet/contracts";
import { Alert, Badge, Button, Card, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { Tabs, fromMinor } from "@/components/m2-common";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { apiErrorMessage } from "@/lib/errors";
import { fmtDateTime } from "@/lib/format";

type Decision = "accept" | "reject" | "correct";
const tone = { open: "warn", accepted: "ok", rejected: "bad", corrected: "info" } as const;

/**
 * US-E14-06: offline events that could not be applied automatically. A person accepts, rejects or corrects
 * each one with a reason (OFF-010); nothing is ever decided by last-write-wins.
 */
export default function SyncConflictsPage() {
  const { api } = useSession();
  const { t, locale } = useI18n();
  const K = t.m3.conflicts;
  const [tab, setTab] = useState<"open" | "all">("open");
  const list = useLoad(() => api.call("listSyncConflicts", { query: tab === "open" ? { status: "open" } : {} }), [api, tab]);
  const vehicles = useLoad(() => api.call("listVehicles"), [api]);
  const vehicleName = useMemo(() => {
    const m = new Map((vehicles.data?.items ?? []).map((v) => [v.id, `${v.fleetNumber} · ${v.registrationNumber}`]));
    return (id: unknown) => (typeof id === "string" ? (m.get(id) ?? id.slice(0, 8)) : "—");
  }, [vehicles.data]);
  const [open, setOpen] = useState<{ id: string; decision: Decision } | null>(null);
  const [reason, setReason] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = (c: Conflict, decision: Decision) => {
    setOpen({ id: c.id, decision });
    setReason("");
    setValue(typeof c.payload.odometer === "number" ? String(c.payload.odometer) : "");
    setError(null);
  };
  const submit = async () => {
    if (!open) return;
    setBusy(true);
    setError(null);
    try {
      await api.call("resolveSyncConflict", {
        params: { id: open.id },
        body: { decision: open.decision, reason, ...(open.decision === "correct" ? { correction: { odometer: parseInt(value, 10) } } : {}) },
      });
      setOpen(null);
      await list.reload();
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  const summary = (c: Conflict) => {
    const p = c.payload;
    const parts = [vehicleName(p.vehicleId)];
    if (typeof p.odometer === "number") parts.push(`${K.fields.odometer}: ${p.odometer.toLocaleString(locale)}`);
    if (typeof p.quantity === "number") parts.push(`${K.fields.quantity}: ${p.quantity}`);
    if (typeof p.amountMinor === "number") parts.push(`${K.fields.amountMinor}: ${fromMinor(p.amountMinor)}`);
    return parts;
  };
  const valueOk = open?.decision !== "correct" || /^\d{1,7}$/.test(value);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={K.title} />
      <p className="max-w-3xl text-sm text-muted">{K.help}</p>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "open", label: K.open }, { id: "all", label: K.all }]} />
      {error && <Alert>{error}</Alert>}
      <Card className="p-0">
        {!list.data?.items.length ? <p className="p-6 text-muted">{K.empty}</p> : (
          <Table head={[K.when, K.event, K.reason, K.status, K.decision]}>
            {list.data.items.map((c) => (
              <tr key={c.id} className="align-top">
                <Td>
                  <div>{fmtDateTime(c.estimatedTime ?? c.deviceTime, locale)}</div>
                  {c.estimatedTime && c.estimatedTime !== c.deviceTime && (
                    <div className="text-xs text-muted">{K.deviceTime}: {fmtDateTime(c.deviceTime, locale)}</div>
                  )}
                </Td>
                <Td className="whitespace-normal">
                  <div className="font-medium">{K.types[c.type] ?? c.type}</div>
                  {summary(c).map((x, i) => <div key={i} className="text-sm text-muted">{x}</div>)}
                </Td>
                <Td className="max-w-xs whitespace-normal">
                  <div>{K.reasons[c.reason] ?? c.reason}</div>
                  {c.flags.map((f) => <Badge key={f} tone="warn">{K.flags[f] ?? f}</Badge>)}
                </Td>
                <Td>
                  <Badge tone={tone[c.status]}>{K.statuses[c.status]}</Badge>
                  {c.resolutionReason && <div className="mt-1 max-w-[14rem] whitespace-normal text-xs text-muted">{c.resolutionReason}</div>}
                  {c.correction && Object.entries(c.correction).map(([f, v]) => (
                    <div key={f} className="text-xs">{K.fields[f] ?? f}: <span className="font-semibold">{String(v)}</span></div>
                  ))}
                </Td>
                <Td className="whitespace-normal">
                  {c.status === "open" && (open?.id === c.id ? (
                    <form className="flex min-w-[16rem] flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
                      <Select aria-label={K.decision} value={open.decision} onChange={(e) => setOpen({ id: c.id, decision: e.target.value as Decision })}>
                        <option value="accept">{K.accept}</option>
                        <option value="reject">{K.reject}</option>
                        {typeof c.payload.odometer === "number" && <option value="correct">{K.correct}</option>}
                      </Select>
                      {open.decision === "correct" && (
                        <Input aria-label={K.correctedValue} placeholder={K.correctedValue} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} />
                      )}
                      <Input aria-label={K.decisionReason} placeholder={K.decisionReason} value={reason} onChange={(e) => setReason(e.target.value)} />
                      <div className="flex gap-1">
                        <Button type="submit" variant="primary" className="min-h-8 px-3" disabled={busy || reason.trim().length < 3 || !valueOk}>{K.confirm}</Button>
                        <Button type="button" variant="ghost" className="min-h-8 px-3" onClick={() => setOpen(null)}>{t.common.cancel}</Button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      <Button variant="primary" className="min-h-8 px-3" onClick={() => start(c, "accept")}>{K.accept}</Button>
                      <Button className="min-h-8 px-3" onClick={() => start(c, "reject")}>{K.reject}</Button>
                      {typeof c.payload.odometer === "number" && <Button className="min-h-8 px-3" onClick={() => start(c, "correct")}>{K.correct}</Button>}
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
