"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { allows } from "@fleet/domain";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { apiErrorMessage } from "@/lib/errors";
import { Button, Select } from "./ui";
import { SupportBanner } from "./support-access";
import { roleLabel } from "@/lib/roles";

export function TruckIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1" y="7" width="15" height="10" rx="2" /><path d="M16 10h4l3 3v4h-7z" /><circle cx="6" cy="18" r="2" /><circle cx="19" cy="18" r="2" />
    </svg>
  );
}

/** SEC-002: one active role at a time. */
function RoleSwitcher() {
  const { user, api, signIn } = useSession();
  const { t, locale } = useI18n();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  if (!user || user.memberships.length < 2) return null;

  async function go(membershipId: string) {
    setError(null);
    try {
      signIn(await api.call("switchRole", { body: { membershipId } }));
      router.replace("/vehicles");
    } catch (err) {
      setError(apiErrorMessage(t, err));
    }
  }

  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor="role-switch">{t.roleSwitch.label}</label>
      <Select id="role-switch" value={user.currentMembershipId ?? ""} className="min-h-9 w-auto py-1" onChange={(e) => void go(e.target.value)}>
        {user.memberships.map((m) => <option key={m.id} value={m.id}>{roleLabel(t, locale, m.role, m.roleName)} · {m.tenantName}</option>)}
      </Select>
      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  );
}

/** Authenticated layout. Nav items follow the permissions of the current role, as the company configured them. */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, ready, signOut } = useSession();
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();
  const path = usePathname();

  useEffect(() => {
    if (ready && !user) router.replace("/login");
  }, [ready, user, router]);

  if (!ready || !user) return <div className="p-10 text-center text-muted">{t.common.loading}</div>;

  const can = (a: Parameters<typeof allows>[1]) => allows(user, a).allowed;
  const nav = [
    can("tenant.manage") && { href: "/platform/tenants", label: t.nav.tenants },
    can("fuel_price.manage") && { href: "/platform/fuel-prices", label: t.nav.fuelPrices },
    can("tenant.manage") && { href: "/platform/ops", label: t.nav.ops },
    can("mail_settings.manage") && { href: "/platform/mail", label: t.mailSettings.nav },
    can("report.read") && user.role !== "driver" && { href: "/dashboard", label: t.nav.dashboard },
    can("vehicle.read") && { href: "/vehicles", label: t.nav.vehicles },
    can("driver.read") && { href: "/drivers", label: t.nav.drivers },
    can("fuel.read") && user.role !== "driver" && { href: "/fuel", label: t.nav.fuel },
    can("maintenance.read") && user.role !== "driver" && { href: "/maintenance", label: t.nav.maintenance },
    can("readiness.read") && user.role !== "driver" && { href: "/readiness", label: t.nav.readiness },
    can("cost.read") && { href: "/costs", label: t.nav.costs },
    can("fine.read") && { href: "/fines", label: t.nav.fines },
    can("fuel.read") && user.role !== "driver" && { href: "/budgets", label: t.nav.budgets },
    can("alert.read") && user.role !== "driver" && { href: "/alerts", label: t.nav.alerts },
    can("report.read") && { href: "/reports", label: t.nav.reports },
    can("import.manage") && { href: "/imports", label: t.nav.imports },
    can("policy.manage") && { href: "/policies", label: t.nav.policies },
    (can("correction.approve") || can("correction.approve_financial")) && { href: "/corrections", label: t.nav.corrections },
    can("sync.conflict_review") && { href: "/sync-conflicts", label: t.nav.syncConflicts },
    can("document.verify") && { href: "/documents", label: t.nav.documents },
    can("vendor.read") && { href: "/vendors", label: t.nav.vendors },
    can("branch.write") && { href: "/branches", label: t.nav.branches },
    can("user.manage") && { href: "/users", label: t.nav.users },
    can("role.manage") && { href: "/roles", label: t.nav.roles },
    can("audit.read") && { href: "/audit", label: t.nav.audit },
  ].filter(Boolean) as { href: string; label: string }[];

  return (
    <div className="min-h-screen">
      <SupportBanner />
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-2 text-accent">
            <TruckIcon />
            <span className="font-bold text-ink">{t.app.name}</span>
          </div>
          <div className="ms-auto flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted">{user.displayName}{user.tenant ? ` · ${user.tenant.name}` : ""}</span>
            {user.memberships.length > 1 ? <RoleSwitcher /> : <span className="text-muted">{roleLabel(t, locale, user.role, user.roleName)}</span>}
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

