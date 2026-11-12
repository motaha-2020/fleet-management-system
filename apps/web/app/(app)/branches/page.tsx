"use client";
import { useState, type FormEvent } from "react";
import { ApiRequestError } from "@fleet/contracts";
import { fieldError } from "@fleet/i18n";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Table, Td } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { apiErrorMessage } from "@/lib/errors";
import { newId } from "@/lib/ids";

export default function BranchesPage() {
  const { api } = useSession();
  const { t } = useI18n();
  const B = t.branches;
  const branches = useLoad(() => api.call("listBranches"), [api]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", timezone: "Africa/Cairo", weekendDays: [5] as number[] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setMessage(null);
    setErrors({});
    try { await fn(); await branches.reload(); return true; } catch (err) {
      if (err instanceof ApiRequestError) setErrors(err.fields);
      setMessage(apiErrorMessage(t, err));
      return false;
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await run(() => api.call("createBranch", { body: { id: newId(), ...form } }))) {
      setOpen(false);
      setForm({ code: "", name: "", timezone: "Africa/Cairo", weekendDays: [5] });
    }
  }

  return (
    <>
      <PageHeader title={B.title} action={!open && <Button variant="primary" onClick={() => setOpen(true)}>+ {B.add}</Button>} />
      {message && <div className="mb-4"><Alert>{message}</Alert></div>}
      {open && (
        <Card className="mb-6">
          <form onSubmit={submit} noValidate>
            <h2 className="mb-4 text-lg font-bold">{B.add}</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={B.code} error={fieldError(t, errors.code)}><Input dir="ltr" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="ALX" required /></Field>
              <Field label={B.name} error={fieldError(t, errors.name)}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
              <Field label={B.timezone} error={fieldError(t, errors.timezone)}><Input dir="ltr" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} /></Field>
              <fieldset className="sm:col-span-3">
                <legend className="mb-1.5 text-sm font-medium">{B.weekend}</legend>
                <div className="flex flex-wrap gap-3">
                  {t.days.map((d, i) => (
                    <label key={i} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={form.weekendDays.includes(i)} onChange={(e) => setForm({ ...form, weekendDays: e.target.checked ? [...form.weekendDays, i] : form.weekendDays.filter((x) => x !== i) })} />
                      {d}
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
        {!branches.data ? <p className="p-6 text-muted">{t.common.loading}</p> : (
          <Table head={[B.code, B.name, B.timezone, B.weekend, B.status, ""]}>
            {branches.data.items.map((b) => (
              <tr key={b.id}>
                <Td className="font-semibold"><span dir="ltr">{b.code}</span></Td>
                <Td>{b.name}</Td>
                <Td><span dir="ltr">{b.timezone}</span></Td>
                <Td>{b.weekendDays.map((d) => t.days[d]).join("، ")}</Td>
                <Td><Badge tone={b.status === "active" ? "ok" : "muted"}>{b.status === "active" ? B.active : B.inactive}</Badge></Td>
                <Td><Button variant="ghost" className="min-h-8 px-2" onClick={() => run(() => api.call("updateBranch", { params: { id: b.id }, body: { status: b.status === "active" ? "inactive" : "active" } }))}>{b.status === "active" ? B.deactivate : B.activate}</Button></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
