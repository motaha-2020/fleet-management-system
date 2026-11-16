"use client";
import { allows } from "@fleet/domain";
import type { CostRecord } from "@fleet/contracts";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { fmtDate } from "@/lib/format";
import { Badge, Table, Td } from "./ui";
import { CorrectionButton, fromMinor } from "./m2-common";

export function CostTable({ items, vehicleName, onChange }: { items: CostRecord[]; vehicleName?: (id: string | null) => string; onChange: () => void }) {
  const { user } = useSession();
  const { t, locale } = useI18n();
  const C = t.m2.costs;
  const canCorrect = !!user && allows(user, "correction.request").allowed;
  return (
    <Table head={[C.date, ...(vehicleName ? [C.vehicle] : []), C.category, C.net, C.tax, C.gross, C.reported, C.source, ""]}>
      {items.map((c) => (
        <tr key={c.id} className={c.status === "voided" ? "opacity-60" : ""}>
          <Td>{fmtDate(c.expenseDate, locale)}</Td>
          {vehicleName && <Td>{vehicleName(c.vehicleId)}</Td>}
          <Td>
            {C.categories[c.category]}
            {c.status === "pending" && <span className="ms-1"><Badge tone="warn">{C.pendingApproval}</Badge></span>}
            {c.flags.includes("possible_duplicate") && <span className="ms-1"><Badge tone="bad">{t.m2.fuel.flagNames.possible_duplicate}</Badge></span>}
          </Td>
          <Td>{fromMinor(c.netMinor)}</Td>
          <Td>{fromMinor(c.taxMinor)}</Td>
          <Td>{fromMinor(c.grossMinor)}</Td>
          <Td className="font-semibold" >{fromMinor(c.reportedMinor)} <span className="text-xs text-muted">{c.taxRecoverable ? C.net : C.gross}</span></Td>
          <Td>{C.sources[c.sourceType]}</Td>
          <Td>{canCorrect && c.sourceType === "manual" && c.status === "active" && <CorrectionButton recordType="cost_record" recordId={c.id} field="netMinor" kind="money" onDone={onChange} />}</Td>
        </tr>
      ))}
    </Table>
  );
}
