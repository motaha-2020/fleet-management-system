"use client";
import { useState, type FormEvent } from "react";
import { COUNTRY_TEMPLATES } from "@fleet/config";
import { ApiRequestError } from "@fleet/contracts";
import { fieldError } from "@fleet/i18n";
import { Alert, Button, Card, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { fromMinor, localInputToIso, nowLocalInput, toMinor } from "@/components/m2-common";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { apiErrorMessage } from "@/lib/errors";
import { fmtDateTime } from "@/lib/format";

/** FUEL-017: official prices per country, effective-dated and append-only. */
export default function FuelPricesPage() {
  const { api } = useSession();
  const { t, locale } = useI18n();
  const P = t.m2.prices;
  const prices = useLoad(() => api.call("listFuelPrices"), [api]);
  const [f, setF] = useState({ countryCode: "EG", fuelType: "PET92", price: "", at: nowLocalInput() });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const country = COUNTRY_TEMPLATES[f.countryCode];
  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setMessage(null);
    try {
      await api.call("createFuelPrice", { body: { countryCode: f.countryCode, fuelType: f.fuelType, priceMinor: toMinor(f.price), effectiveFrom: localInputToIso(f.at) } });
      setF({ ...f, price: "" });
      await prices.reload();
    } catch (err) {
      if (err instanceof ApiRequestError) setErrors(err.fields);
      setMessage(apiErrorMessage(t, err));
    }
  }
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={P.title} />
      <p className="text-sm text-muted">{P.note}</p>
      {message && <Alert>{message}</Alert>}
      <Card>
        <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-5">
          <Field label={P.country}><Select value={f.countryCode} onChange={(e) => setF({ ...f, countryCode: e.target.value })}>{Object.keys(COUNTRY_TEMPLATES).map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Field label={P.type}><Select value={f.fuelType} onChange={(e) => setF({ ...f, fuelType: e.target.value })}>{country?.fuelTypes.map((x) => <option key={x.code} value={x.code}>{x.name[locale]}</option>)}</Select></Field>
          <Field label={`${P.price} (${country?.currency})`} error={fieldError(t, errors.priceMinor)}><Input type="number" min="0" step="0.01" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
          <Field label={P.effective} error={fieldError(t, errors.effectiveFrom)}><Input type="datetime-local" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} /></Field>
          <div className="flex items-end"><Button variant="primary" type="submit" disabled={!f.price}>{P.add}</Button></div>
        </form>
      </Card>
      <Card className="p-0">
        <Table head={[P.country, P.type, P.price, P.effective]}>
          {(prices.data?.items ?? []).map((p) => (
            <tr key={p.id}>
              <Td>{p.countryCode}</Td>
              <Td>{COUNTRY_TEMPLATES[p.countryCode]?.fuelTypes.find((x) => x.code === p.fuelType)?.name[locale] ?? p.fuelType}</Td>
              <Td className="font-semibold">{fromMinor(p.priceMinor)} {p.currency}</Td>
              <Td>{fmtDateTime(p.effectiveFrom, locale)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
