import type { CountryTemplate } from "@fleet/config";

export const VEHICLE_STATUSES = ["draft", "active", "inactive", "disposed"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const METER_TYPES = ["distance", "hours", "both"] as const;
export type MeterType = (typeof METER_TYPES)[number];

export const OWNERSHIP_TYPES = ["owned", "leased", "rented"] as const;
export type OwnershipType = (typeof OWNERSHIP_TYPES)[number];

export interface VehicleDraft {
  fleetNumber: string;
  registrationNumber: string;
  vin?: string | null;
  make: string;
  model: string;
  year: number;
  primaryFuelType: string;
  primaryTankCapacity: number | null;
  secondaryFuelType?: string | null;
  secondaryTankCapacity?: number | null;
  meterType: MeterType;
  requiredLicenseCategory: string | null;
  ownershipType: OwnershipType;
}

export type FieldErrors = Partial<Record<keyof VehicleDraft, string>>;

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const EASTERN_ARABIC_INDIC = "۰۱۲۳۴۵۶۷۸۹";

/** Convert Arabic-Indic digits (٠-٩, ۰-۹) to Western digits. */
export function toWesternDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (d) => {
    const i = ARABIC_INDIC.indexOf(d);
    return String(i >= 0 ? i : EASTERN_ARABIC_INDIC.indexOf(d));
  });
}

/**
 * Canonical form of a registration (plate) number, used for uniqueness (VEH-002).
 * Egyptian plates mix Arabic letters and digits; people type them with or without
 * spaces/dashes and with either digit set. "ط ب ع ١٢٣٤" and "طبع-1234" are the same plate.
 */
export function normalizeRegistration(input: string): string {
  return toWesternDigits(input)
    .normalize("NFKC")
    .replace(/[\s\-_.|/]+/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toUpperCase();
}

/** VIN: 17 chars, no I/O/Q (ISO 3779). */
export function isValidVin(vin: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin.toUpperCase());
}

/**
 * Business validation for creating a vehicle (US-E05-01).
 * Shape/type validation happens in the API contract; this checks the rules.
 * `currentYear` is passed in: the domain package never reads the system clock.
 */
export function validateVehicleDraft(
  v: VehicleDraft,
  country: CountryTemplate,
  currentYear: number,
): FieldErrors {
  const errors: FieldErrors = {};
  const fuelCodes = new Set(country.fuelTypes.map((f) => f.code));
  const licenseCodes = new Set(country.licenseCategories.map((l) => l.code));

  if (!v.fleetNumber.trim()) errors.fleetNumber = "required";
  if (!normalizeRegistration(v.registrationNumber)) errors.registrationNumber = "required";
  if (v.vin && !isValidVin(v.vin)) errors.vin = "invalid_vin";
  if (!v.make.trim()) errors.make = "required";
  if (!v.model.trim()) errors.model = "required";
  if (!Number.isInteger(v.year) || v.year < 1950 || v.year > currentYear + 1) errors.year = "out_of_range";

  if (!fuelCodes.has(v.primaryFuelType)) errors.primaryFuelType = "unknown_fuel_type";
  if (v.primaryTankCapacity == null) errors.primaryTankCapacity = "required";
  else if (!(v.primaryTankCapacity > 0 && v.primaryTankCapacity <= 2000)) errors.primaryTankCapacity = "out_of_range";

  if (v.secondaryFuelType) {
    if (!fuelCodes.has(v.secondaryFuelType)) errors.secondaryFuelType = "unknown_fuel_type";
    else if (v.secondaryFuelType === v.primaryFuelType) errors.secondaryFuelType = "same_as_primary";
    if (v.secondaryTankCapacity == null) errors.secondaryTankCapacity = "required";
    else if (!(v.secondaryTankCapacity > 0 && v.secondaryTankCapacity <= 2000)) errors.secondaryTankCapacity = "out_of_range";
  } else if (v.secondaryTankCapacity != null) {
    errors.secondaryTankCapacity = "requires_secondary_fuel";
  }

  if (!v.requiredLicenseCategory) errors.requiredLicenseCategory = "required";
  else if (!licenseCodes.has(v.requiredLicenseCategory)) errors.requiredLicenseCategory = "unknown_license_category";

  return errors;
}
