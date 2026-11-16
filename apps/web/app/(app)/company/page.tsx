"use client";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { ApiRequestError } from "@fleet/contracts";
import { allows } from "@fleet/domain";
import { fieldError } from "@fleet/i18n";
import { Alert, Button, Card, Field, Input, PageHeader } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { apiErrorMessage } from "@/lib/errors";

const FIELDS = ["address", "phone", "email", "commercialRegister", "taxNumber"] as const;

/** Owner decision (14 Nov 2026): the company admin keeps the company profile up to date; everyone else sees it. */
function Company() {
  const { api, user } = useSession();
  const { t } = useI18n();
  const C = t.company;
  const welcome = useSearchParams().get("welcome") === "1";
  const canEdit = allows(user, "company.manage").allowed;
  const company = useLoad(() => api.call("getCompany"), [api]);
  const [form, setForm] = useState<Record<"name" | (typeof FIELDS)[number], string>>({ name: "", address: "", phone: "", email: "", commercialRegister: "", taxNumber: "" });
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  useEffect(() => {
    const c = company.data;
    if (!c) return;
    setForm({ name: c.name, address: c.address ?? "", phone: c.phone ?? "", email: c.email ?? "", commercialRegister: c.commercialRegister ?? "", taxNumber: c.taxNumber ?? "" });
    let url: string | null = null;
    if (c.hasLogo) {
      void api.download("companyLogo", {}).then(async (r) => { url = URL.createObjectURL(await r.blob()); setLogoUrl(url); }).catch(() => setLogoUrl(null));
    } else setLogoUrl(null);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [company.data, api]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setMessage(null);
    setErrors({});
    try {
      await fn();
      await company.reload();
      setMessage({ tone: "ok", text: ok });
    } catch (err) {
      if (err instanceof ApiRequestError) setErrors(err.fields);
      setMessage({ tone: "bad", text: apiErrorMessage(t, err) });
    }
  }

  const save = (e: FormEvent) => {
    e.preventDefault();
    void run(() => api.call("updateCompany", { body: { name: form.name, ...Object.fromEntries(FIELDS.map((k) => [k, form[k] || null])) } }), C.saved);
  };

  const c = company.data;
  return (
    <>
      <PageHeader title={C.title} />
      {welcome && <div className="mb-4"><Alert tone="ok">{C.welcome}</Alert></div>}
      {message && <div className="mb-4"><Alert tone={message.tone}>{message.text}</Alert></div>}
      {!c ? <p className="text-muted">{t.common.loading}</p> : (
        <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
          <Card>
            <form onSubmit={save} noValidate className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label={C.name} error={fieldError(t, errors.name)}><Input required disabled={!canEdit} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              </div>
              {FIELDS.map((k) => (
                <div key={k} className={k === "address" ? "sm:col-span-2" : ""}>
                  <Field label={C[k]} error={fieldError(t, errors[k])}>
                    <Input disabled={!canEdit} dir={k === "address" ? undefined : "ltr"} type={k === "email" ? "email" : "text"} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                  </Field>
                </div>
              ))}
              <p className="text-sm text-muted sm:col-span-2">{C.fixed}: {c.countryCode} · {c.currency} · <span dir="ltr">{c.timezone}</span></p>
              {canEdit && <div className="sm:col-span-2"><Button variant="primary" type="submit">{t.common.save}</Button></div>}
            </form>
          </Card>
          <Card className="flex flex-col items-center gap-3">
            <h2 className="self-start text-sm font-bold text-ink-2">{C.logo}</h2>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {logoUrl ? <img src={logoUrl} alt={C.logo} className="max-h-32 max-w-full rounded-lg object-contain" /> : <div className="flex h-32 w-full items-center justify-center rounded-lg border border-dashed border-line text-sm text-muted">{C.noLogo}</div>}
            {canEdit && (
              <label className="cursor-pointer text-sm font-semibold text-accent hover:underline">
                {c.hasLogo ? C.changeLogo : C.uploadLogo}
                <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void run(() => api.upload("uploadCompanyLogo", {}, file, file.name), C.logoSaved);
                }} />
              </label>
            )}
            {canEdit && <p className="text-center text-xs text-muted">{C.logoHint}</p>}
          </Card>
        </div>
      )}
    </>
  );
}

export default function CompanyPage() {
  return <Suspense><Company /></Suspense>;
}
