"use client";
import { useMemo, useState, type FormEvent } from "react";
import { authorize } from "@fleet/domain";
import type { Document, DocumentType } from "@fleet/contracts";
import { fieldError } from "@fleet/i18n";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { apiErrorMessage } from "@/lib/errors";
import { fmtDate, saveDownload } from "@/lib/format";
import { newId } from "@/lib/ids";
import { ApiRequestError } from "@fleet/contracts";
import { Alert, Badge, Button, Card, Field, Input, Select, Table, Td } from "./ui";

const validityTone = { valid: "ok", expiring: "warn", expired: "bad", no_expiry: "muted" } as const;
const statusTone = { draft: "muted", pending: "info", verified: "ok", rejected: "bad", superseded: "muted" } as const;

export function ValidityBadge({ v }: { v: Document["validity"] }) {
  const { t } = useI18n();
  return <Badge tone={validityTone[v]}>{t.docs.validities[v]}</Badge>;
}

export function StatusBadge({ s }: { s: Document["status"] }) {
  const { t } = useI18n();
  return <Badge tone={statusTone[s]}>{t.docs.statuses[s]}</Badge>;
}

/** Verify/reject buttons; hidden for the document's creator (Maker ≠ Checker — the API enforces it too). */
export function ReviewActions({ doc, onChange }: { doc: Document; onChange: () => void }) {
  const { api, user } = useSession();
  const { t } = useI18n();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!user || doc.status !== "pending" || !authorize(user.role, "document.verify").allowed || doc.createdBy === user.identityId) return null;
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); onChange(); } catch (e) { setError(apiErrorMessage(t, e)); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!rejecting ? (
        <>
          <Button variant="primary" className="min-h-8 px-3" onClick={() => run(() => api.call("verifyDocument", { params: { id: doc.id } }))}>{t.docs.verify}</Button>
          <Button className="min-h-8 px-3" onClick={() => setRejecting(true)}>{t.docs.reject}</Button>
        </>
      ) : (
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => api.call("rejectDocument", { params: { id: doc.id }, body: { reason } })); }}>
          <Input aria-label={t.docs.rejectReason} placeholder={t.docs.rejectReason} value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-8 w-48" />
          <Button type="submit" className="min-h-8 px-3" disabled={reason.trim().length < 3}>{t.docs.reject}</Button>
        </form>
      )}
      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  );
}

export function DocumentsPanel({ entityType, entityId, readOnly = false }: { entityType: "vehicle" | "driver"; entityId: string; readOnly?: boolean }) {
  const { api, user } = useSession();
  const { t, locale } = useI18n();
  const [history, setHistory] = useState(false);
  const types = useLoad(() => api.call("listDocumentTypes"), [api]);
  const docs = useLoad(() => api.call("listDocuments", { query: { entityType, entityId, includeHistory: history ? "true" : "false" } }), [api, entityType, entityId, history]);
  const typeMap = useMemo(() => new Map((types.data?.items ?? []).map((x) => [x.code, x])), [types.data]);
  const typeName = (code: string) => typeMap.get(code)?.name[locale] ?? code;
  const canUpload = !readOnly && !!user && authorize(user.role, "document.upload").allowed;

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ typeCode: "", number: "", issueDate: "", expiryDate: "" });
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const selected: DocumentType | undefined = typeMap.get(form.typeCode);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      if (!file) throw Object.assign(new Error("file"), { local: true });
      if (file.size > 10 * 1024 * 1024) { setErrors({ file: "file_too_large" }); return; }
      const doc = await api.call("createDocument", { body: {
        id: newId(), entityType, entityId, typeCode: form.typeCode, number: form.number || null,
        issueDate: form.issueDate || null, expiryDate: selected?.hasExpiry ? form.expiryDate || null : null,
      } });
      await api.upload("uploadDocumentFile", { id: doc.id }, file, file.name);
      await api.call("submitDocument", { params: { id: doc.id } });
      setOpen(false);
      setForm({ typeCode: "", number: "", issueDate: "", expiryDate: "" });
      setFile(null);
      setMessage({ tone: "ok", text: t.docs.uploaded });
      await docs.reload();
    } catch (err) {
      if ((err as { local?: boolean }).local) setErrors({ file: "required" });
      else {
        if (err instanceof ApiRequestError) setErrors(err.fields);
        setMessage({ tone: "bad", text: apiErrorMessage(t, err) });
      }
    } finally {
      setBusy(false);
    }
  }

  async function download(d: Document) {
    try {
      await saveDownload(await api.download("downloadDocument", { id: d.id }), d.file?.name ?? "document");
    } catch (err) {
      setMessage({ tone: "bad", text: apiErrorMessage(t, err) });
    }
  }

  const missing = docs.data?.missingMandatory ?? [];
  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h2 className="text-lg font-bold">{t.docs.title}</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} /> {t.docs.history}
          </label>
          {canUpload && !open && <Button variant="primary" onClick={() => setOpen(true)}>+ {t.docs.add}</Button>}
        </div>
      </div>
      <div className="flex flex-col gap-3 p-5">
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        {missing.length > 0 && (
          <Alert tone="info">{t.docs.missing}: {missing.map(typeName).join("، ")}</Alert>
        )}
        {open && (
          <form onSubmit={submit} noValidate className="rounded-lg border border-line p-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label={t.docs.type} error={fieldError(t, errors.typeCode)}>
                <Select value={form.typeCode} onChange={(e) => setForm({ ...form, typeCode: e.target.value })} required>
                  <option value="">—</option>
                  {(types.data?.items ?? []).filter((x) => x.entityType === entityType && x.active).map((x) => (
                    <option key={x.code} value={x.code}>{x.name[locale]}{x.mandatory ? ` (${t.docs.mandatory})` : ""}</option>
                  ))}
                </Select>
              </Field>
              <Field label={`${t.docs.number} (${t.common.optional})`} error={fieldError(t, errors.number)}>
                <Input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
              </Field>
              <Field label={`${t.docs.issueDate} (${t.common.optional})`} error={fieldError(t, errors.issueDate)}>
                <Input type="date" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} />
              </Field>
              {(!selected || selected.hasExpiry) && (
                <Field label={t.docs.expiryDate} error={fieldError(t, errors.expiryDate)}>
                  <Input type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
                </Field>
              )}
              <Field label={t.docs.file} error={fieldError(t, errors.file)}>
                <Input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="py-1.5" />
              </Field>
            </div>
            <div className="mt-4 flex gap-2">
              <Button variant="primary" type="submit" disabled={busy || !form.typeCode}>{busy ? t.common.loading : t.common.save}</Button>
              <Button type="button" onClick={() => { setOpen(false); setErrors({}); }}>{t.common.cancel}</Button>
            </div>
          </form>
        )}
      </div>
      {!docs.data ? (
        <p className="px-5 pb-5 text-muted">{t.common.loading}</p>
      ) : !docs.data.items.length ? (
        <p className="px-5 pb-5 text-muted">{t.docs.none}</p>
      ) : (
        <Table head={[t.docs.type, t.docs.number, t.docs.expiryDate, t.docs.validity, t.docs.status, t.docs.version, ""]}>
          {docs.data.items.map((d) => (
            <tr key={d.id} className={d.status === "superseded" ? "opacity-60" : ""}>
              <Td className="font-semibold">{typeName(d.typeCode)}</Td>
              <Td>{d.number ?? "—"}</Td>
              <Td>{fmtDate(d.expiryDate, locale)}</Td>
              <Td><ValidityBadge v={d.validity} /></Td>
              <Td>
                <StatusBadge s={d.status} />
                {d.rejectionReason && <div className="mt-1 max-w-xs whitespace-normal text-xs text-bad">{d.rejectionReason}</div>}
              </Td>
              <Td>{d.version}</Td>
              <Td>
                <div className="flex flex-wrap items-center gap-2">
                  {d.canDownload && <Button variant="ghost" className="min-h-8 px-3" onClick={() => download(d)}>{t.docs.download}</Button>}
                  <ReviewActions doc={d} onChange={() => void docs.reload()} />
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
