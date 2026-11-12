"use client";
import { useState } from "react";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Table, Td } from "@/components/ui";
import { inDays, useAction } from "@/components/m4-common";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { fmtDate, fmtDateTime } from "@/lib/format";

/** GEN-007 / US-E03-03: company thresholds with Effective From; history is kept and never re-judged unless explicitly retroactive. */
export default function PoliciesPage() {
  const { api } = useSession();
  const { t, locale } = useI18n();
  const P = t.m6.policies;
  const list = useLoad(() => api.call("listPolicies"), [api]);
  const [open, setOpen] = useState<string | null>(null);
  const [f, setF] = useState({ value: "", effectiveFrom: inDays(0), reason: "", retroactive: false });
  const [msg, setMsg] = useState<string | null>(null);
  const act = useAction();
  const unit = (u: string) => P.units[u] ?? u;
  const past = f.effectiveFrom < inDays(0);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={P.title} />
      <p className="max-w-3xl text-sm text-muted">{P.help}</p>
      {msg && <Alert tone="ok">{msg}</Alert>}
      {act.error && <Alert>{act.error}</Alert>}
      {list.data?.items.map((p) => (
        <Card key={p.key} className="p-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
            <h2 className="font-bold">{p.name[locale]}</h2>
            <Badge tone="info">{P.current}: {p.current} {unit(p.unit)}</Badge>
            {p.current === p.default && <span className="text-xs text-muted">{P.isDefault}</span>}
            {p.next && <Badge tone="warn">{P.next}: {p.next.value} {unit(p.unit)} · {fmtDate(p.next.effectiveFrom, locale)}</Badge>}
            {open !== p.key && <Button className="ms-auto min-h-8 px-3" onClick={() => { setOpen(p.key); setF({ value: String(p.current), effectiveFrom: inDays(0), reason: "", retroactive: false }); setMsg(null); }}>{P.change}</Button>}
          </div>
          {open === p.key && (
            <form className="grid gap-4 border-b border-line p-5 sm:grid-cols-2 lg:grid-cols-4" onSubmit={async (e) => {
              e.preventDefault();
              let r: { recalculated: number } | null = null;
              const ok = await act.run(async () => {
                r = await api.call("setPolicy", { params: { key: p.key }, body: { value: Number(f.value), effectiveFrom: f.effectiveFrom, reason: f.reason, retroactive: past && f.retroactive } });
              });
              if (ok) {
                setOpen(null);
                setMsg(r && (r as { recalculated: number }).recalculated ? `${P.saved} · ${P.recalculated}: ${(r as { recalculated: number }).recalculated}` : P.saved);
                await list.reload();
              }
            }}>
              <Field label={`${P.value} (${p.min}–${p.max} ${unit(p.unit)})`} error={act.fe("value")}><Input inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} required /></Field>
              <Field label={P.effectiveFrom} error={act.fe("effectiveFrom")}><Input type="date" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} required /></Field>
              <Field label={P.reason}><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required minLength={3} /></Field>
              <div className="flex items-end gap-2">
                <Button variant="primary" type="submit" disabled={act.busy || (past && !f.retroactive)}>{t.common.save}</Button>
                <Button type="button" onClick={() => setOpen(null)}>{t.common.cancel}</Button>
              </div>
              {past && (
                <label className="flex items-start gap-2 rounded-lg bg-warn-bg p-3 text-sm text-warn sm:col-span-2 lg:col-span-4">
                  <input type="checkbox" className="mt-1" checked={f.retroactive} onChange={(e) => setF({ ...f, retroactive: e.target.checked })} />
                  <span>{P.retroWarning}</span>
                </label>
              )}
            </form>
          )}
          {p.versions.length > 0 && (
            <Table head={[P.effectiveFrom, P.value, P.reason, P.recalculated, P.recordedAt]}>
              {p.versions.map((v) => (
                <tr key={v.id}>
                  <Td>{fmtDate(v.effectiveFrom, locale)}{v.retroactive && <> <Badge tone="warn">{P.retro}</Badge></>}</Td>
                  <Td>{v.value} {unit(p.unit)}</Td>
                  <Td className="max-w-md whitespace-normal">{v.reason}</Td>
                  <Td>{v.retroactive ? v.recalculated : "—"}</Td>
                  <Td>{fmtDateTime(v.createdAt, locale)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      ))}
    </div>
  );
}
