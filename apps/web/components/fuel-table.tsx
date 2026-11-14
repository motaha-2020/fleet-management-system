"use client";
import { useState } from "react";
import Link from "next/link";
import { allows } from "@fleet/domain";
import { COUNTRY_TEMPLATES, EGYPT } from "@fleet/config";
import type { FuelEntry } from "@fleet/contracts";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { apiErrorMessage } from "@/lib/errors";
import { fmtDateTime, saveDownload } from "@/lib/format";
import { Badge, Button, Input, Table, Td } from "./ui";
import { CorrectionButton, fromMinor } from "./m2-common";

const statusTone = { submitted: "info", under_review: "warn", accepted: "ok", voided: "muted" } as const;
const conflictFlags = new Set(["tank_exceeded", "odometer_conflict", "possible_duplicate"]);

/** Fuel entries with findings, review actions (maker ≠ checker) and correction requests. */
export function FuelTable({ items, onChange, showVehicle, vehicleName, driverName }: {
  items: FuelEntry[]; onChange: () => void; showVehicle?: boolean; vehicleName?: (id: string) => string; driverName?: (id: string | null) => string;
}) {
  const { api, user } = useSession();
  const { t, locale } = useI18n();
  const F = t.m2.fuel;
  const can = (a: Parameters<typeof allows>[1]) => !!user && allows(user, a).allowed;
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); setVoiding(null); setReason(""); onChange(); } catch (e) { setError(apiErrorMessage(t, e)); }
  };
  const country = COUNTRY_TEMPLATES[user?.tenant?.countryCode ?? ""] ?? EGYPT;
  const fuelName = (code: string) => country.fuelTypes.find((f) => f.code === code)?.name[locale] ?? code;

  return (
    <>
      {error && <p className="px-5 pt-3 text-sm font-medium text-bad" role="alert">{error}</p>}
      <Table head={[F.at, ...(showVehicle ? [t.m2.costs.vehicle] : []), F.driver, F.type, F.quantity, F.odometer, F.amount, F.status, F.flags, ""]}>
        {items.map((e) => (
          <tr key={e.id} className={e.status === "voided" ? "opacity-60" : ""}>
            <Td>{fmtDateTime(e.eventAt, locale)}</Td>
            {showVehicle && <Td className="font-semibold"><Link className="text-accent hover:underline" href={`/vehicles/${e.vehicleId}`}>{vehicleName?.(e.vehicleId) ?? "—"}</Link></Td>}
            <Td>{driverName?.(e.driverId) ?? "—"}</Td>
            <Td>{fuelName(e.fuelType)} · {e.isFull ? F.full : F.partial}</Td>
            <Td>{e.quantity} {e.unit === "m3" ? "m³" : "L"}</Td>
            <Td>{e.odometer.toLocaleString("en")}</Td>
            <Td>{fromMinor(e.grossMinor)} {e.currency}<div className="text-xs text-muted">{F.unitPrice}: {fromMinor(e.unitPriceMinor)}{e.referencePriceMinor ? ` · ${F.reference}: ${fromMinor(e.referencePriceMinor)}` : ""}</div></Td>
            <Td>
              <Badge tone={statusTone[e.status]}>{F.statuses[e.status]}</Badge>
              {e.voidReason && <div className="mt-1 max-w-[12rem] whitespace-normal text-xs text-muted">{e.voidReason}</div>}
            </Td>
            <Td className="whitespace-normal">
              <div className="flex max-w-xs flex-wrap gap-1">
                {e.flags.map((f) => <Badge key={f} tone={conflictFlags.has(f) ? "bad" : "warn"}>{(F.flagNames as Record<string, string>)[f] ?? f}</Badge>)}
              </div>
            </Td>
            <Td>
              <div className="flex flex-wrap items-center gap-1">
                {e.hasReceipt && <Button variant="ghost" className="min-h-8 px-2" onClick={async () => saveDownload(await api.download("downloadFuelReceipt", { id: e.id }), `receipt-${e.id}`)}>{F.receipt}</Button>}
                {can("fuel.review") && e.status === "under_review" && e.createdBy !== user?.identityId && (
                  <Button variant="primary" className="min-h-8 px-3" onClick={() => run(() => api.call("acceptFuelEntry", { params: { id: e.id } }))}>{F.accept}</Button>
                )}
                {can("fuel.review") && e.status !== "voided" && (voiding === e.id ? (
                  <form className="flex items-center gap-1" onSubmit={(ev) => { ev.preventDefault(); void run(() => api.call("voidFuelEntry", { params: { id: e.id }, body: { reason } })); }}>
                    <Input aria-label={F.voidReason} placeholder={F.voidReason} value={reason} onChange={(ev) => setReason(ev.target.value)} className="min-h-8 w-36" />
                    <Button type="submit" className="min-h-8 px-2" disabled={reason.trim().length < 3}>{F.void}</Button>
                  </form>
                ) : <Button variant="ghost" className="min-h-8 px-2" onClick={() => { setVoiding(e.id); setReason(""); }}>{F.void}</Button>)}
                {can("correction.request") && e.status !== "voided" && <CorrectionButton recordType="fuel_entry" recordId={e.id} field="netMinor" kind="money" onDone={onChange} />}
              </div>
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
