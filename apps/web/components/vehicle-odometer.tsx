"use client";
import { useState, type FormEvent } from "react";
import { allows } from "@fleet/domain";
import { ApiRequestError, type MeterReading, type Vehicle } from "@fleet/contracts";
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

const mapUrl = (l: { lat: number; lng: number }) => `https://www.google.com/maps?q=${l.lat},${l.lng}`;

/** The meter photo with when it was taken and where, stamped on the view (owner decision, 13 Nov 2026). */
function PhotoViewer({ reading, onClose }: { reading: MeterReading; onClose: () => void }) {
  const { api } = useSession();
  const { t, locale } = useI18n();
  const O = t.m2.odo;
  const img = useLoad(async () => URL.createObjectURL(await (await api.download("downloadOdometerPhoto", { id: reading.id })).blob()), [api, reading.id]);
  const l = reading.location;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="w-full max-w-2xl overflow-hidden rounded-xl bg-surface" onClick={(e) => e.stopPropagation()}>
        <div className="relative bg-black">
          {img.data ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img.data} alt={O.photo} className="max-h-[70vh] w-full object-contain" />
          ) : <p className="p-10 text-center text-white/70">{img.error ? apiErrorMessage(t, img.error) : t.common.loading}</p>}
          <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-2 bg-gradient-to-t from-black/80 to-transparent p-3 text-sm font-semibold text-white" dir="ltr">
            <span>{km(reading.value, locale)} km · {fmtDateTime(reading.photoTakenAt ?? reading.eventAt, locale)}</span>
            <span>{l ? `${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}${l.accuracyM != null ? ` (±${l.accuracyM} m)` : ""}` : reading.locationStatus ? O.noLocation[reading.locationStatus] : ""}</span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 p-3">
          {l ? <a href={mapUrl(l)} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-accent hover:underline">{O.openMap}</a> : <span />}
          <Button onClick={onClose}>{O.close}</Button>
        </div>
      </div>
    </div>
  );
}

/** E08: unified timeline with status and source; conflicts kept and visible; corrections via maker/checker. */
export function VehicleOdometer({ vehicle }: { vehicle: Vehicle }) {
  const { api, user } = useSession();
  const { t, locale } = useI18n();
  const O = t.m2.odo;
  const can = (a: Parameters<typeof allows>[1]) => !!user && allows(user, a).allowed;
  const odo = useLoad(() => api.call("vehicleOdometer", { params: { id: vehicle.id } }), [api, vehicle.id]);
  const [viewing, setViewing] = useState<MeterReading | null>(null);
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
          <Table head={[O.at, O.value, O.source, O.status, O.photo, O.location, ""]}>
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
                <Td>
                  {r.hasPhoto ? <Button variant="ghost" className="min-h-8 px-2" onClick={() => setViewing(r)}>{O.openPhoto}</Button>
                    : r.photoTakenAt ? <span className="text-xs text-muted">{O.noPhoto}</span> : null}
                </Td>
                <Td>
                  {r.location ? (
                    <a href={mapUrl(r.location)} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-accent hover:underline">
                      {O.openMap}{r.location.accuracyM != null && <span className="ms-1 text-xs font-normal text-muted">{O.accuracy.replace("{m}", String(r.location.accuracyM))}</span>}
                    </a>
                  ) : r.locationStatus ? <span className="text-xs text-muted">{O.noLocation[r.locationStatus]}</span> : null}
                </Td>
                <Td>{can("correction.request") && (r.status === "valid" || r.status === "warning" || r.status === "conflict") && <CorrectionButton recordType="meter_reading" recordId={r.id} field="value" kind="int" />}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {viewing && <PhotoViewer reading={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
