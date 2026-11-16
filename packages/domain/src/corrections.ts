import type { Permissions } from "@fleet/config";

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

/** Financial corrections need correction.approve_financial, the others correction.approve (as the company set its roles). */
export function canApproveCorrection(permissions: Permissions, financial: boolean): boolean {
  return !!permissions[financial ? "correction.approve_financial" : "correction.approve"];
}
