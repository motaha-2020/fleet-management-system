import type { VehicleStatus } from "./vehicle.js";

/** VEH-003: Draft → Active ⇄ Inactive → Disposed. Disposal goes through its own action (VEH-006). */
const NEXT: Record<VehicleStatus, readonly VehicleStatus[]> = {
  draft: ["active"],
  active: ["inactive"],
  inactive: ["active"],
  disposed: [],
};
export const canChangeVehicleStatus = (from: VehicleStatus, to: VehicleStatus) => NEXT[from].includes(to);
export const canDisposeVehicle = (from: VehicleStatus) => from === "active" || from === "inactive";
export const DISPOSAL_REASONS = ["sold", "scrapped", "returned"] as const;
export type DisposalReason = (typeof DISPOSAL_REASONS)[number];
