"use client";
import { useEffect, useState } from "react";
import type { AuditEntry } from "@fleet/contracts";
import { Alert, Button, Card, PageHeader, Table, Td } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { apiErrorMessage } from "@/lib/errors";
import { fmtDateTime } from "@/lib/format";

function summary(e: AuditEntry): string {
  const v = (e.after ?? e.before) as Record<string, unknown> | null;
  if (!v || typeof v !== "object") return "";
  return Object.entries(v).slice(0, 4).map(([k, x]) => `${k}: ${typeof x === "object" ? JSON.stringify(x) : String(x)}`).join(" · ");
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
                <Td>{e.actorName ?? "—"}</Td>
                <Td><code dir="ltr" className="text-xs">{e.action}</code></Td>
                <Td><span className="text-xs text-muted">{e.entityType ?? "—"}</span></Td>
                <Td className="max-w-md whitespace-normal text-xs text-muted"><span dir="ltr">{summary(e)}</span></Td>
              </tr>
            ))}
          </Table>
        )}
        {next && <div className="p-4"><Button onClick={() => load(next)} disabled={loading}>{A.more}</Button></div>}
      </Card>
    </>
  );
}
