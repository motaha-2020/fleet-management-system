"use client";
import { useState } from "react";
import { allows } from "@fleet/domain";
import { Alert, Badge, Button, Card, PageHeader, Table, Td } from "@/components/ui";
import { Tabs } from "@/components/m2-common";
import { useAction } from "@/components/m4-common";
import { AlertList } from "@/components/m5-alerts";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { fmtDateTime } from "@/lib/format";

/** E13: alerts in scope, their lifecycle, an on-demand scan, and the delivery log (NTF-003). */
export default function AlertsPage() {
  const { api, user } = useSession();
  const { t, locale } = useI18n();
  const A = t.m5.alerts;
  const can = (a: Parameters<typeof allows>[1]) => !!user && allows(user, a).allowed;
  const [tab, setTab] = useState<"active" | "mine" | "all" | "deliveries">("active");
  const list = useLoad(() => (tab === "deliveries" ? Promise.resolve({ items: [] }) : api.call("listAlerts", { query: tab === "mine" ? { mine: "true" } : { status: tab === "all" ? "all" : "active" } })), [api, tab]);
  const log = useLoad(() => (tab === "deliveries" ? api.call("listNotifications", { query: {} }) : Promise.resolve({ items: [] })), [api, tab]);
  const [msg, setMsg] = useState<string | null>(null);
  const act = useAction();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={A.title} action={can("alert.manage") ? (
        <Button variant="primary" disabled={act.busy} onClick={async () => {
          setMsg(null);
          await act.run(async () => {
            const r = await api.call("scanAlerts");
            setMsg(`${A.scanned}: +${r.created} · ↑${r.escalated} · ✓${r.resolved}`);
            await list.reload();
          });
        }}>{A.scan}</Button>
      ) : undefined} />
      {msg && <Alert tone="ok">{msg}</Alert>}
      {act.error && <Alert>{act.error}</Alert>}
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "active", label: A.active }, { id: "mine", label: A.mine }, { id: "all", label: A.all },
        ...(can("notification.read") ? [{ id: "deliveries" as const, label: A.deliveries }] : []),
      ]} />
      <Card className="p-0">
        {tab !== "deliveries" ? <AlertList items={list.data?.items ?? []} onChange={() => void list.reload()} /> : !log.data?.items.length ? <p className="p-5 text-muted">{A.empty}</p> : (
          <Table head={[A.created, A.channel, A.to, t.m4.readiness.rule, t.m4.maintenance.status, A.attempts, A.error]}>
            {log.data.items.map((n) => (
              <tr key={n.id}>
                <Td>{fmtDateTime(n.createdAt, locale)}</Td>
                <Td>{n.channel}{n.provider ? ` · ${n.provider}` : ""}</Td>
                <Td>{n.address ?? "—"}</Td>
                <Td className="max-w-sm whitespace-normal">{n.subject}</Td>
                <Td><Badge tone={n.status === "sent" ? "ok" : n.status === "failed" ? "bad" : "muted"}>{A.dStatuses[n.status]}</Badge></Td>
                <Td>{n.attempts}</Td>
                <Td className="max-w-xs whitespace-normal text-xs text-bad">{n.lastError ?? ""}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
