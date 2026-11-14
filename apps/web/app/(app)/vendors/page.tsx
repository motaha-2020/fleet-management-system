"use client";
import { useMemo, useState, type FormEvent } from "react";
import { ApiRequestError, VENDOR_TYPES } from "@fleet/contracts";
import { allows } from "@fleet/domain";
import { fieldError } from "@fleet/i18n";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { apiErrorMessage } from "@/lib/errors";
import { newId } from "@/lib/ids";

const EMPTY = { name: "", type: "workshop" as (typeof VENDOR_TYPES)[number], contactName: "", phone: "", email: "", taxId: "", branchIds: [] as string[] };

export default function VendorsPage() {
  const { api, user } = useSession();
  const { t } = useI18n();
  const V = t.vendors;
  const canWrite = !!user && allows(user, "vendor.write").allowed;
  const [showInactive, setShowInactive] = useState(false);
  const vendors = useLoad(() => api.call("listVendors", { query: { includeInactive: showInactive ? "true" : "false" } }), [api, showInactive]);
  const branches = useLoad(() => api.call("listBranches"), [api]);
  const branchName = useMemo(() => new Map(branches.data?.items.map((b) => [b.id, b.name]) ?? []), [branches.data]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setMessage(null);
    setErrors({});
    try { await fn(); await vendors.reload(); return true; } catch (err) {
      if (err instanceof ApiRequestError) setErrors(err.fields);
      setMessage(apiErrorMessage(t, err));
      return false;
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = { id: newId(), name: form.name, type: form.type, contactName: form.contactName || null, phone: form.phone || null, email: form.email || null, taxId: form.taxId || null, branchIds: form.branchIds };
    if (await run(() => api.call("createVendor", { body }))) { setOpen(false); setForm(EMPTY); }
  }

  return (
    <>
      <PageHeader title={V.title} action={
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> {V.showInactive}</label>
          {canWrite && !open && <Button variant="primary" onClick={() => setOpen(true)}>+ {V.add}</Button>}
        </div>
      } />
      {message && <div className="mb-4"><Alert>{message}</Alert></div>}
      {open && (
        <Card className="mb-6">
          <form onSubmit={submit} noValidate>
            <h2 className="mb-4 text-lg font-bold">{V.add}</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={V.name} error={fieldError(t, errors.name)}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
              <Field label={V.type}><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as (typeof VENDOR_TYPES)[number] })}>{VENDOR_TYPES.map((x) => <option key={x} value={x}>{V.types[x]}</option>)}</Select></Field>
              <Field label={`${V.contactName} (${t.common.optional})`}><Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></Field>
              <Field label={`${V.phone} (${t.common.optional})`}><Input dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
              <Field label={`${V.email} (${t.common.optional})`} error={fieldError(t, errors.email)}><Input dir="ltr" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
              <Field label={`${V.taxId} (${t.common.optional})`}><Input dir="ltr" value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} /></Field>
              <fieldset className="sm:col-span-3">
                <legend className="mb-1.5 text-sm font-medium">{V.coverage} <span className="text-muted">({V.allBranches} = {t.common.none})</span></legend>
                <div className="flex flex-wrap gap-3">
                  {(branches.data?.items ?? []).map((b) => (
                    <label key={b.id} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={form.branchIds.includes(b.id)} onChange={(e) => setForm({ ...form, branchIds: e.target.checked ? [...form.branchIds, b.id] : form.branchIds.filter((x) => x !== b.id) })} />{b.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            <div className="mt-5 flex gap-2">
              <Button variant="primary" type="submit">{t.common.save}</Button>
              <Button type="button" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
            </div>
          </form>
        </Card>
      )}
      <Card className="p-0">
        {!vendors.data ? <p className="p-6 text-muted">{t.common.loading}</p> : (
          <Table head={[V.name, V.type, V.phone, V.coverage, V.status, ""]}>
            {vendors.data.items.map((v) => (
              <tr key={v.id} className={v.status === "inactive" ? "opacity-60" : ""}>
                <Td className="font-semibold">{v.name}</Td>
                <Td>{V.types[v.type]}</Td>
                <Td><span dir="ltr">{v.phone ?? "—"}</span></Td>
                <Td>{v.branchIds.length ? v.branchIds.map((b) => branchName.get(b) ?? "—").join("، ") : V.allBranches}</Td>
                <Td><Badge tone={v.status === "active" ? "ok" : "muted"}>{v.status === "active" ? t.branches.active : t.branches.inactive}</Badge></Td>
                <Td>{canWrite && <Button variant="ghost" className="min-h-8 px-2" onClick={() => run(() => api.call("updateVendor", { params: { id: v.id }, body: { status: v.status === "active" ? "inactive" : "active" } }))}>{v.status === "active" ? V.deactivate : V.activate}</Button>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
