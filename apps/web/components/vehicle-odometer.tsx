"use client";
import { useState, type FormEvent } from "react";
import { authorize } from "@fleet/domain";
import { ApiRequestError, type Vehicle } from "@fleet/contracts";
import { fieldError } from "@fleet/i18n";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { apiErrorMessage } from "@/lib/errors";
import { fmtDateTime } from "@/lib/format";
import { Alert, Badge, Button, Card, Field, Input, Table, Td } from "./ui";
import { CorrectionButton, localInputToIso, nowLocalInput } from "./m2-common";

const tone = { valid: "ok", warning: "warn", conflict: "bad", corrected: "muted", excluded: "muted" } as const;
const km = (n: number, locale: string) => n.toLocaleString(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB");

/** E08: unified timeline with status and source; conflicts kept and visible; corrections via maker/checker. */
export function VehicleOdometer({ vehicle }: { vehicle: Vehicle }) {
  const { api, user } = useSession();
  const { t, locale } = useI18n();
  const O = t.m2.odo;
  const can = (a: Parameters<typeof authorize>[1]) => !!user && authorize(user.role, a).allowed;
  const odo = useLoad(() => api.call("vehicleOdometer", { params: { id: vehicle.id } }), [api, vehicle.id]);
  const [reading, setReading] = useState({ value: "", at: nowLocalInput() });
  const [rep, setRep] = useState<null | { oldFinal: string; newStart: string; at: string; reason: string }>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setErrors({});
    setMessage(null);
    try { await fn(); await odo.reload(); return true; } catch (err) {
      if (err instanceof ApiRequestError) setErrors(err.fields);
      setMessage({ tone: "bad", text: apiErrorMessage(t, err) });
      return false;
    }
  }
  const empty = !odo.data?.readings.length;
  async function add(e: FormEvent) {
    e.preventDefault();
    if (await run(() => api.call("createReading", { body: { vehicleId: vehicle.id, value: Number(reading.value), eventAt: localInputToIso(reading.at), opening: empty } }))) setReading({ value: "", at: nowLocalInput() });
  }

  return (
    <div className="flex flex-col gap-6">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs text-muted">{O.current}</div>
            <div className="text-2xl font-bold" data-testid="odometer-current">{odo.data?.current ? `${km(odo.data.current.value, locale)} km` : O.none}</div>
            {odo.data?.current && odo.data.current.cumulative !== odo.data.current.value && <div className="text-xs text-muted">{O.cumulative}: {km(odo.data.current.cumulative, locale)} km</div>}
          </div>
          {can("odometer.replace") && vehicle.status !== "disposed" && !rep && <Button onClick={() => setRep({ oldFinal: "", newStart: "0", at: nowLocalInput(), reason: "" })}>{O.replace}</Button>}
        </div>
        {can("odometer.write") && vehicle.status !== "disposed" && (
          <form onSubmit={add} noValidate className="mt-5 grid gap-4 sm:grid-cols-3">
            <Field label={empty ? `${O.opening} — ${O.value}` : O.value} error={fieldError(t, errors.value)}><Input type="number" min="0" value={reading.value} onChange={(e) => setReading({ ...reading, value: e.target.value })} /></Field>
            <Field label={O.at} error={fieldError(t, errors.eventAt)}><Input type="datetime-local" value={reading.at} onChange={(e) => setReading({ ...reading, at: e.target.value })} /></Field>
            <div className="flex items-end"><Button variant="primary" type="submit" disabled={!reading.value}>{empty ? O.opening : O.add}</Button></div>
          </form>
        )}
        {rep && (
          <form className="mt-5 grid gap-4 rounded-lg border border-line p-4 sm:grid-cols-4" onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => api.call("createReplacement", { body: { vehicleId: vehicle.id, eventAt: localInputToIso(rep.at), oldFinal: Number(rep.oldFinal), newStart: Number(rep.newStart), reason: rep.reason || null } }))) setRep(null);
          }}>
            <Field label={O.oldFinal}><Input type="number" min="0" value={rep.oldFinal} onChange={(e) => setRep({ ...rep, oldFinal: e.target.value })} /></Field>
            <Field label={O.newStart} error={fieldError(t, errors.newStart)}><Input type="number" min="0" value={rep.newStart} onChange={(e) => setRep({ ...rep, newStart: e.target.value })} /></Field>
            <Field label={O.at}><Input type="datetime-local" value={rep.at} onChange={(e) => setRep({ ...rep, at: e.target.value })} /></Field>
            <Field label={`${O.reason} (${t.common.optional})`}><Input value={rep.reason} onChange={(e) => setRep({ ...rep, reason: e.target.value })} /></Field>
            <div className="flex gap-2 sm:col-span-4">
              <Button variant="primary" type="submit" disabled={!rep.oldFinal}>{O.replace}</Button>
              <Button type="button" onClick={() => setRep(null)}>{t.common.cancel}</Button>
            </div>
          </form>
        )}
      </Card>
      <Card className="p-0">
        {empty ? <p className="p-5 text-muted">{O.none}</p> : (
          <Table head={[O.at, O.value, O.source, O.status, ""]}>
            {odo.data!.readings.map((r) => (
              <tr key={r.id} className={r.status === "corrected" || r.status === "excluded" ? "opacity-60" : ""}>
                <Td>{fmtDateTime(r.eventAt, locale)}</Td>
                <Td className="font-semibold"><span className={r.status === "corrected" ? "line-through" : ""}>{km(r.value, locale)}</span></Td>
                <Td>{O.sources[r.sourceType]}</Td>
                <Td>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={tone[r.status]}>{O.statuses[r.status]}</Badge>
                    {r.reasons.map((x) => <span key={x} className="text-xs text-muted">{(O.reasons as Record<string, string>)[x] ?? x}</span>)}
                  </div>
                </Td>
                <Td>{can("correction.request") && (r.status === "valid" || r.status === "warning" || r.status === "conflict") && <CorrectionButton recordType="meter_reading" recordId={r.id} field="value" kind="int" />}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
