"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { COUNTRY_TEMPLATES, EGYPT } from "@fleet/config";
import { authorize } from "@fleet/domain";
import { REPORT_IDS, type Report, type ReportId } from "@fleet/contracts";
import { Alert, Button, Card, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { useAction } from "@/components/m4-common";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { fmtDate, fmtDateTime, fmtMoney, saveDownload } from "@/lib/format";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const linkOf = (l: Report["links"][number]) => !l ? null : l.entityType === "vehicle" ? `/vehicles/${l.entityId}` : l.entityType === "driver" ? `/drivers/${l.entityId}`
  : l.entityType === "fine" ? "/fines" : l.entityType === "maintenance_visit" ? "/maintenance" : l.entityType === "fuel_entry" ? "/fuel" : null;

/** E18 standard reports (RPT-001..007): filters, totals, drill-down to the source, Excel/CSV export. */
function Reports() {
  const { api, user } = useSession();
  const { t, locale } = useI18n();
  const R = t.m5.reports;
  const params = useSearchParams();
  const now = new Date();
  const initial = (params.get("r") ?? "costs") as ReportId;
  const [q, setQ] = useState({ id: (REPORT_IDS as readonly string[]).includes(initial) ? initial : "costs", from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now), branchId: "", vehicleClass: "" });
  const [shown, setShown] = useState(q);
  const country = COUNTRY_TEMPLATES[user?.tenant?.countryCode ?? ""] ?? EGYPT;
  const can = (a: Parameters<typeof authorize>[1]) => !!user && authorize(user.role, a).allowed;
  const branches = useLoad(() => (can("branch.read") ? api.call("listBranches") : Promise.resolve({ items: [] })), [api, user]);
  const query = (s: typeof q) => ({ from: s.from, to: s.to, ...(s.branchId ? { branchId: s.branchId } : {}), ...(s.vehicleClass ? { vehicleClass: s.vehicleClass } : {}), locale });
  const report = useLoad(() => api.call("report", { params: { id: shown.id }, query: query(shown) }), [api, shown, locale]);
  const act = useAction();
  const fmt = (v: string | number | null | undefined, type: Report["columns"][number]["type"]) => {
    if (v == null || v === "") return "—";
    if (type === "money" && typeof v === "number") return fmtMoney(v, country.currency, locale);
    if (type === "number" && typeof v === "number") return v.toLocaleString(locale);
    if (type === "date" && typeof v === "string") return fmtDate(v, locale);
    if (type === "datetime" && typeof v === "string") return fmtDateTime(v, locale);
    return String(v);
  };
  const exportAs = (format: "csv" | "xlsx") => act.run(async () => {
    const res = await api.download("exportReport", { id: shown.id }, { ...query(shown), format } as Record<string, string>);
    await saveDownload(res, `${shown.id}_${shown.from}_${shown.to}.${format}`);
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={R.title} />
      <Card>
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6" onSubmit={(e) => { e.preventDefault(); setShown(q); }}>
          <Field label={R.report}>
            <Select value={q.id} onChange={(e) => setQ({ ...q, id: e.target.value as ReportId })}>
              {REPORT_IDS.map((id) => <option key={id} value={id}>{R.names[id]}</option>)}
            </Select>
          </Field>
          <Field label={t.m5.dash.from}><Input type="date" value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value })} /></Field>
          <Field label={t.m5.dash.to}><Input type="date" value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value })} /></Field>
          <Field label={t.m5.dash.branch}>
            <Select value={q.branchId} onChange={(e) => setQ({ ...q, branchId: e.target.value })}>
              <option value="">{t.m5.dash.allBranches}</option>
              {branches.data?.items.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
          <Field label={R.vehicleClass}>
            <Select value={q.vehicleClass} onChange={(e) => setQ({ ...q, vehicleClass: e.target.value })}>
              <option value="">—</option>
              {country.licenseCategories.map((c) => <option key={c.code} value={c.code}>{c.name[locale]}</option>)}
            </Select>
          </Field>
          <div className="flex items-end"><Button variant="primary" type="submit">{R.run}</Button></div>
        </form>
      </Card>
      {act.error && <Alert>{act.error}</Alert>}
      {report.error ? <Alert>{String((report.error as Error).message)}</Alert> : null}
      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div>
            <h2 className="font-bold">{R.names[shown.id]}</h2>
            {report.data && <p className="text-xs text-muted">{R.rows}: {report.data.rows.length.toLocaleString(locale)}</p>}
          </div>
          {can("report.export") && (
            <div className="flex gap-2">
              <Button disabled={act.busy || !report.data?.rows.length} onClick={() => void exportAs("xlsx")}>{R.xlsx}</Button>
              <Button disabled={act.busy || !report.data?.rows.length} onClick={() => void exportAs("csv")}>{R.csv}</Button>
            </div>
          )}
        </div>
        {!report.data ? <p className="p-5 text-muted">{t.common.loading}</p> : !report.data.rows.length ? <p className="p-5 text-muted">{R.empty}</p> : (
          <Table head={report.data.columns.map((c) => c.label)}>
            {report.data.rows.slice(0, 500).map((row, i) => {
              const href = linkOf(report.data!.links[i] ?? null);
              return (
                <tr key={i}>
                  {report.data!.columns.map((c, j) => (
                    <Td key={c.key} className={c.type === "money" || c.type === "number" ? "tabular-nums" : "whitespace-normal"}>
                      {j === 0 && href ? <Link className="text-accent hover:underline" href={href}>{fmt(row[c.key], c.type)}</Link> : fmt(row[c.key], c.type)}
                    </Td>
                  ))}
                </tr>
              );
            })}
            {Object.keys(report.data.totals).length > 0 && (
              <tr className="bg-[#F5F7FA] font-bold">
                {report.data.columns.map((c, j) => <Td key={c.key}>{j === 0 ? R.total : report.data!.totals[c.key] != null ? fmt(report.data!.totals[c.key]!, c.type) : ""}</Td>)}
              </tr>
            )}
          </Table>
        )}
      </Card>
    </div>
  );
}

export default function ReportsPage() {
  return <Suspense><Reports /></Suspense>;
}
