"use client";
import { useMemo, useState, type FormEvent } from "react";
import { ApiRequestError } from "@fleet/contracts";
import { authorize } from "@fleet/domain";
import { fieldError } from "@fleet/i18n";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { apiErrorMessage } from "@/lib/errors";
import { newId } from "@/lib/ids";

export default function DriversPage() {
  const { api, user } = useSession();
  const { t, locale } = useI18n();
  const L = t.drivers;
  const canWrite = !!user && authorize(user.role, "driver.write").allowed;
  const canIssue = !!user && authorize(user.role, "driver.issue_activation").allowed;

  const drivers = useLoad(() => api.call("listDrivers"), [api]);
  const branches = useLoad(() => (user && authorize(user.role, "branch.read").allowed ? api.call("listBranches") : Promise.resolve({ items: [] })), [api, user]);
  const branchName = useMemo(() => new Map(branches.data?.items.map((b) => [b.id, b.name]) ?? []), [branches.data]);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ fullName: "", username: "", phone: "", branchId: "" });
  const [pendingId, setPendingId] = useState(newId);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<{ name: string; username: string; code: string; expiresAt: string } | null>(null);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      await api.call("createDriver", { body: { id: pendingId, fullName: form.fullName, username: form.username, phone: form.phone || null, branchId: form.branchId || branches.data?.items[0]?.id || "" } });
      setForm({ fullName: "", username: "", phone: "", branchId: "" });
      setPendingId(newId());
      setOpen(false);
      await drivers.reload();
    } catch (err) {
      if (err instanceof ApiRequestError) setErrors(err.fields);
      setMessage(apiErrorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  async function issue(id: string, name: string) {
    setMessage(null);
    try {
      const r = await api.call("issueActivationCode", { params: { id } });
      setCode({ name, ...r });
      await drivers.reload();
    } catch (err) {
      setMessage(apiErrorMessage(t, err));
    }
  }

  return (
    <>
      <PageHeader title={L.title} action={canWrite && !open && <Button variant="primary" onClick={() => setOpen(true)}>+ {L.add}</Button>} />
      {message && <div className="mb-4"><Alert>{message}</Alert></div>}

      {code && (
        <Card className="mb-6 border-accent">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold">{L.codeTitle} — {code.name}</h2>
              <p className="mt-1 max-w-xl text-sm text-muted">{L.codeHelp}</p>
            </div>
            <Button onClick={() => setCode(null)}>{t.common.close}</Button>
          </div>
          <dl className="mt-4 grid gap-4 sm:grid-cols-3">
            <div><dt className="text-xs text-muted">{L.username}</dt><dd dir="ltr" className="text-start font-mono text-lg font-semibold">{code.username}</dd></div>
            <div><dt className="text-xs text-muted">{L.codeTitle}</dt><dd dir="ltr" className="text-start font-mono text-2xl font-bold tracking-[0.25em] text-accent-ink">{code.code}</dd></div>
            <div><dt className="text-xs text-muted">{L.expires}</dt><dd className="text-sm">{new Date(code.expiresAt).toLocaleString(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB")}</dd></div>
          </dl>
        </Card>
      )}

      {open && (
        <Card className="mb-6">
          <form onSubmit={submit} noValidate>
            <h2 className="mb-4 text-lg font-bold">{L.add}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={L.fullName} error={fieldError(t, errors.fullName)}><Input value={form.fullName} onChange={set("fullName")} required /></Field>
              <Field label={L.username} error={fieldError(t, errors.username)} hint="a-z 0-9 . _ -"><Input dir="ltr" autoCapitalize="none" value={form.username} onChange={set("username")} required /></Field>
              <Field label={`${L.phone} (${t.common.optional})`}><Input dir="ltr" type="tel" value={form.phone} onChange={set("phone")} placeholder="01xxxxxxxxx" /></Field>
              {(branches.data?.items.length ?? 0) > 1 && (
                <Field label={L.branch}><Select value={form.branchId} onChange={set("branchId")}>{branches.data!.items.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
              )}
            </div>
            <div className="mt-5 flex gap-2">
              <Button variant="primary" type="submit" disabled={busy}>{busy ? t.common.loading : t.common.save}</Button>
              <Button type="button" onClick={() => { setOpen(false); setErrors({}); }}>{t.common.cancel}</Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="p-0">
        {drivers.loading && !drivers.data ? (
          <p className="p-6 text-muted">{t.common.loading}</p>
        ) : !drivers.data?.items.length ? (
          <p className="p-6 text-muted">{L.empty}</p>
        ) : (
          <Table head={[L.fullName, L.username, L.phone, L.branch, L.device, ""]}>
            {drivers.data.items.map((d) => (
              <tr key={d.id}>
                <Td className="font-semibold">{d.fullName}</Td>
                <Td><span dir="ltr">{d.username}</span></Td>
                <Td><span dir="ltr">{d.phone ?? "—"}</span></Td>
                <Td>{branchName.get(d.branchId) ?? "—"}</Td>
                <Td><Badge tone={d.hasActiveDevice ? "ok" : "muted"}>{d.hasActiveDevice ? L.deviceActive : L.deviceNone}</Badge></Td>
                <Td>{canIssue && <Button variant="ghost" onClick={() => issue(d.id, d.fullName)}>{L.issueCode}</Button>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
