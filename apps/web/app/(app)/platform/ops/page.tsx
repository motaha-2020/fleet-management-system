"use client";
import { useState } from "react";
import { Badge, Card, PageHeader, Select, Table, Td } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { fmtDateTime } from "@/lib/format";

const sevTone = { info: "info", warning: "warn", error: "bad", critical: "bad" } as const;
const KINDS = ["sync", "notification", "import", "job", "api_error", "backup", "security"] as const;

/** NFR-008 / US-E19-02: operational failures by company, refreshed every 30 s. */
export default function OpsPage() {
  const { api } = useSession();
  const { t, locale } = useI18n();
  const O = t.m6.ops;
  const [kind, setKind] = useState<"" | (typeof KINDS)[number]>("");
  const [minutes, setMinutes] = useState(60);
  const summary = useLoad(() => api.call("opsSummary", { query: { sinceMinutes: minutes } }), [api, minutes]);
  const events = useLoad(() => api.call("opsEvents", { query: { sinceMinutes: minutes, ...(kind ? { kind } : {}) } }), [api, minutes, kind]);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={O.title} />
      <div className="flex flex-wrap gap-3">
        <Select aria-label={O.window} className="w-48" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
          {[15, 60, 24 * 60, 7 * 24 * 60].map((m) => <option key={m} value={m}>{O.windows[String(m)]}</option>)}
        </Select>
        <Select aria-label={O.kind} className="w-48" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="">{O.allKinds}</option>
          {KINDS.map((k) => <option key={k} value={k}>{O.kinds[k]}</option>)}
        </Select>
      </div>
      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
          <h2 className="font-bold">{O.byCompany}</h2>
          <span className="text-sm text-muted">{O.lastBackup}: {summary.data?.lastBackup ? `${fmtDateTime(summary.data.lastBackup.at, locale)} · ${summary.data.lastBackup.code}` : O.never}</span>
        </div>
        {!summary.data?.rows.length ? <p className="p-5 text-ok">{O.none}</p> : (
          <Table head={[O.company, O.kind, O.errors, O.warnings, O.last]}>
            {summary.data.rows.map((r) => (
              <tr key={`${r.tenantId}-${r.kind}`}>
                <Td>{r.tenantName ?? O.platform}</Td><Td>{O.kinds[r.kind]}</Td>
                <Td>{r.errors ? <Badge tone="bad">{r.errors}</Badge> : 0}</Td><Td>{r.warnings ? <Badge tone="warn">{r.warnings}</Badge> : 0}</Td>
                <Td>{fmtDateTime(r.lastAt, locale)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card className="p-0">
        <h2 className="border-b border-line px-5 py-3 font-bold">{O.events}</h2>
        {!events.data?.items.length ? <p className="p-5 text-muted">{O.none}</p> : (
          <Table head={[O.last, O.company, O.kind, O.severity, O.code]}>
            {events.data.items.map((e) => (
              <tr key={e.id} className="align-top">
                <Td>{fmtDateTime(e.at, locale)}</Td><Td>{e.tenantName ?? O.platform}</Td><Td>{O.kinds[e.kind]}</Td>
                <Td><Badge tone={sevTone[e.severity]}>{e.severity}</Badge></Td>
                <Td className="max-w-md whitespace-normal"><span className="font-mono text-sm">{e.code}</span><div className="text-xs text-muted" dir="ltr">{JSON.stringify(e.detail).slice(0, 200)}</div></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
