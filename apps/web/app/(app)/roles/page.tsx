"use client";
import { useEffect, useState, type FormEvent } from "react";
import { ApiRequestError, type CompanyRole } from "@fleet/contracts";
import type { Action } from "@fleet/config";
import { fieldError } from "@fleet/i18n";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { apiErrorMessage } from "@/lib/errors";

type Perms = Partial<Record<Action, "all" | "branches">>;

/**
 * Owner decision (14 Nov 2026): the company admin decides what each office role may do and makes roles of their own.
 * The company admin and driver roles are shown for reference and cannot change; managing people and permissions
 * stays with the company admin.
 */
export default function RolesPage() {
  const { api } = useSession();
  const { t, locale } = useI18n();
  const R = t.rolesPage;
  const roles = useLoad(() => api.call("listRoles"), [api]);
  const [selected, setSelected] = useState<string>("fleet_manager");
  const [draft, setDraft] = useState<Perms>({});
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ nameAr: "", nameEn: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const role = roles.data?.items.find((r) => r.id === selected) ?? null;
  useEffect(() => {
    if (role) { setDraft(role.permissions as Perms); setDirty(false); }
  }, [role]);

  const name = (r: CompanyRole) => (locale === "ar" ? r.nameAr : r.nameEn);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setMessage(null);
    setErrors({});
    try {
      await fn();
      await roles.reload();
      if (ok) setMessage({ tone: "ok", text: ok });
      return true;
    } catch (err) {
      if (err instanceof ApiRequestError) setErrors(err.fields);
      setMessage({ tone: "bad", text: apiErrorMessage(t, err) });
      return false;
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    let id = "";
    if (await run(async () => { id = (await api.call("createRole", { body: { ...form, permissions: {} } })).id; }, R.created)) {
      setCreating(false);
      setForm({ nameAr: "", nameEn: "" });
      setSelected(id);
    }
  }

  const setScope = (a: Action, v: string) => {
    const next = { ...draft };
    if (v === "all" || v === "branches") next[a] = v; else delete next[a];
    setDraft(next);
    setDirty(true);
  };

  return (
    <>
      <PageHeader title={R.title} action={!creating && <Button variant="primary" onClick={() => setCreating(true)}>+ {R.newRole}</Button>} />
      <p className="mb-4 text-sm text-muted">{R.intro}</p>
      {message && <div className="mb-4"><Alert tone={message.tone}>{message.text}</Alert></div>}
      {creating && (
        <Card className="mb-6">
          <form onSubmit={create} noValidate>
            <h2 className="mb-4 text-lg font-bold">{R.newRole}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={R.nameAr} error={fieldError(t, errors.nameAr)}><Input value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} required /></Field>
              <Field label={R.nameEn} error={fieldError(t, errors.nameEn)}><Input dir="ltr" value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} required /></Field>
            </div>
            <p className="mt-3 text-xs text-muted">{R.newRoleHelp}</p>
            <div className="mt-5 flex gap-2">
              <Button variant="primary" type="submit">{t.common.save}</Button>
              <Button type="button" onClick={() => setCreating(false)}>{t.common.cancel}</Button>
            </div>
          </form>
        </Card>
      )}
      {!roles.data ? <p className="text-muted">{t.common.loading}</p> : (
        <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
          <Card className="p-2">
            <ul className="flex flex-col gap-1" role="listbox" aria-label={R.title}>
              {roles.data.items.map((r) => (
                <li key={r.id}>
                  <button type="button" role="option" aria-selected={r.id === selected} onClick={() => setSelected(r.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-start text-sm ${r.id === selected ? "bg-accent-soft text-accent-ink" : "hover:bg-[#EEF2F6]"}`}>
                    <span className="font-medium">{name(r)}</span>
                    <span className="flex items-center gap-1">
                      {r.locked && <Badge tone="info">{R.locked}</Badge>}
                      {r.status === "inactive" && <Badge tone="bad">{R.inactive}</Badge>}
                      <span className="text-xs text-muted" title={R.members}>{r.members}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          {role && (
            <Card>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold">{name(role)}</h2>
                {role.kind === "custom" && <Badge tone="info">{R.custom}</Badge>}
                {role.customized && role.kind === "system" && <Badge tone="warn">{R.changed}</Badge>}
                <div className="ms-auto flex flex-wrap gap-2">
                  {!role.locked && <Button variant="primary" disabled={!dirty} onClick={() => void run(() => api.call("updateRole", { params: { id: role.id }, body: { permissions: draft } }), R.saved)}>{t.common.save}</Button>}
                  {role.kind === "system" && role.customized && <Button onClick={() => void run(() => api.call("resetRole", { params: { id: role.id } }), R.wasReset)}>{R.reset}</Button>}
                  {role.kind === "custom" && (
                    <Button onClick={() => void run(() => api.call("updateRole", { params: { id: role.id }, body: { status: role.status === "active" ? "inactive" : "active" } }))}>
                      {role.status === "active" ? R.switchOff : R.switchOn}
                    </Button>
                  )}
                </div>
              </div>
              {role.locked && <div className="mb-4"><Alert tone="info">{role.id === "driver" ? R.driverLocked : R.adminLocked}</Alert></div>}
              <div className="flex flex-col gap-6">
                {roles.data.groups.map((g) => (
                  <section key={g.key}>
                    <h3 className="mb-2 text-sm font-bold text-ink-2">{R.groups[g.key as keyof typeof R.groups] ?? g.key}</h3>
                    <div className="divide-y divide-line rounded-lg border border-line">
                      {g.actions.map((a) => {
                        const v = (role.locked ? role.permissions[a] : draft[a]) ?? "";
                        return (
                          <div key={a} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                            <label htmlFor={`p-${a}`}>{(t.actions as Record<string, string>)[a] ?? a}</label>
                            {role.locked ? (
                              <span className={v ? "text-ink" : "text-muted"}>{v ? R.scopes[v as keyof typeof R.scopes] : R.scopes.none}</span>
                            ) : (
                              <Select id={`p-${a}`} className="min-h-8 w-auto py-1" value={v} onChange={(e) => setScope(a, e.target.value)}>
                                <option value="">{R.scopes.none}</option>
                                <option value="branches">{R.scopes.branches}</option>
                                <option value="all">{R.scopes.all}</option>
                              </Select>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
