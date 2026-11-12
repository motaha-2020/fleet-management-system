"use client";
import { useState } from "react";
import type { Correction } from "@fleet/contracts";
import { Alert, Badge, Button, Card, PageHeader, Table, Td } from "@/components/ui";
import { Tabs, fromMinor } from "@/components/m2-common";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { apiErrorMessage } from "@/lib/errors";
import { fmtDateTime } from "@/lib/format";

const fmt = (field: string, v: unknown) => (v === null || v === undefined ? "—" : field.endsWith("Minor") ? fromMinor(Number(v)) : String(v));

/** E16 Maker/Checker queue: approve applies the change; the requester can never approve their own. */
export default function CorrectionsPage() {
  const { api } = useSession();
  const { t, locale } = useI18n();
  const K = t.m2.corr;
  const [tab, setTab] = useState<"pending" | "all">("pending");
  const list = useLoad(() => api.call("listCorrections", { query: tab === "pending" ? { status: "pending" } : {} }), [api, tab]);
  const [error, setError] = useState<string | null>(null);
  const decide = async (c: Correction, ok: boolean) => {
    setError(null);
    try {
      await api.call(ok ? "approveCorrection" : "rejectCorrection", { params: { id: c.id }, body: {} });
      await list.reload();
    } catch (e) { setError(apiErrorMessage(t, e)); }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={K.title} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "pending", label: K.pending }, { id: "all", label: t.docs.history }]} />
      {error && <Alert>{error}</Alert>}
      <Card className="p-0">
        {!list.data?.items.length ? <p className="p-6 text-muted">{K.empty}</p> : (
          <Table head={[K.requested, K.record, K.changes, K.reason, K.status, ""]}>
            {list.data.items.map((c) => (
              <tr key={c.id}>
                <Td>{fmtDateTime(c.requestedAt, locale)}</Td>
                <Td>{K.types[c.recordType]} <Badge tone={c.financial ? "warn" : "muted"}>{c.financial ? K.financial : K.nonFinancial}</Badge></Td>
                <Td className="whitespace-normal">
                  {Object.entries(c.changes).map(([f, ch]) => (
                    <div key={f} className="text-sm"><span className="text-muted">{(K.fields as Record<string, string>)[f] ?? f}:</span> <span className="line-through opacity-70">{fmt(f, ch.from)}</span> → <span className="font-semibold">{fmt(f, ch.to)}</span></div>
                  ))}
                </Td>
                <Td className="max-w-xs whitespace-normal">{c.reason}</Td>
                <Td><Badge tone={c.status === "applied" ? "ok" : c.status === "rejected" ? "bad" : "info"}>{K.statuses[c.status]}</Badge></Td>
                <Td>{c.canDecide && (
                  <div className="flex gap-1">
                    <Button variant="primary" className="min-h-8 px-3" onClick={() => decide(c, true)}>{K.approve}</Button>
                    <Button className="min-h-8 px-3" onClick={() => decide(c, false)}>{K.reject}</Button>
                  </div>
                )}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
