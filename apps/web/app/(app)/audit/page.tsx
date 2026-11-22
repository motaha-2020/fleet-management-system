"use client";
import { useEffect, useState } from "react";
import type { AuditEntry } from "@fleet/contracts";
import { Alert, Button, Card, PageHeader, Table, Td } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { apiErrorMessage } from "@/lib/errors";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import type { Locale, Messages } from "@fleet/i18n";

/**
 * The change in words people read (journey simulation, 22 Nov 2026: raw field names, "null" and millimes were shown).
 * Field names come from the screens' own labels; money is shown in the company's currency; ids and empty values are left out.
 */
function summary(e: AuditEntry, t: Messages, locale: Locale): string {
  const v = (e.after ?? e.before) as Record<string, unknown> | null;
  if (!v || typeof v !== "object") return "";
  const groups = [t.vehicles, t.drivers, t.driver, t.m2.fuel, t.m2.costs, t.users, t.branches, t.company] as unknown as Record<string, unknown>[];
  const label = (k: string) => {
    for (const key of [k, k.replace(/Minor$/, "")]) for (const g of groups) if (typeof g?.[key] === "string") return g[key] as string;
    return k.replace(/Minor$/, "").replace(/([A-Z])/g, " $1").toLowerCase();
  };
  const value = (k: string, x: unknown) => {
    if (typeof x === "number" && k.endsWith("Minor")) return fmtMoney(x, undefined, locale);
    if (typeof x === "boolean") return x ? "✓" : "✗";
    if (Array.isArray(x)) return x.join("، ");
    if (typeof x === "object") return null;
    return String(x);
  };
  return Object.entries(v)
    .filter(([k, x]) => x != null && x !== "" && !(Array.isArray(x) && !x.length) && k !== "id" && !k.endsWith("Id"))
    .map(([k, x]) => [label(k), value(k, x)] as const)
    .filter(([, x]) => x != null)
    .slice(0, 4).map(([k, x]) => `${k}: ${x}`).join(" · ");
}

export default function AuditPage() {
  const { api } = useSession();
  const { t, locale } = useI18n();
  const A = t.audit;
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(before?: number) {
    setLoading(true);
    try {
      const r = await api.call("listAudit", { query: { limit: 50, ...(before ? { before } : {}) } });
      setItems((cur) => (before ? [...cur, ...r.items] : r.items));
      setNext(r.nextBefore);
    } catch (err) {
      setError(apiErrorMessage(t, err));
    } finally {
      setLoading(false);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [api]);

  return (
    <>
      <PageHeader title={A.title} />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      <Card className="p-0">
        {!items.length && !loading ? <p className="p-6 text-muted">{A.empty}</p> : (
          <Table head={[A.at, A.actor, A.action, A.entity, A.details]}>
            {items.map((e) => (
              <tr key={e.id}>
                <Td>{fmtDateTime(e.at, locale)}</Td>
                <Td className="whitespace-normal">{e.actorName ?? "—"}</Td>
                <Td className="whitespace-normal"><code dir="ltr" className="break-all text-xs">{e.action}</code></Td>
                <Td><span className="text-xs text-muted">{e.entityType ?? "—"}</span></Td>
                <Td className="max-w-xs whitespace-normal text-xs text-muted">{summary(e, t, locale)}</Td>
              </tr>
            ))}
          </Table>
        )}
        {next && <div className="p-4"><Button onClick={() => load(next)} disabled={loading}>{A.more}</Button></div>}
      </Card>
    </>
  );
}
