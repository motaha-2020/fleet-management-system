import type { Role } from "@fleet/config";

export const CORRECTABLE = {
  fuel_entry: ["eventAt", "odometer", "quantity", "fuelType", "isFull", "netMinor", "taxMinor", "payment", "receiptRef"],
  meter_reading: ["value", "eventAt"],
  cost_record: ["category", "netMinor", "taxMinor", "expenseDate", "vendorId", "description", "eInvoiceUuid"],
} as const;
export type CorrectableRecord = keyof typeof CORRECTABLE;

const FINANCIAL_FIELDS = new Set(["netMinor", "taxMinor", "category", "expenseDate", "payment"]);

/**
 * AUD-002: corrections to financial records or odometer go through Maker/Checker.
 * "Financial" decides who may approve (PRD §5.3: fleet managers approve non-financial only,
 * finance approves financial only, company admins approve both).
 */
export function isFinancialCorrection(record: CorrectableRecord, fields: readonly string[]): boolean {
  return record === "cost_record" || fields.some((f) => FINANCIAL_FIELDS.has(f));
}

export function canApproveCorrection(role: Role, financial: boolean): boolean {
  if (role === "company_admin") return true;
  if (role === "fleet_manager") return !financial;
  if (role === "finance_reviewer") return financial;
  return false;
}
