"use client";
import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { ApiRequestError, type DocumentType } from "@fleet/contracts";
import { allows } from "@fleet/domain";
import { fieldError } from "@fleet/i18n";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { ReviewActions, ValidityBadge } from "@/components/documents-panel";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { apiErrorMessage } from "@/lib/errors";
import { fmtDate, fmtDateTime, saveDownload } from "@/lib/format";

/** Verification queue (Maker ≠ Checker) + company document type settings (US-E03-02). */
export default function DocumentsPage() {
  const { api, user } = useSession();
  const { t, locale } = useI18n();
  const D = t.docs;
  const canManageTypes = !!user && allows(user, "document_type.manage").allowed;
  const queue = useLoad(() => api.call("listDocuments", { query: { status: "pending" } }), [api]);
  const types = useLoad(() => api.call("listDocumentTypes"), [api]);
  const vehicles = useLoad(() => api.call("listVehicles"), [api]);
  const drivers = useLoad(() => api.call("listDrivers"), [api]);
  const typeName = useMemo(() => new Map((types.data?.items ?? []).map((x) => [x.code, x.name[locale]])), [types.data, locale]);
  const entityName = useMemo(() => new Map([
    ...(vehicles.data?.items ?? []).map((v) => [v.id, `${v.fleetNumber} · ${v.registrationNumber}`] as const),
    ...(drivers.data?.items ?? []).map((d) => [d.id, d.fullName] as const),
  ]), [vehicles.data, drivers.data]);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [newType, setNewType] = useState<null | { code: string; entityType: "vehicle" | "driver"; nameAr: string; nameEn: string; mandatory: boolean; hasExpiry: boolean; risk: DocumentType["risk"]; driverVisibility: DocumentType["driverVisibility"]; sensitive: boolean }>(null);

  async function run(fn: () => Promise<unknown>) {
    setMessage(null);
    setErrors({});
    try { await fn(); await Promise.all([types.reload(), queue.reload()]); return true; } catch (err) {
      if (err instanceof ApiRequestError) setErrors(err.fields);
      setMessage(apiErrorMessage(t, err));
      return false;
    }
  }

  async function createType(e: FormEvent) {
    e.preventDefault();
    if (newType && await run(() => api.call("createDocumentType", { body: newType }))) setNewType(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={D.title} />
      {message && <Alert>{message}</Alert>}

      <Card className="p-0">
        <h2 className="border-b border-line px-5 py-4 text-lg font-bold">{D.queue}</h2>
        {!queue.data ? <p className="p-5 text-muted">{t.common.loading}</p> : !queue.data.items.length ? <p className="p-5 text-muted">{D.empty}</p> : (
          <Table head={[D.type, D.entity, D.number, D.expiryDate, D.validity, D.status, ""]}>
            {queue.data.items.map((d) => (
              <tr key={d.id}>
                <Td className="font-semibold">{typeName.get(d.typeCode) ?? d.typeCode}</Td>
                <Td><Link className="text-accent hover:underline" href={`/${d.entityType === "vehicle" ? "vehicles" : "drivers"}/${d.entityId}`}>{entityName.get(d.entityId) ?? (d.entityType === "vehicle" ? D.vehicleEntity : D.driverEntity)}</Link></Td>
                <Td>{d.number ?? "—"}</Td>
                <Td>{fmtDate(d.expiryDate, locale)}</Td>
                <Td><ValidityBadge v={d.validity} /></Td>
                <Td><span className="text-xs text-muted">{fmtDateTime(d.createdAt, locale)}</span></Td>
                <Td>
                  <div className="flex flex-wrap items-center gap-2">
                    {d.canDownload && <Button variant="ghost" className="min-h-8 px-3" onClick={async () => saveDownload(await api.download("downloadDocument", { id: d.id }), d.file?.name ?? "document")}>{D.download}</Button>}
                    <ReviewActions doc={d} onChange={() => void queue.reload()} />
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {canManageTypes && (
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="text-lg font-bold">{D.types}</h2>
            {!newType && <Button variant="primary" onClick={() => setNewType({ code: "", entityType: "vehicle", nameAr: "", nameEn: "", mandatory: false, hasExpiry: true, risk: "R1", driverVisibility: "none", sensitive: false })}>+ {D.addType}</Button>}
          </div>
          {newType && (
            <form onSubmit={createType} noValidate className="grid gap-4 border-b border-line p-5 sm:grid-cols-3">
              <Field label={D.code} error={fieldError(t, errors.code)}><Input dir="ltr" value={newType.code} onChange={(e) => setNewType({ ...newType, code: e.target.value })} placeholder="GPS_CERT" /></Field>
              <Field label={D.nameAr} error={fieldError(t, errors.nameAr)}><Input value={newType.nameAr} onChange={(e) => setNewType({ ...newType, nameAr: e.target.value })} /></Field>
              <Field label={D.nameEn} error={fieldError(t, errors.nameEn)}><Input dir="ltr" value={newType.nameEn} onChange={(e) => setNewType({ ...newType, nameEn: e.target.value })} /></Field>
              <Field label={D.entity}><Select value={newType.entityType} onChange={(e) => setNewType({ ...newType, entityType: e.target.value as "vehicle" | "driver" })}><option value="vehicle">{D.vehicleEntity}</option><option value="driver">{D.driverEntity}</option></Select></Field>
              <Field label={D.risk}><Select value={newType.risk} onChange={(e) => setNewType({ ...newType, risk: e.target.value as DocumentType["risk"] })}>{(["R1", "R2", "R3", "R4"] as const).map((r) => <option key={r}>{r}</option>)}</Select></Field>
              <Field label={D.driverVisibility}><Select value={newType.driverVisibility} disabled={newType.sensitive} onChange={(e) => setNewType({ ...newType, driverVisibility: e.target.value as DocumentType["driverVisibility"] })}>{(["none", "view", "download"] as const).map((v) => <option key={v} value={v}>{D.visibility[v]}</option>)}</Select></Field>
              <div className="flex flex-wrap gap-4 text-sm sm:col-span-3">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={newType.mandatory} onChange={(e) => setNewType({ ...newType, mandatory: e.target.checked })} />{D.mandatory}</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={newType.hasExpiry} onChange={(e) => setNewType({ ...newType, hasExpiry: e.target.checked })} />{D.hasExpiry}</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={newType.sensitive} onChange={(e) => setNewType({ ...newType, sensitive: e.target.checked, driverVisibility: e.target.checked ? "none" : newType.driverVisibility })} />{D.sensitive}</label>
              </div>
              <div className="flex gap-2 sm:col-span-3">
                <Button variant="primary" type="submit">{t.common.save}</Button>
                <Button type="button" onClick={() => setNewType(null)}>{t.common.cancel}</Button>
              </div>
            </form>
          )}
          {!types.data ? <p className="p-5 text-muted">{t.common.loading}</p> : (
            <Table head={[D.type, D.entity, D.source, D.risk, D.mandatory, D.driverVisibility]}>
              {types.data.items.map((x) => (
                <tr key={x.code} className={x.active ? "" : "opacity-60"}>
                  <Td className="font-semibold">{x.name[locale]} {x.sensitive && <Badge tone="warn">{D.sensitive}</Badge>}</Td>
                  <Td>{x.entityType === "vehicle" ? D.vehicleEntity : D.driverEntity}</Td>
                  <Td>{x.source === "country" ? D.country : D.company}</Td>
                  <Td>{x.risk}</Td>
                  <Td>
                    {x.countryMandatory ? <Badge tone="info">{D.countryMandatory}</Badge> : (
                      <label className="flex items-center gap-1.5 text-sm">
                        <input type="checkbox" checked={x.mandatory} onChange={(e) => run(() => api.call("updateDocumentType", { params: { code: x.code }, body: { mandatory: e.target.checked } }))} />
                        {D.mandatory}
                      </label>
                    )}
                  </Td>
                  <Td>
                    {x.sensitive ? D.visibility.none : (
                      <Select value={x.driverVisibility} className="min-h-8 w-auto py-0" aria-label={D.driverVisibility}
                        onChange={(e) => run(() => api.call("updateDocumentType", { params: { code: x.code }, body: { driverVisibility: e.target.value as DocumentType["driverVisibility"] } }))}>
                        {(["none", "view", "download"] as const).map((v) => <option key={v} value={v}>{D.visibility[v]}</option>)}
                      </Select>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
