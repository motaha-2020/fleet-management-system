"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { MFA_REQUIRED_ROLES } from "@fleet/config";
import { authorize } from "@fleet/domain";
import { ApiRequestError } from "@fleet/contracts";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { apiErrorMessage } from "@/lib/errors";
import { Button, Input, Select } from "./ui";

export function TruckIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1" y="7" width="15" height="10" rx="2" /><path d="M16 10h4l3 3v4h-7z" /><circle cx="6" cy="18" r="2" /><circle cx="19" cy="18" r="2" />
    </svg>
  );
}

/** SEC-002: one active role at a time; switching into an MFA role asks for a code. */
function RoleSwitcher() {
  const { user, api, signIn } = useSession();
  const { t } = useI18n();
  const router = useRouter();
  const [target, setTarget] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!user || user.memberships.length < 2) return null;

  async function go(membershipId: string, withCode?: string) {
    setError(null);
    try {
      const r = await api.call("switchRole", { body: { membershipId, ...(withCode ? { code: withCode } : {}) } });
      signIn(r);
      setTarget(null);
      setCode("");
      router.replace("/vehicles");
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "mfa_required") setTarget(membershipId);
      else setError(apiErrorMessage(t, err));
    }
  }

  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor="role-switch">{t.roleSwitch.label}</label>
      <Select id="role-switch" value={user.currentMembershipId ?? ""} className="min-h-9 w-auto py-1"
        onChange={(e) => {
          const m = user.memberships.find((x) => x.id === e.target.value);
          if (!m) return;
          if ((MFA_REQUIRED_ROLES as readonly string[]).includes(m.role)) setTarget(m.id);
          else void go(m.id);
        }}>
        {user.memberships.map((m) => <option key={m.id} value={m.id}>{t.roles[m.role]} · {m.tenantName}</option>)}
      </Select>
      {target && (
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void go(target, code); }}>
          <Input dir="ltr" inputMode="numeric" maxLength={6} placeholder="000000" aria-label={t.mfa.switchCode} value={code} onChange={(e) => setCode(e.target.value)} className="min-h-9 w-28 text-center font-mono" />
          <Button type="submit" variant="primary" className="min-h-9">{t.roleSwitch.switch}</Button>
        </form>
      )}
      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  );
}

/** Authenticated layout. Nav items come from the same RBAC matrix the API enforces. */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, ready, signOut } = useSession();
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();
  const path = usePathname();

  useEffect(() => {
    if (ready && !user) router.replace("/login");
  }, [ready, user, router]);

  if (!ready || !user) return <div className="p-10 text-center text-muted">{t.common.loading}</div>;

  const can = (a: Parameters<typeof authorize>[1]) => authorize(user.role, a).allowed;
  const nav = [
    can("tenant.manage") && { href: "/platform/tenants", label: t.nav.tenants },
    can("fuel_price.manage") && { href: "/platform/fuel-prices", label: t.nav.fuelPrices },
    can("vehicle.read") && { href: "/vehicles", label: t.nav.vehicles },
    can("driver.read") && { href: "/drivers", label: t.nav.drivers },
    can("fuel.review") && { href: "/fuel", label: t.nav.fuel },
    can("cost.read") && { href: "/costs", label: t.nav.costs },
    can("correction.approve") && { href: "/corrections", label: t.nav.corrections },
    can("sync.conflict_review") && { href: "/sync-conflicts", label: t.nav.syncConflicts },
    can("document.verify") && { href: "/documents", label: t.nav.documents },
    can("vendor.read") && { href: "/vendors", label: t.nav.vendors },
    can("branch.write") && { href: "/branches", label: t.nav.branches },
    can("user.manage") && { href: "/users", label: t.nav.users },
    can("audit.read") && { href: "/audit", label: t.nav.audit },
  ].filter(Boolean) as { href: string; label: string }[];

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-2 text-accent">
            <TruckIcon />
            <span className="font-bold text-ink">{t.app.name}</span>
          </div>
          <div className="ms-auto flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted">{user.displayName}{user.tenant ? ` · ${user.tenant.name}` : ""}</span>
            {user.memberships.length > 1 ? <RoleSwitcher /> : <span className="text-muted">{t.roles[user.role]}</span>}
            <Button variant="ghost" onClick={() => setLocale(locale === "ar" ? "en" : "ar")}>{t.app.switchLang}</Button>
            <Button onClick={async () => { await signOut(); router.replace("/login"); }}>{t.common.logout}</Button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2">
          {nav.map((n) => (
            <Link key={n.href} href={n.href}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${path.startsWith(n.href) ? "bg-accent-soft text-accent-ink" : "text-ink-2 hover:bg-[#EEF2F6]"}`}>
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

