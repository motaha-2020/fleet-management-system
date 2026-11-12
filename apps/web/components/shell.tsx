"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { authorize } from "@fleet/domain";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { Button } from "./ui";

export function TruckIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1" y="7" width="15" height="10" rx="2" /><path d="M16 10h4l3 3v4h-7z" /><circle cx="6" cy="18" r="2" /><circle cx="19" cy="18" r="2" />
    </svg>
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

  const nav = [
    authorize(user.role, "tenant.manage").allowed && { href: "/platform/tenants", label: t.nav.tenants },
    authorize(user.role, "vehicle.read").allowed && { href: "/vehicles", label: t.nav.vehicles },
    authorize(user.role, "driver.read").allowed && { href: "/drivers", label: t.nav.drivers },
  ].filter(Boolean) as { href: string; label: string }[];

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-2 text-accent">
            <TruckIcon />
            <span className="font-bold text-ink">{t.app.name}</span>
          </div>
          <nav className="flex gap-1">
            {nav.map((n) => (
              <Link key={n.href} href={n.href}
                className={`rounded-lg px-3 py-2 text-sm font-medium ${path.startsWith(n.href) ? "bg-accent-soft text-accent-ink" : "text-ink-2 hover:bg-[#EEF2F6]"}`}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ms-auto flex items-center gap-3 text-sm">
            <span className="text-muted">
              {user.displayName} · {t.roles[user.role]}{user.tenant ? ` · ${user.tenant.name}` : ""}
            </span>
            <Button variant="ghost" onClick={() => setLocale(locale === "ar" ? "en" : "ar")}>{t.app.switchLang}</Button>
            <Button onClick={async () => { await signOut(); router.replace("/login"); }}>{t.common.logout}</Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
