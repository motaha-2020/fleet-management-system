"use client";
import { useState } from "react";
import { IMPORT_ENTITIES, type ImportBatch } from "@fleet/contracts";
import { fieldError } from "@fleet/i18n";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { useAction } from "@/components/m4-common";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { fmtDateTime, saveDownload } from "@/lib/format";

type Entity = (typeof IMPORT_ENTITIES)[number];
const stTone = { validated: "info", imported: "ok", partially_imported: "warn", failed: "bad", rolled_back: "muted" } as const;

async function toBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** E17: upload → map (by template column names) → validation preview by row/column → approve → import; rejected rows; rollback. */
export default function ImportsPage() {
  const { api } = useSession();
  const { t, locale } = useI18n();
  const I = t.m5.imports;
  const [entity, setEntity] = useState<Entity>("vehicles");
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"partial" | "all_or_nothing">("partial");
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [reason, setReason] = useState("");
  const history = useLoad(() => api.call("listImports"), [api]);
  const act = useAction();
  const financial = entity === "fines" || entity === "costs";

  const upload = () => act.run(async () => {
    if (!file) return;
    setBatch(await api.call("createImport", { body: { entity, fileName: file.name, content: await toBase64(file), ...(financial ? {} : { mode }) } }));
    await history.reload();
  });
  const errMsg = (code: string) => fieldError(t, code) ?? code;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={I.title} />
      <p className="max-w-3xl text-sm text-muted">{I.help}</p>
      <Card>
        <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => { e.preventDefault(); void upload(); }}>
          <Field label={I.entity}>
            <Select value={entity} onChange={(e) => { setEntity(e.target.value as Entity); setBatch(null); }}>
              {IMPORT_ENTITIES.map((x) => <option key={x} value={x}>{I.entities[x]}</option>)}
            </Select>
          </Field>
          <Field label={I.file} error={act.fe("content") ?? act.fe("mapping")}>
            <Input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
          <Field label={I.mode}>
            <Select value={financial ? "all_or_nothing" : mode} disabled={financial} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="partial">{I.modes.partial}</option>
              <option value="all_or_nothing">{I.modes.all_or_nothing}</option>
            </Select>
          </Field>
          <div className="flex flex-wrap items-end gap-2">
            <Button variant="primary" type="submit" disabled={act.busy || !file}>{I.upload}</Button>
            <Button type="button" variant="ghost" onClick={() => void act.run(async () => saveDownload(await api.download("importTemplate", { entity }), `${entity}_template.csv`))}>{I.template}</Button>
          </div>
        </form>
      </Card>
      {act.error && <Alert>{act.error}</Alert>}

      {batch && (
        <Card className="p-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
            <h2 className="font-bold">{I.entities[batch.entity]} · {batch.fileName}</h2>
            <Badge tone={stTone[batch.status]}>{I.statuses[batch.status]}</Badge>
            <span className="text-sm text-muted">{I.rows}: {batch.rowCount} · {I.errors}: {batch.errorCount} · {I.imported}: {batch.importedCount}</span>
            <div className="ms-auto flex flex-wrap gap-2">
              {batch.status === "validated" && (
                <Button variant="primary" disabled={act.busy || (batch.mode === "all_or_nothing" && batch.errorCount > 0) || batch.errorCount === batch.rowCount}
                  onClick={() => void act.run(async () => { setBatch(await api.call("approveImport", { params: { id: batch.id } })); await history.reload(); })}>{I.approve}</Button>
              )}
              {batch.errorCount > 0 && (
                <Button onClick={() => void act.run(async () => saveDownload(await api.download("importRejected", { id: batch.id }), `${batch.entity}_rejected.csv`))}>{I.rejected}</Button>
              )}
            </div>
          </div>
          {batch.errors.length > 0 && (
            <div className="border-b border-line">
              <Table head={[I.row, I.column, I.error]}>
                {batch.errors.slice(0, 200).map((e, i) => (
                  <tr key={i}><Td>{e.row || "—"}</Td><Td className="font-mono text-sm">{e.column}</Td><Td className="text-bad">{errMsg(e.code)}</Td></tr>
                ))}
              </Table>
            </div>
          )}
          <div className="px-5 pt-3 text-sm font-bold">{I.preview}</div>
          {batch.preview.length > 0 && (
            <Table head={["#", ...Object.keys(batch.preview[0]!)]}>
              {batch.preview.map((r, i) => (
                <tr key={i} className={batch.errors.some((e) => e.row === i + 1) ? "bg-bad-bg/40" : ""}>
                  <Td>{i + 1}</Td>
                  {Object.keys(batch.preview[0]!).map((k) => <Td key={k}>{r[k] ?? ""}</Td>)}
                </tr>
              ))}
            </Table>
          )}
          {batch.canRollback && (
            <form className="flex flex-wrap items-end gap-2 border-t border-line p-4" onSubmit={(e) => {
              e.preventDefault();
              void act.run(async () => { setBatch(await api.call("rollbackImport", { params: { id: batch.id }, body: { reason } })); await history.reload(); });
            }}>
              <Field label={I.rollbackReason}><Input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} /></Field>
              <Button type="submit" className="text-bad" disabled={act.busy}>{I.rollback}</Button>
            </form>
          )}
        </Card>
      )}

      <Card className="p-0">
        <h2 className="border-b border-line px-5 py-3 font-bold">{I.history}</h2>
        {!history.data?.items.length ? <p className="p-5 text-muted">{I.empty}</p> : (
          <Table head={[t.m5.alerts.created, I.entity, I.file, I.rows, I.errors, I.imported, t.m4.maintenance.status]}>
            {history.data.items.map((b) => (
              <tr key={b.id} className="cursor-pointer hover:bg-[#F5F7FA]" onClick={() => void act.run(async () => setBatch(await api.call("getImport", { params: { id: b.id } })))}>
                <Td>{fmtDateTime(b.createdAt, locale)}</Td><Td>{I.entities[b.entity]}</Td><Td>{b.fileName}</Td><Td>{b.rowCount}</Td><Td>{b.errorCount}</Td><Td>{b.importedCount}</Td>
                <Td><Badge tone={stTone[b.status]}>{I.statuses[b.status]}</Badge></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
