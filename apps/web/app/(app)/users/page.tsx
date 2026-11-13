"use client";
import { useMemo, useState, type FormEvent } from "react";
import { ApiRequestError, type InviteLink, type TenantUser } from "@fleet/contracts";
import { fieldError } from "@fleet/i18n";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { useSession } from "@/lib/session";
import { SupportRequests } from "@/components/support-access";
import { ResendInviteResult } from "@/components/resend-invite";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";
import { apiErrorMessage } from "@/lib/errors";

const STAFF = ["company_admin", "fleet_manager", "finance_reviewer", "viewer"] as const;

function BranchPicker({ branches, value, onChange }: { branches: { id: string; name: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-3">
      {branches.map((b) => (
        <label key={b.id} className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={value.includes(b.id)} onChange={(e) => onChange(e.target.checked ? [...value, b.id] : value.filter((x) => x !== b.id))} />
          {b.name}
        </label>
      ))}
    </div>
  );
}

export default function UsersPage() {
  const { api, user } = useSession();
  const { t } = useI18n();
  const U = t.users;
  const [resetLink, setResetLink] = useState<{ name: string; link: string; emailed: boolean } | null>(null);
  /** A password reset link for a colleague (works even when email does not): the admin sends it. */
  async function makeResetLink(u: TenantUser) {
    try {
      const r = await api.call("userResetLink", { params: { id: u.membershipId } });
      setResetLink({ name: u.displayName, link: r.link, emailed: r.emailed });
    } catch (err) {
      setResetLink(null);
      setMessage({ tone: "bad", text: apiErrorMessage(t, err) });
    }
  }
  const [resent, setResent] = useState<InviteLink | null>(null);
  async function resendInvite(u: TenantUser) {
    setMessage(null);
    try {
      setResent(await api.call("resendUserInvite", { params: { id: u.membershipId } }));
    } catch (err) {
      setResent(null);
      setMessage({ tone: "bad", text: apiErrorMessage(t, err) });
    }
  }
  const users = useLoad(() => api.call("listUsers"), [api]);
  const branches = useLoad(() => api.call("listBranches"), [api]);
  const branchName = useMemo(() => new Map(branches.data?.items.map((b) => [b.id, b.name]) ?? []), [branches.data]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: "", displayName: "", role: "fleet_manager" as (typeof STAFF)[number], branchIds: [] as string[] });
  const [editing, setEditing] = useState<TenantUser | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "ok" | "bad" | "info"; text: string } | null>(null);
  const [invite, setInvite] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setMessage(null);
    setErrors({});
    try {
      await fn();
      await users.reload();
      return true;
    } catch (err) {
      if (err instanceof ApiRequestError) setErrors(err.fields);
      setMessage({ tone: "bad", text: apiErrorMessage(t, err) });
      return false;
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const r = await api.call("inviteUser", { body: { ...form, branchIds: form.role === "fleet_manager" ? form.branchIds : [] } });
      setOpen(false);
      setForm({ email: "", displayName: "", role: "fleet_manager", branchIds: [] });
      if (r.inviteToken) setInvite(`${window.location.origin}/accept-invite?token=${encodeURIComponent(r.inviteToken)}`);
      else setMessage({ tone: "info", text: U.addedRole });
    });
  }

  const activeBranches = branches.data?.items.filter((b) => b.status === "active") ?? [];
  return (
    <>
      <PageHeader title={U.title} action={!open && <Button variant="primary" onClick={() => setOpen(true)}>+ {U.invite}</Button>} />
      {message && <div className="mb-4"><Alert tone={message.tone}>{message.text}</Alert></div>}
      {resent && <ResendInviteResult r={resent} onClose={() => setResent(null)} />}
      {resetLink && (
        <Card className="mb-6 border-accent">
          <p className="mb-2 text-sm font-medium">{resetLink.name} — {U.resetLinkMade}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code dir="ltr" className="min-w-0 flex-1 break-all rounded-lg bg-[#EEF1F4] px-3 py-2 text-xs" data-testid="reset-link">{resetLink.link}</code>
            <Button onClick={() => void navigator.clipboard?.writeText(resetLink.link)}>{t.common.copy}</Button>
            <Button variant="ghost" onClick={() => setResetLink(null)}>{t.common.close}</Button>
          </div>
          {resetLink.emailed && <p className="mt-2 text-xs text-muted">{U.resetLinkEmailed}</p>}
        </Card>
      )}
      {invite && (
        <Card className="mb-6 border-accent">
          <p className="mb-2 text-sm font-medium">{U.inviteLink}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code dir="ltr" className="min-w-0 flex-1 break-all rounded-lg bg-[#EEF1F4] px-3 py-2 text-xs" data-testid="invite-link">{invite}</code>
            <Button onClick={() => void navigator.clipboard?.writeText(invite)}>{t.common.copy}</Button>
            <Button variant="ghost" onClick={() => setInvite(null)}>{t.common.close}</Button>
          </div>
        </Card>
      )}
      {open && (
        <Card className="mb-6">
          <form onSubmit={submit} noValidate>
            <h2 className="mb-4 text-lg font-bold">{U.invite}</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={U.name} error={fieldError(t, errors.displayName)}><Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required /></Field>
              <Field label={U.email} error={fieldError(t, errors.email)}><Input dir="ltr" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></Field>
              <Field label={U.role} error={fieldError(t, errors.role)}>
                <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as (typeof STAFF)[number] })}>{STAFF.map((r) => <option key={r} value={r}>{t.roles[r]}</option>)}</Select>
              </Field>
              {form.role === "fleet_manager" && (
                <div className="sm:col-span-3">
                  <Field label={U.branches} error={fieldError(t, errors.branchIds)}><BranchPicker branches={activeBranches} value={form.branchIds} onChange={(branchIds) => setForm({ ...form, branchIds })} /></Field>
                </div>
              )}
            </div>
            <div className="mt-5 flex gap-2">
              <Button variant="primary" type="submit">{t.common.save}</Button>
              <Button type="button" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
            </div>
          </form>
        </Card>
      )}
      {editing && (
        <Card className="mb-6">
          <form onSubmit={async (e) => { e.preventDefault(); if (await run(() => api.call("updateUser", { params: { id: editing.membershipId }, body: { role: editing.role as (typeof STAFF)[number], branchIds: editing.role === "fleet_manager" ? editing.branchIds : [] } }))) setEditing(null); }}>
            <h2 className="mb-4 text-lg font-bold">{U.edit} — {editing.displayName}</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={U.role}>
                <Select value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value as TenantUser["role"] })}>{STAFF.map((r) => <option key={r} value={r}>{t.roles[r]}</option>)}</Select>
              </Field>
              {editing.role === "fleet_manager" && (
                <div className="sm:col-span-2">
                  <Field label={U.branches} error={fieldError(t, errors.branchIds)}><BranchPicker branches={activeBranches} value={editing.branchIds} onChange={(branchIds) => setEditing({ ...editing, branchIds })} /></Field>
                </div>
              )}
            </div>
            <div className="mt-5 flex gap-2">
              <Button variant="primary" type="submit">{t.common.save}</Button>
              <Button type="button" onClick={() => setEditing(null)}>{t.common.cancel}</Button>
            </div>
          </form>
        </Card>
      )}
      <Card className="p-0">
        {!users.data ? <p className="p-6 text-muted">{t.common.loading}</p> : (
          <Table head={[U.name, U.email, U.role, U.branches, U.status, ""]}>
            {users.data.items.map((u) => {
              const self = u.membershipId === user?.currentMembershipId;
              return (
                <tr key={u.membershipId}>
                  <Td className="font-semibold">{u.displayName}</Td>
                  <Td><span dir="ltr">{u.email}</span></Td>
                  <Td>{t.roles[u.role]}</Td>
                  <Td>{u.role === "fleet_manager" ? u.branchIds.map((b) => branchName.get(b) ?? "—").join("، ") : "—"}</Td>
                  <Td>{u.invitePending ? <Badge tone="info">{U.pending}</Badge> : <Badge tone={u.active ? "ok" : "bad"}>{u.active ? U.active : U.inactive}</Badge>}</Td>
                  <Td>
                    {!self && (
                      <div className="flex flex-wrap gap-1">
                        <Button variant="ghost" className="min-h-8 px-2" onClick={() => setEditing(u)}>{U.edit}</Button>
                        <Button variant="ghost" className="min-h-8 px-2" onClick={() => run(() => api.call("updateUser", { params: { id: u.membershipId }, body: { active: !u.active } }))}>{u.active ? U.deactivate : U.activate}</Button>
                        {u.invitePending && <Button variant="ghost" className="min-h-8 px-2" onClick={() => void resendInvite(u)}>{t.resendInvite.button}</Button>}
                        {u.active && !u.invitePending && <Button variant="ghost" className="min-h-8 px-2" onClick={() => void makeResetLink(u)}>{U.resetLink}</Button>}
                      </div>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
      <SupportRequests />
    </>
  );
}
