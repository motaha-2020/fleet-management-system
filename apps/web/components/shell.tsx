"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { allows } from "@fleet/domain";
import { useSession } from "@/lib/session";
import { LanguagePicker, useI18n } from "@/lib/i18n";
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

type GroupKey = "platform" | "overview" | "operations" | "fleet" | "finance" | "admin";
/** Every page of the side menu, whatever the role (used to tell "not allowed" from "not a menu page"). */
const ALL_ROUTES = [
  "/platform/tenants", "/platform/fuel-prices", "/platform/ops", "/platform/mail", "/dashboard", "/reports", "/alerts", "/tasks",
  "/customers", "/approvals", "/inspections", "/corrections", "/sync-conflicts", "/vehicles", "/drivers", "/maintenance",
  "/readiness", "/documents", "/vendors", "/fuel", "/costs", "/fines", "/budgets", "/fuel-prices", "/company", "/branches",
  "/users", "/roles", "/policies", "/imports", "/audit",
];

function AccessDenied({ home }: { home: string }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto mt-10 max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-sm" role="alert" data-testid="access-denied">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-warn-bg text-warn">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
      </div>
      <h1 className="mb-2 text-lg font-bold">{t.access.deniedTitle}</h1>
      <p className="mb-6 text-sm text-muted">{t.access.deniedBody}</p>
      <Link href={home} className="inline-flex min-h-10 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-ink">{t.access.back}</Link>
    </div>
  );
}
const GROUP_ICONS: Record<GroupKey, string> = {
  platform: "M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5",
  overview: "M3 3v18h18M7 14l4-4 3 3 5-6",
  operations: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  fleet: "M1 7h15v10H1zM16 10h4l3 3v4h-7zM6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM19 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  finance: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  admin: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
};
function GroupIcon({ name }: { name: GroupKey }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={GROUP_ICONS[name]} /></svg>
  );
}

/** Light / dark (owner, 23 Nov 2026). Starts from the device setting; a choice is remembered on this browser. */
function ThemeToggle() {
  const { t } = useI18n();
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.documentElement.dataset.theme === "dark"); }, []);
  const flip = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("fleet.theme", next); } catch { /* storage may be blocked */ }
    setDark(!dark);
  };
  const label = dark ? t.theme.toLight : t.theme.toDark;
  return (
    <button type="button" onClick={flip} aria-label={label} title={label} data-testid="theme-toggle"
      className="flex h-10 w-10 items-center justify-center rounded-lg border border-line-strong text-ink-2 hover:bg-hover">
      {dark
        ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
        : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>}
    </button>
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

/**
 * Authenticated layout: a side menu in groups (owner, 20 Nov 2026). Items follow the permissions of the
 * current role, as the company configured them; a group with no allowed item is not shown.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, ready, signOut, api } = useSession();
  const { t, locale, picked } = useI18n();
  const router = useRouter();
  const path = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>([]);

  useEffect(() => {
    try { setCollapsed(JSON.parse(localStorage.getItem("nav-collapsed") ?? "[]")); } catch { /* storage may be blocked */ }
  }, []);
  const toggle = (key: string) => setCollapsed((c) => {
    const next = c.includes(key) ? c.filter((k) => k !== key) : [...c, key];
    try { localStorage.setItem("nav-collapsed", JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });
  useEffect(() => setDrawer(false), [path]);

  // A language picked while signed in is saved to the account, so emails and alerts use it too.
  useEffect(() => {
    if (picked && user) api.call("updateAccount", { body: { locale } }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked]);

  useEffect(() => {
    if (ready && !user) router.replace("/login");
    // Drivers use the driver web version (owner decision 14 Nov 2026).
    else if (ready && user?.role === "driver") router.replace("/driver");
  }, [ready, user, router]);

  // Owner decision (14 Nov 2026): after signing in with a temporary password, a new password comes first.
  const mustChange = !!user?.mustChangePassword;
  useEffect(() => {
    if (mustChange && !path.startsWith("/account")) router.replace("/account?required=1");
  }, [mustChange, path, router]);

  if (!ready || !user) return <div className="p-10 text-center text-muted">{t.common.loading}</div>;

  const can = (a: Parameters<typeof allows>[1]) => allows(user, a).allowed;
  const staff = user.role !== "driver";
  type Item = { href: string; label: string };
  const groups: { key: GroupKey; items: (Item | false)[] }[] = [
    { key: "platform", items: [
      can("tenant.manage") && { href: "/platform/tenants", label: t.nav.tenants },
      can("fuel_price.manage") && { href: "/platform/fuel-prices", label: t.nav.fuelPrices },
      can("tenant.manage") && { href: "/platform/ops", label: t.nav.ops },
      can("mail_settings.manage") && { href: "/platform/mail", label: t.mailSettings.nav },
    ] },
    { key: "overview", items: [
      can("report.read") && staff && { href: "/dashboard", label: t.nav.dashboard },
      can("report.read") && { href: "/reports", label: t.nav.reports },
      can("alert.read") && staff && { href: "/alerts", label: t.nav.alerts },
    ] },
    { key: "operations", items: [
      can("task.read") && staff && { href: "/tasks", label: t.nav.tasks },
      (can("customer.read") || can("task.write")) && staff && { href: "/customers", label: t.nav.customers },
      (can("approval.decide") || can("fuel.review")) && { href: "/approvals", label: t.nav.approvals },
      (can("inspection.read") || can("inspection.create")) && staff && { href: "/inspections", label: t.nav.inspections },
      (can("correction.approve") || can("correction.approve_financial")) && { href: "/corrections", label: t.nav.corrections },
      can("sync.conflict_review") && { href: "/sync-conflicts", label: t.nav.syncConflicts },
    ] },
    { key: "fleet", items: [
      can("vehicle.read") && { href: "/vehicles", label: t.nav.vehicles },
      can("driver.read") && { href: "/drivers", label: t.nav.drivers },
      can("maintenance.read") && staff && { href: "/maintenance", label: t.nav.maintenance },
      can("readiness.read") && staff && { href: "/readiness", label: t.nav.readiness },
      can("document.verify") && { href: "/documents", label: t.nav.documents },
      can("vendor.read") && { href: "/vendors", label: t.nav.vendors },
    ] },
    { key: "finance", items: [
      can("fuel.read") && staff && { href: "/fuel", label: t.nav.fuel },
      can("cost.read") && { href: "/costs", label: t.nav.costs },
      can("fine.read") && { href: "/fines", label: t.nav.fines },
      can("fuel.read") && staff && { href: "/budgets", label: t.nav.budgets },
      can("policy.manage") && { href: "/fuel-prices", label: t.nav.fuelPrices },
    ] },
    { key: "admin", items: [
      !!user.tenant && staff && { href: "/company", label: t.nav.company },
      can("branch.write") && { href: "/branches", label: t.nav.branches },
      can("user.manage") && { href: "/users", label: t.nav.users },
      can("role.manage") && { href: "/roles", label: t.nav.roles },
      can("policy.manage") && { href: "/policies", label: t.nav.policies },
      can("import.manage") && { href: "/imports", label: t.nav.imports },
      can("audit.read") && { href: "/audit", label: t.nav.audit },
    ] },
  ];
  const menu = mustChange ? [] : groups
    .map((g) => ({ key: g.key, items: g.items.filter(Boolean) as Item[] }))
    .filter((g) => g.items.length > 0);
  // "/fuel" must not light up on "/fuel-prices".
  const isActive = (href: string) => path === href || path.startsWith(`${href}/`);
  // A known page outside this role (typed URL, old bookmark) says so instead of loading forever.
  const denied = !mustChange && ALL_ROUTES.some(isActive) && !menu.some((g) => g.items.some((i) => isActive(i.href)));
  const home = menu[0]?.items[0]?.href ?? "/account";

  // The side menu is the one bold element of the theme: Carthage-night navy, Sidi Bou Said blue for where you are.
  const sidebar = (
    <nav aria-label={t.navGroups.menu} className="flex-1 overflow-y-auto px-3 py-3">
      {menu.map((g) => {
        const open = g.items.some((i) => isActive(i.href)) || !collapsed.includes(g.key);
        return (
          <div key={g.key} className="mb-1.5">
            <button type="button" aria-expanded={open} aria-controls={`nav-${g.key}`} onClick={() => toggle(g.key)}
              className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-xs font-semibold text-nav-ink/70 hover:bg-nav-2 hover:text-white">
              <GroupIcon name={g.key} />
              <span className="flex-1 text-start">{t.navGroups[g.key]}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`transition-transform ${open ? "" : "ltr:-rotate-90 rtl:rotate-90"}`}><path d="m6 9 6 6 6-6" /></svg>
            </button>
            {open && (
              <ul id={`nav-${g.key}`} className="mb-2 mt-0.5 space-y-0.5">
                {g.items.map((n) => {
                  const here = isActive(n.href);
                  return (
                    <li key={n.href}>
                      <Link href={n.href} aria-current={here ? "page" : undefined}
                        className={`relative flex min-h-10 items-center rounded-lg ps-8 pe-3 text-sm ${here ? "bg-nav-2 font-semibold text-white" : "text-nav-ink hover:bg-nav-2/60 hover:text-white"}`}>
                        {here && <span className="absolute inset-y-2 start-3 w-1 rounded-full bg-nav-mark" aria-hidden="true" />}
                        {n.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );

  const brand = (
    <div className="flex items-center gap-3 px-4 py-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-white"><TruckIcon size={20} /></span>
      <span className="min-w-0">
        <span className="block font-bold leading-tight text-white">{t.app.name}</span>
        {user.tenant && <span className="block truncate text-xs text-nav-ink/80">{user.tenant.name}</span>}
      </span>
    </div>
  );

  // Who is signed in: in the header on wide screens, at the bottom of the drawer on phones.
  const account = (
    <div className="border-t border-white/10 p-3 text-sm">
      <Link href="/account" className="block rounded-lg px-2 py-2 text-white hover:bg-nav-2" data-testid="my-account-drawer">
        <span className="block font-semibold">{user.displayName}</span>
        <span className="block text-xs text-nav-ink/80">{roleLabel(t, locale, user.role, user.roleName)}</span>
      </Link>
      {user.memberships.length > 1 && <div className="mt-2 px-2"><RoleSwitcher /></div>}
    </div>
  );

  return (
    <div className="min-h-screen">
      <SupportBanner />
      <div className="flex">
        {/* Desktop: fixed side menu on the start side (the right in Arabic). */}
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-nav lg:flex">
          <div className="border-b border-white/10">{brand}</div>
          {sidebar}
        </aside>

        {/* Mobile: the same menu as a drawer, with the account at the bottom. */}
        {drawer && <div className="fixed inset-0 z-40 bg-nav/60 lg:hidden" onClick={() => setDrawer(false)} aria-hidden="true" />}
        <aside aria-hidden={!drawer} className={`fixed inset-y-0 start-0 z-50 flex w-72 max-w-[85vw] flex-col bg-nav shadow-2xl transition-transform lg:hidden ${drawer ? "translate-x-0" : "ltr:-translate-x-full rtl:translate-x-full"}`}>
          <div className="flex items-center border-b border-white/10">
            <div className="min-w-0 flex-1">{brand}</div>
            <button type="button" onClick={() => setDrawer(false)} aria-label={t.common.close} className="me-3 flex h-10 w-10 items-center justify-center rounded-lg text-nav-ink hover:bg-nav-2">✕</button>
          </div>
          {drawer && sidebar}
          {drawer && account}
        </aside>

        <div className="min-w-0 flex-1">
          {/* One row on phones: menu, then language, theme and sign-out. */}
          <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
            <div className="flex items-center gap-2 px-4 py-2.5 sm:gap-3">
              <button type="button" onClick={() => setDrawer(true)} aria-label={t.navGroups.menu} aria-expanded={drawer} data-testid="open-menu"
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-line-strong text-ink-2 hover:bg-hover lg:hidden">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
              </button>
              <div className="ms-auto flex items-center gap-2 text-sm sm:gap-3">
                <Link href="/account" className="hidden min-h-10 items-center text-muted hover:text-accent sm:flex" data-testid="my-account">
                  <span className="font-medium text-ink-2">{user.displayName}</span>
                  <span className="ms-2 text-muted">{roleLabel(t, locale, user.role, user.roleName)}</span>
                </Link>
                {user.memberships.length > 1 && <span className="hidden sm:block"><RoleSwitcher /></span>}
                <LanguagePicker />
                <ThemeToggle />
                <Button className="px-3" onClick={async () => { await signOut(); router.replace("/login"); }}>{t.common.logout}</Button>
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-[1600px] px-4 py-6 lg:px-6">{denied ? <AccessDenied home={home} /> : children}</main>
        </div>
      </div>
    </div>
  );
}
