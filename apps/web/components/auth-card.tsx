"use client";
import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { TruckIcon } from "./shell";
import { Button } from "./ui";

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  const { t, locale, setLocale } = useI18n();
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2 text-accent"><TruckIcon size={32} /><span className="text-lg font-bold text-ink">{t.app.name}</span></div>
          <Button variant="ghost" onClick={() => setLocale(locale === "ar" ? "en" : "ar")}>{t.app.switchLang}</Button>
        </div>
        <div className="rounded-xl border border-line bg-surface p-6">
          <h1 className="mb-5 text-xl font-bold">{title}</h1>
          {children}
        </div>
      </div>
    </div>
  );
}
