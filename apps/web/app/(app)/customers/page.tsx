"use client";
import { useState, type FormEvent } from "react";
import { ApiRequestError, type Customer } from "@fleet/contracts";
import { allows } from "@fleet/domain";
import { fieldError } from "@fleet/i18n";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Table, Td } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { apiErrorMessage } from "@/lib/errors";

const EMPTY = { name: "", contactName: "", phone: "", email: "", notes: "" };

/** Owner decision (14 Nov 2026): customers are data only; tasks link vehicles and drivers to them. */
export default function CustomersPage() {
  const { api, user } = useSession();
  const { t } = useI18n();
  const C = t.customers;
  const canWrite = allows(user, "customer.write").allowed;
  const list = useLoad(() => api.call("listCustomers"), [api]);
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const open = (c: Customer | "new") => {
    setEditing(c);
    setErrors({});
    setForm(c === "new" ? EMPTY : { name: c.name, contactName: c.contactName ?? "", phone: c.phone ?? "", email: c.email ?? "", notes: c.notes ?? "" });
  };
  async function run(fn: () => Promise<unknown>) {
    setMessage(null);
    setErrors({});
    try { await fn(); await list.reload(); return true; } catch (err) {
      if (err instanceof ApiRequestError) setErrors(err.fields);
      setMessage(apiErrorMessage(t, err));
      return false;
    }
  }
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body = { name: form.name, contactName: form.contactName || null, phone: form.phone || null, email: form.email || null, notes: form.notes || null };
    if (await run(() => (editing === "new" ? api.call("createCustomer", { body }) : api.call("updateCustomer", { params: { id: (editing as Customer).id }, body })))) setEditing(null);
  };

  return (
    <>
      <PageHeader title={C.title} action={canWrite && !editing && <Button variant="primary" onClick={() => open("new")}>+ {C.add}</Button>} />
      <p className="mb-4 text-sm text-muted">{C.intro}</p>
      {message && <div className="mb-4"><Alert>{message}</Alert></div>}
      {editing && (
        <Card className="mb-6">
          <form onSubmit={save} noValidate className="grid gap-4 sm:grid-cols-2">
            <Field label={C.name} error={fieldError(t, errors.name)}><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label={C.contactName}><Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></Field>
            <Field label={C.phone} error={fieldError(t, errors.phone)}><Input dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label={C.email} error={fieldError(t, errors.email)}><Input dir="ltr" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Field label={C.notes}><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field></div>
            <div className="flex gap-2 sm:col-span-2">
              <Button variant="primary" type="submit">{t.common.save}</Button>
              <Button type="button" onClick={() => setEditing(null)}>{t.common.cancel}</Button>
            </div>
          </form>
        </Card>
      )}
      <Card className="p-0">
        {!list.data ? <p className="p-6 text-muted">{t.common.loading}</p> : !list.data.items.length ? <p className="p-6 text-muted">{C.empty}</p> : (
          <Table head={[C.name, C.contactName, C.phone, C.status, ""]}>
            {list.data.items.map((c) => (
              <tr key={c.id} className={c.status === "inactive" ? "opacity-60" : ""}>
                <Td className="font-semibold">{c.name}</Td>
                <Td>{c.contactName ?? "—"}</Td>
                <Td><span dir="ltr">{c.phone ?? "—"}</span></Td>
                <Td><Badge tone={c.status === "active" ? "ok" : "muted"}>{c.status === "active" ? C.active : C.inactive}</Badge></Td>
                <Td>
                  {canWrite && (
                    <div className="flex gap-1">
                      <Button variant="ghost" className="min-h-8 px-2" onClick={() => open(c)}>{C.edit}</Button>
                      <Button variant="ghost" className="min-h-8 px-2" onClick={() => void run(() => api.call("updateCustomer", { params: { id: c.id }, body: { status: c.status === "active" ? "inactive" : "active" } }))}>
                        {c.status === "active" ? C.deactivate : C.activate}
                      </Button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
