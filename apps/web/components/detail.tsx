"use client";
import type { ReactNode } from "react";

export function DetailGrid({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="mt-0.5 text-sm font-medium">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
