"use client";
import { useEffect, useState } from "react";
import type { ApprovalItem } from "@fleet/contracts";
import { allows } from "@fleet/domain";
import { Alert, Badge, Button, Card, Input, PageHeader, Select } from "@/components/ui";
import { osmLink } from "@/components/fuel-map";
import { fromMinor } from "@/components/m2-common";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { apiErrorMessage } from "@/lib/errors";
import { fmtDateTime } from "@/lib/format";

const TYPES = ["odometer", "fuel", "cost", "maintenance"] as const;

/** The meter photo or fuel receipt, fetched with the session (files are never public). */
function Photo({ item }: { item: ApprovalItem }) {
  const { api } = useSession();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    const route = item.photo === "odometer" ? "downloadOdometerPhoto" : "downloadFuelReceipt";
    void api.download(route, { id: item.id }).then(async (r) => { u = URL.createObjectURL(await r.blob()); setUrl(u); }).catch(() => setUrl(null));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [api, item.id, item.photo]);
  if (!url) return <div className="h-28 w-36 animate-pulse rounded-lg bg-[#EEF2F6]" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <a href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt="" className="h-28 w-36 rounded-lg object-cover" /></a>;
}

/**
 * Owner decision (14 Nov 2026): readings, fuel, invoices and maintenance count only after approval. One inbox with
 * the photo and the place; approve, or reject with a reason (the driver is told). Office staff's records are
 * approved by the company admin.
 */
export default function ApprovalsPage() {
  const { api, user } = useSession();
  const { t, locale } = useI18n();
  const A = t.approvals;
  const [type, setType] = useState<"" | (typeof TYPES)[number]>("");
  const list = useLoad(() => api.call("listApprovals", { query: type ? { type } : {} }), [api, type]);
  const canConfigure = allows(user, "policy.manage").allowed;
  const settings = useLoad(() => (canConfigure ? api.call("getApprovalSettings") : Promise.resolve({ items: [] })), [api, canConfigure]);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      await list.reload();
      if (ok) setMessage({ tone: "ok", text: ok });
    } catch (err) {
      setMessage({ tone: "bad", text: apiErrorMessage(t, err) });
    } finally {
      setBusy(false);
    }
  }

  const items = list.data?.items ?? [];
  const mine = items.filter((i) => i.canDecide);
  const approveAll = () => run(async () => {
    for (const i of mine) await api.call("approveItem", { params: { type: i.type, id: i.id } });
  }, A.approvedAll.replace("{n}", String(mine.length)));

  const what = (i: ApprovalItem) => {
    const money = i.amountMinor != null ? `${fromMinor(i.amountMinor)} ${i.currency ?? ""}` : null;
    switch (i.type) {
      case "odometer": return `${A.reading}: ${i.odometer?.toLocaleString("en")}`;
      case "fuel": return [`${i.quantity} ${i.unit === "m3" ? "m³" : "L"}`, money, i.odometer != null ? `${A.reading}: ${i.odometer.toLocaleString("en")}` : null].filter(Boolean).join(" · ");
      case "cost": return [(t.m2.costs.categories as Record<string, string>)[i.category ?? ""] ?? i.category, money, i.description].filter(Boolean).join(" · ");
      case "maintenance": return [(t.m2.costs.categories as Record<string, string>)[i.category ?? ""] ?? i.category, money, i.odometer != null ? `${A.reading}: ${i.odometer.toLocaleString("en")}` : null].filter(Boolean).join(" · ");
    }
  };

  return (
    <>
      <PageHeader title={A.title} action={mine.length > 1 && <Button variant="primary" disabled={busy} onClick={() => void approveAll()}>{A.approveAll.replace("{n}", String(mine.length))}</Button>} />
      <p className="mb-4 text-sm text-muted">{A.intro}</p>
      {message && <div className="mb-4"><Alert tone={message.tone}>{message.text}</Alert></div>}
      <div className="mb-4 flex flex-wrap gap-2">
        {(["", ...TYPES] as const).map((k) => (
          <Button key={k || "all"} variant={type === k ? "primary" : "ghost"} className="min-h-8 px-3" onClick={() => setType(k)}>
            {k ? A.types[k] : A.all}
          </Button>
        ))}
      </div>
      {!list.data ? <p className="text-muted">{t.common.loading}</p> : !items.length ? <Card><p className="text-muted">{A.empty}</p></Card> : (
        <div className="flex flex-col gap-3">
          {items.map((i) => (
            <Card key={`${i.type}:${i.id}`} className="flex flex-wrap items-start gap-4">
              {i.photo && <Photo item={i} />}
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge tone="info">{A.types[i.type]}</Badge>
                  <span className="font-semibold">{i.vehicleLabel ?? "—"}</span>
                  <span className="text-sm text-muted">{fmtDateTime(i.at, locale)}</span>
                </div>
                <p className="text-sm">{what(i)}</p>
                <p className="mt-1 text-xs text-muted">
                  {A.by}: {i.createdByName ?? "—"} {i.byDriver ? `(${t.roles.driver})` : ""}
                  {i.location && <> · <a className="font-semibold text-accent hover:underline" href={osmLink(i.location.lat, i.location.lng)} target="_blank" rel="noopener noreferrer">{A.place}</a></>}
                </p>
                {i.flags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {i.flags.map((f) => <Badge key={f} tone="warn">{(t.m2.fuel.flagNames as Record<string, string>)[f] ?? (A.flags as Record<string, string>)[f] ?? f}</Badge>)}
                  </div>
                )}
                {!i.canDecide && <p className="mt-2 text-xs text-muted">{i.byDriver ? A.notYours : A.adminOnly}</p>}
              </div>
              {i.canDecide && (
                <div className="flex flex-col items-stretch gap-2">
                  <Button variant="primary" disabled={busy} onClick={() => void run(() => api.call("approveItem", { params: { type: i.type, id: i.id } }), A.approved)}>{A.approve}</Button>
                  {rejecting === i.id ? (
                    <form className="flex flex-col gap-1" onSubmit={(e) => { e.preventDefault(); void run(() => api.call("rejectItem", { params: { type: i.type, id: i.id }, body: { reason } }), A.rejected).then(() => { setRejecting(null); setReason(""); }); }}>
                      <Input aria-label={A.reason} placeholder={A.reason} value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-8 w-48" autoFocus />
                      <Button type="submit" className="min-h-8" disabled={busy || reason.trim().length < 3}>{A.confirmReject}</Button>
                    </form>
                  ) : <Button variant="ghost" onClick={() => { setRejecting(i.id); setReason(""); }}>{A.reject}</Button>}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      {canConfigure && settings.data && settings.data.items.length > 0 && (
        <Card className="mt-8">
          <h2 className="mb-1 text-lg font-bold">{A.settings}</h2>
          <p className="mb-4 text-sm text-muted">{A.settingsHelp}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {settings.data.items.map((s) => (
              <label key={s.type} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-sm">
                {A.types[s.type]}
                <Select className="min-h-8 w-auto py-1" value={s.mode} onChange={(e) => void run(async () => {
                  await api.call("setApprovalSetting", { body: { type: s.type, mode: e.target.value as "manual" | "auto" } });
                  await settings.reload();
                }, A.settingSaved)}>
                  <option value="manual">{A.manual}</option>
                  <option value="auto">{A.auto}</option>
                </Select>
              </label>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
