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
import { amountStep } from "@/lib/money";

/** Owner decision (16 Nov 2026): the company admin enters the official fuel price; entries are compared to it. */
export default function CompanyFuelPricesPage() {
  const { api } = useSession();
  const { t, locale } = useI18n();
  const P = t.m2.prices;
  const history = useLoad(() => api.call("listCompanyFuelPrices"), [api]);
  const current = useLoad(() => api.call("currentFuelPrices"), [api]);
  const company = useLoad(() => api.call("getCompany"), [api]);
  const country = company.data ? COUNTRY_TEMPLATES[company.data.countryCode] : undefined;
  const types = country?.fuelTypes ?? [];
  const [f, setF] = useState({ fuelType: "", price: "", at: nowLocalInput() });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const fuelType = f.fuelType || types[0]?.code || "";
  const name = (code: string) => types.find((x) => x.code === code)?.name[locale] ?? code;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setMessage(null);
    try {
      await api.call("createCompanyFuelPrice", { body: { fuelType, priceMinor: toMinor(f.price), effectiveFrom: localInputToIso(f.at) } });
      setF({ ...f, price: "" });
      await Promise.all([history.reload(), current.reload()]);
    } catch (err) {
      if (err instanceof ApiRequestError) setErrors(err.fields);
      setMessage(apiErrorMessage(t, err));
    }
  }

  const now = current.data?.items ?? [];
  const missing = types.some((x) => !now.some((p) => p.fuelType === x.code));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={P.title} />
      <p className="text-sm text-muted">{P.companyNote}</p>
      {message && <Alert>{message}</Alert>}
      {current.data && missing && <Alert>{P.missing}</Alert>}
      <Card className="p-0">
        <Table head={[P.type, P.current, P.effective]}>
          {types.map((x) => {
            const p = now.find((c) => c.fuelType === x.code);
            return (
              <tr key={x.code}>
                <Td>{x.name[locale]}</Td>
                <Td className="font-semibold">{p ? `${fromMinor(p.priceMinor)} ${p.currency}` : <span className="text-muted">{P.none}</span>}</Td>
                <Td>{p ? fmtDateTime(p.effectiveFrom, locale) : "—"}</Td>
              </tr>
            );
          })}
        </Table>
      </Card>
      <Card>
        <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-4">
          <Field label={P.type} error={fieldError(t, errors.fuelType)}><Select value={fuelType} onChange={(e) => setF({ ...f, fuelType: e.target.value })}>{types.map((x) => <option key={x.code} value={x.code}>{x.name[locale]}</option>)}</Select></Field>
          <Field label={`${P.price} (${country?.currency ?? ""})`} error={fieldError(t, errors.priceMinor)}><Input type="number" min="0" step={amountStep()} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
          <Field label={P.effective} error={fieldError(t, errors.effectiveFrom)}><Input type="datetime-local" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} /></Field>
          <div className="flex items-end"><Button variant="primary" type="submit" disabled={!f.price || !fuelType}>{P.add}</Button></div>
        </form>
      </Card>
      <Card className="p-0">
        <Table head={[P.type, P.price, P.effective]}>
          {(history.data?.items ?? []).map((p) => (
            <tr key={p.id}>
              <Td>{name(p.fuelType)}</Td>
              <Td>{fromMinor(p.priceMinor)} {p.currency}</Td>
              <Td>{fmtDateTime(p.effectiveFrom, locale)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
