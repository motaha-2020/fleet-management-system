"use client";
import type { ReactNode } from "react";
import { LanguagePicker, useI18n } from "@/lib/i18n";
import { TruckIcon } from "./shell";

/** Sign-in pages: the side menu's navy band carries the brand; the card sits over it (same identity before and after sign-in). */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="relative min-h-screen px-4 pb-10">
      <div className="absolute inset-x-0 top-0 h-56 bg-nav" aria-hidden="true" />
      <div className="relative mx-auto w-full max-w-sm pt-8">
        <div className="mb-8 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-white"><TruckIcon size={22} /></span>
            <span className="text-lg font-bold text-white">{t.app.name}</span>
          </div>
          <LanguagePicker />
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-xl shadow-nav/10">
          <h1 className="mb-5 text-xl font-bold">{title}</h1>
          {children}
        </div>
      </div>
    </div>
  );
}
