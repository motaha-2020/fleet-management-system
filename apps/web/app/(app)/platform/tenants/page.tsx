"use client";
import { useEffect, useState, type FormEvent } from "react";
import { COUNTRY_TEMPLATES } from "@fleet/config";
import { ApiRequestError } from "@fleet/contracts";
import { fieldError } from "@fleet/i18n";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { apiErrorMessage } from "@/lib/errors";
import { MySupportGrants, SupportRequestButton } from "@/components/support-access";

export default function TenantsPage() {
  const { api } = useSession();
  const { t } = useI18n();
  const L = t.tenants;
  const tenants = useLoad(() => api.call("listTenants"), [api]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", countryCode: "EG", adminName: "", adminEmail: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [grantsKey, setGrantsKey] = useState(0);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Provisioning runs in the worker: poll while any tenant is still being created.
  const provisioning = tenants.data?.items.some((x) => x.status === "provisioning");
  useEffect(() => {
    if (!provisioning) return;
    const h = setInterval(() => void tenants.reload(), 2000);
    return () => clearInterval(h);
  }, [provisioning, tenants]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      const r = await api.call("createTenant", { body: form });
      setInvite(`${window.location.origin}/accept-invite?token=${encodeURIComponent(r.adminInviteToken)}`);
      setOpen(false);
      setForm({ name: "", slug: "", countryCode: "EG", adminName: "", adminEmail: "" });
      await tenants.reload();
    } catch (err) {
      if (err instanceof ApiRequestError) setErrors(err.fields);
      setMessage(apiErrorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  const tone = (s: string) => (s === "active" ? "ok" : s === "failed" ? "bad" : s === "provisioning" ? "info" : "warn") as "ok" | "bad" | "info" | "warn";

  return (
    <>
      <PageHeader title={L.title} action={!open && <Button variant="primary" onClick={() => setOpen(true)}>+ {L.add}</Button>} />
      {message && <div className="mb-4"><Alert>{message}</Alert></div>}
      {invite && (
        <Card className="mb-6 border-accent">
          <p className="mb-2 text-sm font-medium">{L.inviteLink}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code dir="ltr" className="min-w-0 flex-1 break-all rounded-lg bg-[#EEF1F4] px-3 py-2 text-xs">{invite}</code>
            <Button onClick={() => void navigator.clipboard?.writeText(invite)}>{t.common.copy}</Button>
            <Button variant="ghost" onClick={() => setInvite(null)}>{t.common.close}</Button>
          </div>
        </Card>
      )}
      {open && (
        <Card className="mb-6">
          <form onSubmit={submit} noValidate>
            <h2 className="mb-4 text-lg font-bold">{L.add}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={L.name} error={fieldError(t, errors.name)}><Input value={form.name} onChange={set("name")} required /></Field>
              <Field label={L.slug} error={fieldError(t, errors.slug)}><Input dir="ltr" value={form.slug} onChange={set("slug")} placeholder="acme-logistics" required /></Field>
              <Field label={L.country}><Select value={form.countryCode} onChange={set("countryCode")}>{Object.keys(COUNTRY_TEMPLATES).map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
              <Field label={L.adminName} error={fieldError(t, errors.adminName)}><Input value={form.adminName} onChange={set("adminName")} required /></Field>
              <Field label={L.adminEmail} error={fieldError(t, errors.adminEmail)}><Input dir="ltr" type="email" value={form.adminEmail} onChange={set("adminEmail")} required /></Field>
            </div>
            <div className="mt-5 flex gap-2">
              <Button variant="primary" type="submit" disabled={busy}>{busy ? t.common.loading : t.common.save}</Button>
              <Button type="button" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
            </div>
          </form>
        </Card>
      )}
      <Card className="p-0">
        {!tenants.data ? (
          <p className="p-6 text-muted">{t.common.loading}</p>
        ) : (
          <Table head={[L.name, "Slug", L.country, L.status, L.schema, ""]}>
            {tenants.data.items.map((x) => (
              <tr key={x.id}>
                <Td className="font-semibold">{x.name}</Td>
                <Td><span dir="ltr">{x.slug}</span></Td>
                <Td>{x.countryCode}</Td>
                <Td>
                  <Badge tone={tone(x.status)}>{L.statuses[x.status]}</Badge>
                  {x.failureReason && <div className="mt-1 max-w-xs whitespace-normal text-xs text-bad">{x.failureReason}</div>}
                </Td>
                <Td>{x.schemaVersion ?? "—"}</Td>
                <Td>
                  {(x.status === "active" || x.status === "suspended") && (
                    <Button variant="ghost" className="min-h-8 px-2" onClick={async () => {
                      setMessage(null);
                      try {
                        await api.call(x.status === "active" ? "suspendTenant" : "reactivateTenant", { params: { id: x.id } });
                        await tenants.reload();
                      } catch (err) { setMessage(apiErrorMessage(t, err)); }
                    }}>{x.status === "active" ? L.suspend : L.reactivate}</Button>
                  )}
                  {(x.status === "active" || x.status === "suspended") && <SupportRequestButton tenantId={x.id} onDone={() => setGrantsKey((k) => k + 1)} />}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <MySupportGrants key={grantsKey} />
    </>
  );
}
