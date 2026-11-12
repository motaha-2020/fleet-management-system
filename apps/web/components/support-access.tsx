"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Card, Input, Table, Td } from "./ui";
import { useAction } from "./m4-common";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { fmtDateTime } from "@/lib/format";

const tone = { requested: "warn", approved: "ok", rejected: "muted", revoked: "muted", expired: "muted" } as const;

/** Company admin: decide support access requests (SEC-007) — approve for 24 h read-only, reject, or end it. */
export function SupportRequests() {
  const { api } = useSession();
  const { t, locale } = useI18n();
  const S = t.m6.support;
  const list = useLoad(() => api.call("supportGrants"), [api]);
  const act = useAction();
  const go = async (fn: () => Promise<unknown>) => { if (await act.run(fn)) await list.reload(); };
  if (!list.data?.items.length) return null;
  return (
    <Card className="p-0">
      <div className="border-b border-line px-5 py-3">
        <h2 className="font-bold">{S.title}</h2>
        <p className="text-xs text-muted">{S.help}</p>
      </div>
      {act.error && <div className="p-4"><Alert>{act.error}</Alert></div>}
      <Table head={[S.requestedBy, S.reason, S.status, ""]}>
        {list.data.items.map((g) => (
          <tr key={g.id} className="align-top">
            <Td>{g.requestedByName}<div className="text-xs text-muted">{fmtDateTime(g.createdAt, locale)}</div></Td>
            <Td className="max-w-md whitespace-normal">{g.reason}</Td>
            <Td><Badge tone={tone[g.status]}>{S.statuses[g.status]}</Badge>{g.expiresAt && g.status === "approved" && <div className="text-xs text-muted">{S.until} {fmtDateTime(g.expiresAt, locale)}</div>}</Td>
            <Td>
              <div className="flex flex-wrap gap-1">
                {g.status === "requested" && <>
                  <Button variant="primary" className="min-h-8 px-3" disabled={act.busy} onClick={() => void go(() => api.call("decideSupportAccess", { params: { id: g.id }, body: { approve: true } }))}>{S.approve}</Button>
                  <Button className="min-h-8 px-3" disabled={act.busy} onClick={() => void go(() => api.call("decideSupportAccess", { params: { id: g.id }, body: { approve: false } }))}>{S.reject}</Button>
                </>}
                {(g.status === "approved" || g.status === "requested") && <Button variant="ghost" className="min-h-8 px-3 text-bad" disabled={act.busy} onClick={() => void go(() => api.call("revokeSupportAccess", { params: { id: g.id } }))}>{S.revoke}</Button>}
              </div>
            </Td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

/** Platform admin: ask a company for access, and open a read-only session once approved. */
export function SupportRequestButton({ tenantId, onDone }: { tenantId: string; onDone: () => void }) {
  const { api } = useSession();
  const { t } = useI18n();
  const S = t.m6.support;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const act = useAction();
  if (!open) return <Button variant="ghost" className="min-h-8 px-2" onClick={() => setOpen(true)}>{S.request}</Button>;
  return (
    <form className="flex min-w-[16rem] flex-col gap-2" onSubmit={async (e) => {
      e.preventDefault();
      if (await act.run(() => api.call("requestSupportAccess", { params: { id: tenantId }, body: { reason } }))) { setOpen(false); setReason(""); onDone(); }
    }}>
      <Input aria-label={S.reason} placeholder={S.reasonHint} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={10} />
      {act.error && <span className="text-xs text-bad">{act.error}</span>}
      <div className="flex gap-1">
        <Button variant="primary" type="submit" className="min-h-8 px-3" disabled={act.busy}>{S.send}</Button>
        <Button type="button" variant="ghost" className="min-h-8 px-3" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
      </div>
    </form>
  );
}

export function MySupportGrants() {
  const { api, signIn } = useSession();
  const { t, locale } = useI18n();
  const S = t.m6.support;
  const router = useRouter();
  const list = useLoad(() => api.call("platformSupportGrants"), [api]);
  const act = useAction();
  if (!list.data?.items.length) return null;
  return (
    <Card className="p-0">
      <h2 className="border-b border-line px-5 py-3 font-bold">{S.mine}</h2>
      {act.error && <div className="p-4"><Alert>{act.error}</Alert></div>}
      <Table head={[S.company, S.reason, S.status, ""]}>
        {list.data.items.map((g) => (
          <tr key={g.id}>
            <Td>{g.tenantName}</Td>
            <Td className="max-w-md whitespace-normal">{g.reason}</Td>
            <Td><Badge tone={tone[g.status]}>{S.statuses[g.status]}</Badge>{g.expiresAt && g.status === "approved" && <div className="text-xs text-muted">{S.until} {fmtDateTime(g.expiresAt, locale)}</div>}</Td>
            <Td>{g.status === "approved" && (
              <Button variant="primary" className="min-h-8 px-3" disabled={act.busy} onClick={() => void act.run(async () => {
                signIn(await api.call("openSupportSession", { params: { id: g.id } }));
                router.replace("/dashboard");
              })}>{S.open}</Button>
            )}</Td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

/** Shown on every page during a support session. Leaving = reload, which restores the platform session. */
export function SupportBanner() {
  const { user } = useSession();
  const { t, locale } = useI18n();
  if (!user?.support) return null;
  return (
    <div className="bg-warn-bg px-4 py-2 text-center text-sm font-semibold text-warn" role="status">
      {t.m6.support.banner} {fmtDateTime(user.support.expiresAt, locale)} ·{" "}
      <button type="button" className="underline" onClick={() => { window.location.href = "/platform/tenants"; }}>{t.m6.support.exit}</button>
    </div>
  );
}
