"use client";
import { useState } from "react";
import Link from "next/link";
import { ALERT_TYPES } from "@fleet/config";
import type { Alert as AlertDto } from "@fleet/contracts";
import { Alert, Badge, Button, Input, Table, Td } from "./ui";
import { useAction } from "./m4-common";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { fmtDateTime } from "@/lib/format";

export const sevTone = { low: "muted", medium: "info", high: "warn", critical: "bad" } as const;
const stTone = { open: "warn", acknowledged: "info", in_progress: "info", resolved: "ok", closed: "muted" } as const;
const NEXT: Record<AlertDto["status"], ("acknowledged" | "in_progress" | "resolved" | "closed")[]> = {
  open: ["acknowledged", "in_progress", "resolved"], acknowledged: ["in_progress", "resolved"], in_progress: ["resolved"], resolved: ["closed"], closed: [],
};
const NAMES = new Map(ALERT_TYPES.map((a) => [a.type as string, a.name]));

/** Where the alert's record lives (drill-down). */
const href = (a: AlertDto) => a.entityType === "vehicle" ? `/vehicles/${a.entityId}` : a.entityType === "driver" ? `/drivers/${a.entityId}`
  : a.entityType === "defect" ? "/maintenance" : a.entityType === "sync_conflict" ? "/sync-conflicts" : a.type === "fuel_budget" ? "/budgets" : null;

export function AlertList({ items, onChange }: { items: AlertDto[]; onChange: () => void }) {
  const { api } = useSession();
  const { t, locale } = useI18n();
  const A = t.m5.alerts;
  const [resolving, setResolving] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const act = useAction();
  const go = async (id: string, status: (typeof NEXT)["open"][number], n?: string) => {
    if (await act.run(() => api.call("alertStatus", { params: { id }, body: { status, ...(n ? { note: n } : {}) } }))) { setResolving(null); onChange(); }
  };
  const detail = (a: AlertDto) => {
    const p = a.params as Record<string, unknown>;
    const doc = p.docName as { ar: string; en: string } | undefined;
    return [p.label, doc?.[locale], p.item, p.expiryDate, typeof p.daysLeft === "number" ? `${p.daysLeft} ${t.m4.maintenance.days}` : null,
      typeof p.threshold === "number" ? `${p.threshold}%` : null, p.description, p.reason, typeof p.totalMinor === "number" ? (p.totalMinor / 100).toFixed(2) : null]
      .filter((x) => x != null && x !== "").map(String);
  };
  if (!items.length) return <p className="p-5 text-muted">{A.empty}</p>;
  return (
    <div>
      {act.error && <div className="p-4"><Alert>{act.error}</Alert></div>}
      <Table head={[A.severity, t.m4.readiness.rule, A.owner, A.created, t.m4.maintenance.status, ""]}>
        {items.map((a) => {
          const link = href(a);
          return (
            <tr key={a.id} className="align-top">
              <Td><Badge tone={sevTone[a.severity]}>{A.severities[a.severity]}</Badge></Td>
              <Td className="max-w-md whitespace-normal">
                <div className="font-medium">{link ? <Link className="text-accent hover:underline" href={link}>{NAMES.get(a.type)?.[locale] ?? a.type}</Link> : NAMES.get(a.type)?.[locale] ?? a.type}</div>
                <div className="text-sm text-muted">{detail(a).join(" · ")}</div>
              </Td>
              <Td className="whitespace-normal">{a.ownerName ?? "—"}{a.ownerFallback && <div className="text-xs text-muted">{A.fallback}</div>}</Td>
              <Td>{fmtDateTime(a.createdAt, locale)}</Td>
              <Td>
                <Badge tone={stTone[a.status]}>{A.statuses[a.status]}</Badge>
                {a.resolution === "auto" && <div className="text-xs text-muted">{A.auto}</div>}
                {a.resolutionNote && <div className="max-w-[14rem] text-xs text-muted">{a.resolutionNote}</div>}
              </Td>
              <Td className="whitespace-normal">
                {resolving === a.id ? (
                  <form className="flex min-w-[14rem] flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void go(a.id, "resolved", note); }}>
                    <Input aria-label={A.note} placeholder={A.note} value={note} onChange={(e) => setNote(e.target.value)} required minLength={3} />
                    <div className="flex gap-1">
                      <Button type="submit" variant="primary" className="min-h-8 px-3" disabled={act.busy}>{A.actions.resolved}</Button>
                      <Button type="button" variant="ghost" className="min-h-8 px-3" onClick={() => setResolving(null)}>{t.common.cancel}</Button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {NEXT[a.status].map((s) => (
                      <Button key={s} className="min-h-8 px-3" disabled={act.busy} onClick={() => (s === "resolved" ? (setResolving(a.id), setNote("")) : void go(a.id, s))}>{A.actions[s]}</Button>
                    ))}
                  </div>
                )}
              </Td>
            </tr>
          );
        })}
      </Table>
    </div>
  );
}

