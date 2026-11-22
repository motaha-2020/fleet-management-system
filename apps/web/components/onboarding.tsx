"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { allows } from "@fleet/domain";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useLoad } from "@/lib/use-load";

type StepKey = "profile" | "vehicles" | "drivers" | "documents" | "users";

/**
 * First-run checklist for the company admin (journey simulation, 22 Nov 2026: a new company had no vehicles'
 * documents and 5 of 8 vehicles were restricted, and nothing pointed the admin there). Each step links to its page
 * and ticks itself once the data exists; the card disappears when everything is done or the admin hides it.
 */
export function OnboardingChecklist() {
  const { api, user } = useSession();
  const { t } = useI18n();
  const O = t.onboarding;
  const show = !!user && allows(user, "company.manage").allowed;
  const key = `fleet.onboarding.hidden.${user?.tenant?.id ?? ""}`;
  const [hidden, setHidden] = useState(true);
  useEffect(() => { try { setHidden(localStorage.getItem(key) === "1"); } catch { setHidden(false); } }, [key]);

  const data = useLoad(async () => {
    if (!show) return null;
    const empty = { items: [] as unknown[] };
    const [company, vehicles, drivers, users, documents] = await Promise.all([
      api.call("getCompany"),
      api.call("listVehicles").catch(() => empty),
      api.call("listDrivers").catch(() => empty),
      api.call("listUsers").catch(() => empty),
      api.call("listDocuments", { query: {} }).catch(() => empty),
    ]);
    const done: Record<StepKey, boolean> = {
      profile: !!(company.address && company.phone),
      vehicles: vehicles.items.length > 0,
      drivers: drivers.items.length > 0,
      documents: documents.items.length > 0,
      users: users.items.length > 1,
    };
    return done;
  }, [api, show]);

  if (!show || hidden || !data.data) return null;
  const steps: { key: StepKey; href: string }[] = [
    { key: "profile", href: "/company" }, { key: "vehicles", href: "/vehicles" }, { key: "drivers", href: "/drivers" },
    { key: "documents", href: "/documents" }, { key: "users", href: "/users" },
  ];
  const doneCount = steps.filter((s) => data.data![s.key]).length;
  if (doneCount === steps.length) return null;

  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-accent/30 bg-surface" data-testid="onboarding" aria-labelledby="onboarding-title">
      <div className="flex flex-wrap items-start gap-3 border-b border-line bg-accent-soft/60 px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 id="onboarding-title" className="font-bold text-ink">{O.title}</h2>
          <p className="text-sm text-muted">{O.hint}</p>
        </div>
        <span className="text-sm font-semibold text-accent-ink">{O.progress.replace("{done}", String(doneCount)).replace("{total}", String(steps.length))}</span>
        <button type="button" className="min-h-10 rounded-lg px-3 text-sm font-semibold text-muted hover:bg-hover"
          onClick={() => { setHidden(true); try { localStorage.setItem(key, "1"); } catch { /* storage may be blocked */ } }}>{O.dismiss}</button>
      </div>
      <div className="h-1 bg-line-2" aria-hidden="true"><div className="h-full bg-accent transition-[width]" style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>
      <ol className="divide-y divide-line-2">
        {steps.map((s) => {
          const ok = data.data![s.key];
          return (
            <li key={s.key}>
              <Link href={s.href} className="flex min-h-12 items-center gap-3 px-5 py-2.5 hover:bg-hover">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${ok ? "border-ok bg-ok text-surface" : "border-line-strong text-transparent"}`} aria-hidden="true">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>
                </span>
                <span className={`text-sm ${ok ? "text-muted line-through" : "font-medium text-ink"}`}>{O.steps[s.key]}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
