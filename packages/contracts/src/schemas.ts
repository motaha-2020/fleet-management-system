import { z } from "zod";
import { ROLES, TENANT_ROLES } from "@fleet/config";
import { METER_TYPES, OWNERSHIP_TYPES, VEHICLE_STATUSES, DISPOSAL_REASONS, EMPLOYMENT_STATUSES, DOCUMENT_STATUSES } from "@fleet/domain";

export const Uuid = z.uuid();
export const IsoDateTime = z.iso.datetime({ offset: true });
export const IsoDate = z.iso.date();

export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fields: z.record(z.string(), z.string()).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

// ---------- Auth ----------
export const LoginRequest = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(256),
  /** Pick a membership when one identity belongs to several tenants (SEC-008). Verified server-side. */
  tenantSlug: z.string().max(63).optional(),
});

export const SessionUser = z.object({
  identityId: Uuid,
  displayName: z.string(),
  role: z.enum(ROLES),
  tenant: z.object({ id: Uuid, slug: z.string(), name: z.string(), countryCode: z.string() }).nullable(),
  branchIds: z.array(Uuid),
  driverId: Uuid.nullable(),
  mfaEnabled: z.boolean(),
  /** Other roles this person holds; SEC-002 role switcher. */
  memberships: z.array(z.object({ id: Uuid, role: z.enum(ROLES), tenantSlug: z.string(), tenantName: z.string() })),
  currentMembershipId: Uuid.nullable(),
});
export type SessionUser = z.infer<typeof SessionUser>;

export const TokenResponse = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  /** Returned in the body only for devices; web clients get it as an HttpOnly cookie. */
  refreshToken: z.string().optional(),
  user: SessionUser,
});
export type TokenResponse = z.infer<typeof TokenResponse>;

/** Password was right; a second factor is needed (SEC-004). */
export const MfaChallenge = z.object({
  mfa: z.enum(["verify", "enroll"]),
  mfaToken: z.string(),
  /** Only when enrolling: show as QR code / manual key. */
  otpauthUrl: z.string().optional(),
  secret: z.string().optional(),
});
export type MfaChallenge = z.infer<typeof MfaChallenge>;
export const LoginResponse = z.union([TokenResponse, MfaChallenge]);
export type LoginResponse = z.infer<typeof LoginResponse>;
export const isMfaChallenge = (r: LoginResponse): r is MfaChallenge => "mfaToken" in r;

export const MfaVerifyRequest = z.object({ mfaToken: z.string().min(20).max(2048), code: z.string().regex(/^\d{6}$/) });
export const SwitchRoleRequest = z.object({ membershipId: Uuid, code: z.string().regex(/^\d{6}$/).optional() });

export const RefreshRequest = z.object({ refreshToken: z.string().min(20).max(512).optional() });

export const AcceptInviteRequest = z.object({
  token: z.string().min(20).max(256),
  password: z.string().min(12).max(256),
});

export const DriverActivateRequest = z.object({
  username: z.string().min(3).max(64),
  code: z.string().min(4).max(32),
  deviceName: z.string().min(1).max(100),
  platform: z.enum(["android", "ios", "web"]),
});

// ---------- Platform ----------
export const TENANT_STATUSES = ["provisioning", "active", "suspended", "failed", "terminated"] as const;

export const CreateTenantRequest = z.object({
  name: z.string().min(2).max(200),
  slug: z.string().regex(/^[a-z][a-z0-9-]{1,30}[a-z0-9]$/, "lowercase letters, digits and dashes"),
  countryCode: z.string().length(2),
  adminEmail: z.email().max(254),
  adminName: z.string().min(2).max(200),
});

export const Tenant = z.object({
  id: Uuid,
  slug: z.string(),
  name: z.string(),
  countryCode: z.string(),
  status: z.enum(TENANT_STATUSES),
  failureReason: z.string().nullable(),
  schemaVersion: z.number().int().nullable(),
  createdAt: IsoDateTime,
});
export type Tenant = z.infer<typeof Tenant>;

export const CreateTenantResponse = z.object({
  tenant: Tenant,
  /** Until email delivery exists (NTF), the invite link is returned to the platform admin. */
  adminInviteToken: z.string(),
});

// ---------- Branches ----------
export const Branch = z.object({
  id: Uuid, code: z.string(), name: z.string(), timezone: z.string(),
  weekendDays: z.array(z.number().int().min(0).max(6)), status: z.enum(["active", "inactive"]),
});
export type Branch = z.infer<typeof Branch>;
const TimeZone = z.string().min(3).max(64).refine((tz) => {
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
}, "unknown time zone");
export const CreateBranchRequest = z.object({
  id: Uuid.optional(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,16}$/),
  name: z.string().trim().min(2).max(100),
  timezone: TimeZone.default("Africa/Cairo"),
  weekendDays: z.array(z.number().int().min(0).max(6)).max(3).default([5]),
});
export const UpdateBranchRequest = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  timezone: TimeZone.optional(),
  weekendDays: z.array(z.number().int().min(0).max(6)).max(3).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

// ---------- Users (US-E02-03) ----------
export const TenantUser = z.object({
  membershipId: Uuid, identityId: Uuid, email: z.string().nullable(), displayName: z.string(),
  role: z.enum(ROLES), branchIds: z.array(Uuid), active: z.boolean(), mfaEnabled: z.boolean(), invitePending: z.boolean(),
});
export type TenantUser = z.infer<typeof TenantUser>;
const STAFF_ROLES = ["company_admin", "fleet_manager", "finance_reviewer", "viewer"] as const;
export const InviteUserRequest = z.object({
  email: z.email().max(254), displayName: z.string().trim().min(2).max(200),
  role: z.enum(STAFF_ROLES), branchIds: z.array(Uuid).max(100).default([]),
});
export const InviteUserResponse = z.object({ user: TenantUser, inviteToken: z.string().nullable() });
export const UpdateUserRequest = z.object({
  role: z.enum(STAFF_ROLES).optional(), branchIds: z.array(Uuid).max(100).optional(), active: z.boolean().optional(),
});

// ---------- Vendors (VND) ----------
export const VENDOR_TYPES = ["workshop", "fuel_provider", "lessor", "insurer", "other"] as const;
export const Vendor = z.object({
  id: Uuid, name: z.string(), type: z.enum(VENDOR_TYPES), contactName: z.string().nullable(), phone: z.string().nullable(),
  email: z.string().nullable(), taxId: z.string().nullable(), branchIds: z.array(Uuid), status: z.enum(["active", "inactive"]),
});
export type Vendor = z.infer<typeof Vendor>;
export const CreateVendorRequest = z.object({
  id: Uuid.optional(), name: z.string().trim().min(2).max(200), type: z.enum(VENDOR_TYPES),
  contactName: z.string().trim().max(200).nullish(), phone: z.string().trim().max(20).nullish(),
  email: z.email().max(254).nullish(), taxId: z.string().trim().max(32).nullish(), branchIds: z.array(Uuid).max(100).default([]),
});
export const UpdateVendorRequest = CreateVendorRequest.omit({ id: true }).partial().extend({ status: z.enum(["active", "inactive"]).optional() });
export const ListVendorsQuery = z.object({ includeInactive: z.enum(["true", "false"]).optional() });

// ---------- Vehicles ----------
export const CreateVehicleRequest = z.object({
  /** Client-generated UUIDv7 makes the create idempotent (safe to retry). */
  id: Uuid.optional(),
  branchId: Uuid,
  fleetNumber: z.string().trim().min(1).max(32),
  registrationNumber: z.string().trim().min(1).max(32),
  vin: z.string().trim().max(17).nullish(),
  make: z.string().trim().min(1).max(64),
  model: z.string().trim().min(1).max(64),
  year: z.number().int(),
  primaryFuelType: z.string().max(16),
  primaryTankCapacity: z.number().positive().nullable(),
  secondaryFuelType: z.string().max(16).nullish(),
  secondaryTankCapacity: z.number().positive().nullish(),
  meterType: z.enum(METER_TYPES),
  requiredLicenseCategory: z.string().max(16).nullable(),
  ownershipType: z.enum(OWNERSHIP_TYPES),
  status: z.enum(["draft", "active"]).default("active"),
});
export type CreateVehicleRequest = z.input<typeof CreateVehicleRequest>;

export const Vehicle = z.object({
  id: Uuid,
  branchId: Uuid,
  fleetNumber: z.string(),
  registrationNumber: z.string(),
  vin: z.string().nullable(),
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  primaryFuelType: z.string(),
  primaryTankCapacity: z.number(),
  secondaryFuelType: z.string().nullable(),
  secondaryTankCapacity: z.number().nullable(),
  meterType: z.enum(METER_TYPES),
  requiredLicenseCategory: z.string(),
  ownershipType: z.enum(OWNERSHIP_TYPES),
  status: z.enum(VEHICLE_STATUSES),
  disposal: z.object({ date: IsoDate, reason: z.enum(DISPOSAL_REASONS), finalOdometer: z.number().int().nullable(), saleValueMinor: z.number().int().nullable() }).nullable(),
  createdAt: IsoDateTime,
});
export type Vehicle = z.infer<typeof Vehicle>;

export const UpdateVehicleRequest = z.object({
  fleetNumber: z.string().trim().min(1).max(32),
  registrationNumber: z.string().trim().min(1).max(32),
  vin: z.string().trim().max(17).nullish(),
  make: z.string().trim().min(1).max(64),
  model: z.string().trim().min(1).max(64),
  year: z.number().int(),
  primaryFuelType: z.string().max(16),
  primaryTankCapacity: z.number().positive().nullable(),
  secondaryFuelType: z.string().max(16).nullish(),
  secondaryTankCapacity: z.number().positive().nullish(),
  meterType: z.enum(METER_TYPES),
  requiredLicenseCategory: z.string().max(16).nullable(),
  ownershipType: z.enum(OWNERSHIP_TYPES),
}).partial();
export const VehicleStatusRequest = z.object({ status: z.enum(["active", "inactive"]), reason: z.string().trim().max(500).optional() });
export const TransferVehicleRequest = z.object({ toBranchId: Uuid, effectiveAt: IsoDateTime.optional(), reason: z.string().trim().max(500).optional() });
export const DisposeVehicleRequest = z.object({
  date: IsoDate, reason: z.enum(DISPOSAL_REASONS),
  finalOdometer: z.number().int().min(0).nullable(), saleValueMinor: z.number().int().min(0).nullish(),
});
export const BranchTransfer = z.object({ id: Uuid, fromBranchId: Uuid, toBranchId: Uuid, effectiveAt: IsoDateTime, reason: z.string().nullable(), createdBy: Uuid });

// ---------- Drivers ----------
const DriverMasterFields = {
  employeeRef: z.string().trim().max(32).nullish(),
  nationalId: z.string().trim().max(20).nullish(),
  licenseNumber: z.string().trim().max(32).nullish(),
  licenseCategories: z.array(z.string().max(16)).max(10).default([]),
  licenseExpiry: IsoDate.nullish(),
};
export const CreateDriverRequest = z.object({
  id: Uuid.optional(),
  branchId: Uuid,
  fullName: z.string().trim().min(2).max(200),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,64}$/, "letters, digits, dot, dash, underscore"),
  phone: z.string().trim().max(20).nullish(),
  ...DriverMasterFields,
});
export const UpdateDriverRequest = z.object({
  fullName: z.string().trim().min(2).max(200),
  phone: z.string().trim().max(20).nullable(),
  branchId: Uuid,
  employeeRef: z.string().trim().max(32).nullable(),
  nationalId: z.string().trim().max(20).nullable(),
  licenseNumber: z.string().trim().max(32).nullable(),
  licenseCategories: z.array(z.string().max(16)).max(10),
  licenseExpiry: IsoDate.nullable(),
  employmentStatus: z.enum(EMPLOYMENT_STATUSES),
}).partial();
export const DriverAccountRequest = z.object({ active: z.boolean() });
export const RevealResponse = z.object({ nationalId: z.string().nullable() });
export type CreateDriverRequest = z.input<typeof CreateDriverRequest>;

export const Driver = z.object({
  id: Uuid,
  branchId: Uuid,
  fullName: z.string(),
  username: z.string(),
  phone: z.string().nullable(),
  /** Login account status (DRV-002), separate from employment status (DRV-003). */
  status: z.enum(["active", "inactive"]),
  employmentStatus: z.enum(EMPLOYMENT_STATUSES),
  employeeRef: z.string().nullable(),
  /** Masked unless revealed through the audited reveal endpoint (DRV-007). */
  nationalIdMasked: z.string().nullable(),
  licenseNumber: z.string().nullable(),
  licenseCategories: z.array(z.string()),
  licenseExpiry: IsoDate.nullable(),
  eligibility: z.object({ status: z.enum(["eligible", "restricted"]), reasons: z.array(z.string()) }),
  hasActiveDevice: z.boolean(),
  createdAt: IsoDateTime,
});
export type Driver = z.infer<typeof Driver>;

export const ActivationCodeResponse = z.object({ code: z.string(), expiresAt: IsoDateTime, username: z.string() });

// ---------- Documents (DOC) ----------
export const DocumentType = z.object({
  code: z.string(), entityType: z.enum(["vehicle", "driver"]), name: z.object({ ar: z.string(), en: z.string() }),
  mandatory: z.boolean(), countryMandatory: z.boolean(), hasExpiry: z.boolean(), risk: z.enum(["R1", "R2", "R3", "R4"]),
  driverVisibility: z.enum(["none", "view", "download"]), sensitive: z.boolean(), source: z.enum(["country", "company"]), active: z.boolean(),
});
export type DocumentType = z.infer<typeof DocumentType>;
export const CreateDocumentTypeRequest = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,40}$/),
  entityType: z.enum(["vehicle", "driver"]), nameAr: z.string().trim().min(2).max(100), nameEn: z.string().trim().min(2).max(100),
  mandatory: z.boolean().default(false), hasExpiry: z.boolean().default(true), risk: z.enum(["R1", "R2", "R3", "R4"]),
  driverVisibility: z.enum(["none", "view", "download"]).default("none"), sensitive: z.boolean().default(false),
});
export const UpdateDocumentTypeRequest = z.object({
  mandatory: z.boolean().optional(), driverVisibility: z.enum(["none", "view", "download"]).optional(), active: z.boolean().optional(),
});

export const Document = z.object({
  id: Uuid, entityType: z.enum(["vehicle", "driver"]), entityId: Uuid, typeCode: z.string(),
  number: z.string().nullable(), issueDate: IsoDate.nullable(), expiryDate: IsoDate.nullable(), version: z.number().int(),
  status: z.enum(DOCUMENT_STATUSES), validity: z.enum(["valid", "expiring", "expired", "no_expiry"]),
  file: z.object({ name: z.string(), mime: z.string(), size: z.number().int() }).nullable(),
  createdBy: Uuid, createdAt: IsoDateTime, verifiedBy: Uuid.nullable(), verifiedAt: IsoDateTime.nullable(),
  rejectionReason: z.string().nullable(), supersededBy: Uuid.nullable(), canDownload: z.boolean(),
});
export type Document = z.infer<typeof Document>;
export const ListDocumentsQuery = z.object({
  entityType: z.enum(["vehicle", "driver"]).optional(), entityId: Uuid.optional(),
  status: z.enum(DOCUMENT_STATUSES).optional(), includeHistory: z.enum(["true", "false"]).optional(),
});
export const ListDocumentsResponse = z.object({
  items: z.array(Document),
  /** Mandatory types with no current (pending/verified) document, when an entity is given. */
  missingMandatory: z.array(z.string()),
});
export const CreateDocumentRequest = z.object({
  id: Uuid.optional(), entityType: z.enum(["vehicle", "driver"]), entityId: Uuid, typeCode: z.string().max(48),
  number: z.string().trim().max(64).nullish(), issueDate: IsoDate.nullish(), expiryDate: IsoDate.nullish(),
});
export const RejectDocumentRequest = z.object({ reason: z.string().trim().min(3).max(500) });

// ---------- Audit (SEC-011, RPT-007) ----------
export const AuditEntry = z.object({
  id: z.number().int(), at: IsoDateTime, actorId: Uuid.nullable(), actorName: z.string().nullable(), action: z.string(),
  entityType: z.string().nullable(), entityId: Uuid.nullable(), before: z.unknown().nullable(), after: z.unknown().nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;
export const ListAuditQuery = z.object({
  entityType: z.string().max(32).optional(), entityId: Uuid.optional(), action: z.string().max(64).optional(),
  before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const ListAuditResponse = z.object({ items: z.array(AuditEntry), nextBefore: z.number().int().nullable() });

// ---------- M2: assignments, odometer, fuel, costs, corrections ----------
const Quality = z.enum(["reliable", "estimated", "partial", "unavailable"]);
export const Measured = z.object({ value: z.number().nullable(), quality: Quality });
const Minor = z.number().int();

export const Assignment = z.object({
  id: Uuid, vehicleId: Uuid, driverId: Uuid, role: z.enum(["primary", "secondary"]), startsAt: IsoDateTime, endsAt: IsoDateTime.nullable(),
  status: z.enum(["active", "cancelled"]), notes: z.string().nullable(), createdBy: Uuid, createdAt: IsoDateTime,
});
export type Assignment = z.infer<typeof Assignment>;
export const CreateAssignmentRequest = z.object({
  id: Uuid.optional(), vehicleId: Uuid, driverId: Uuid, role: z.enum(["primary", "secondary"]),
  startsAt: IsoDateTime.optional(), endsAt: IsoDateTime.nullish(), notes: z.string().trim().max(500).nullish(),
});
export const EndAssignmentRequest = z.object({ endsAt: IsoDateTime.optional() });
export const BackdateAssignmentRequest = z.object({ startsAt: IsoDateTime, reason: z.string().trim().min(3).max(500) });
export const ListAssignmentsQuery = z.object({ vehicleId: Uuid.optional(), driverId: Uuid.optional(), current: z.enum(["true", "false"]).optional() });

export const Handover = z.object({
  id: Uuid, vehicleId: Uuid, fromDriverId: Uuid.nullable(), toDriverId: Uuid, eventAt: IsoDateTime, odometer: z.number().int(),
  readingStatus: z.enum(["valid", "warning", "conflict", "corrected", "excluded"]).nullable(), notes: z.string().nullable(), createdBy: Uuid,
});
export const CreateHandoverRequest = z.object({
  id: Uuid.optional(), vehicleId: Uuid, toDriverId: Uuid, eventAt: IsoDateTime.optional(), odometer: z.number().int().min(0).max(9_999_999), notes: z.string().trim().max(500).nullish(),
});
export const CustodySegment = z.object({ start: IsoDateTime, end: IsoDateTime, driverId: Uuid.nullable(), source: z.enum(["assignment", "handover", "gap"]) });
export const PeriodQuery = z.object({ from: IsoDateTime.optional(), to: IsoDateTime.optional() });

export const READING_SOURCES = ["opening", "manual", "fuel", "handover", "replacement", "correction"] as const;
export const MeterReading = z.object({
  id: Uuid, vehicleId: Uuid, value: z.number().int(), cumulative: z.number().int(), eventAt: IsoDateTime, recordedAt: IsoDateTime,
  sourceType: z.enum(READING_SOURCES), sourceId: Uuid.nullable(), status: z.enum(["valid", "warning", "conflict", "corrected", "excluded"]),
  reasons: z.array(z.string()), corroborates: z.array(Uuid), correctedBy: Uuid.nullable(),
});
export type MeterReading = z.infer<typeof MeterReading>;
export const MeterReplacement = z.object({ id: Uuid, eventAt: IsoDateTime, oldFinal: z.number().int(), newStart: z.number().int(), reason: z.string().nullable() });
export const OdometerView = z.object({
  current: z.object({ value: z.number().int(), cumulative: z.number().int(), at: IsoDateTime }).nullable(),
  readings: z.array(MeterReading), replacements: z.array(MeterReplacement),
});
export const CreateReadingRequest = z.object({ id: Uuid.optional(), vehicleId: Uuid, value: z.number().int().min(0).max(9_999_999), eventAt: IsoDateTime.optional(), opening: z.boolean().optional() });
export const CreateReplacementRequest = z.object({
  id: Uuid.optional(), vehicleId: Uuid, eventAt: IsoDateTime, oldFinal: z.number().int().min(0), newStart: z.number().int().min(0), reason: z.string().trim().max(500).nullish(),
});

export const FuelEntry = z.object({
  id: Uuid, vehicleId: Uuid, driverId: Uuid.nullable(), eventAt: IsoDateTime, recordedAt: IsoDateTime, odometer: z.number().int(), readingId: Uuid.nullable(),
  fuelType: z.string(), quantity: z.number(), unit: z.enum(["L", "m3"]), isFull: z.boolean(),
  netMinor: Minor, taxMinor: Minor, grossMinor: Minor, currency: z.string(), unitPriceMinor: z.number(),
  payment: z.enum(["cash", "card"]), receiptRef: z.string().nullable(), hasReceipt: z.boolean(),
  referencePriceMinor: z.number().int().nullable(), referenceOfficial: z.boolean().nullable(),
  status: z.enum(["submitted", "under_review", "accepted", "voided"]), flags: z.array(z.string()), notes: z.string().nullable(),
  createdBy: Uuid, reviewedBy: Uuid.nullable(), reviewedAt: IsoDateTime.nullable(), voidReason: z.string().nullable(),
});
export type FuelEntry = z.infer<typeof FuelEntry>;
export const CreateFuelEntryRequest = z.object({
  id: Uuid.optional(), vehicleId: Uuid, driverId: Uuid.nullish(), eventAt: IsoDateTime.optional(),
  odometer: z.number().int().min(0).max(9_999_999), fuelType: z.string().max(16), quantity: z.number().positive().max(100_000),
  isFull: z.boolean(), amountMinor: z.number().int().positive(), taxMinor: z.number().int().min(0).default(0),
  payment: z.enum(["cash", "card"]), receiptRef: z.string().trim().max(64).nullish(), notes: z.string().trim().max(500).nullish(),
});
export type CreateFuelEntryRequest = z.input<typeof CreateFuelEntryRequest>;
export const VoidRequest = z.object({ reason: z.string().trim().min(3).max(500) });
export const ListFuelQuery = z.object({
  vehicleId: Uuid.optional(), status: z.enum(["submitted", "under_review", "accepted", "voided"]).optional(),
  from: IsoDateTime.optional(), to: IsoDateTime.optional(),
});
export const FuelCycle = z.object({
  fuelType: z.string(), startId: Uuid, endId: Uuid, startAt: IsoDateTime, endAt: IsoDateTime, quantity: z.number(), km: z.number(), per100: z.number().nullable(), quality: Quality,
});
export const FuelStats = z.object({
  purchased: z.array(z.object({ fuelType: z.string(), unit: z.enum(["L", "m3"]), quantity: z.number(), grossMinor: Minor })),
  consumption: z.array(z.object({ fuelType: z.string(), value: z.number().nullable(), quality: Quality })),
  cycles: z.array(FuelCycle),
});

export const COST_CATEGORIES = ["fuel", "preventive", "corrective", "accident", "insurance", "licensing", "rental", "fines", "tolls", "other"] as const;
export const CostRecord = z.object({
  id: Uuid, category: z.enum(COST_CATEGORIES), vehicleId: Uuid.nullable(), branchId: Uuid, vendorId: Uuid.nullable(),
  netMinor: Minor, taxMinor: Minor, grossMinor: Minor, currency: z.string(), taxRecoverable: z.boolean(), reportedMinor: Minor,
  expenseDate: IsoDate, sourceType: z.enum(["manual", "fuel", "maintenance", "provider", "fine"]), sourceId: Uuid.nullable(),
  eInvoiceUuid: z.string().nullable(), description: z.string().nullable(), status: z.enum(["active", "voided"]), flags: z.array(z.string()), createdAt: IsoDateTime,
});
export type CostRecord = z.infer<typeof CostRecord>;
export const CreateCostRequest = z.object({
  id: Uuid.optional(), category: z.enum(COST_CATEGORIES), vehicleId: Uuid.nullish(), branchId: Uuid.nullish(), vendorId: Uuid.nullish(),
  netMinor: z.number().int().min(0), taxMinor: z.number().int().min(0).default(0), expenseDate: IsoDate,
  eInvoiceUuid: z.string().trim().max(64).nullish(), description: z.string().trim().max(500).nullish(),
});
export const ListCostsQuery = z.object({
  vehicleId: Uuid.optional(), category: z.enum(COST_CATEGORIES).optional(), from: IsoDate.optional(), to: IsoDate.optional(),
  includeVoided: z.enum(["true", "false"]).optional(),
});
export const CostSummaryQuery = z.object({ from: IsoDate, to: IsoDate, vehicleId: Uuid.optional() });
export const CostSummary = z.object({
  from: IsoDate, to: IsoDate, currency: z.string(),
  vehicles: z.array(z.object({
    vehicleId: Uuid, fleetNumber: z.string(), costMinor: Minor, fuelCostMinor: Minor,
    distance: Measured, costPerKm: Measured, fuelCostPerKm: Measured,
  })),
});

export const Correction = z.object({
  id: Uuid, recordType: z.enum(["fuel_entry", "meter_reading", "cost_record"]), recordId: Uuid,
  changes: z.record(z.string(), z.object({ from: z.unknown(), to: z.unknown() })), reason: z.string(), financial: z.boolean(),
  status: z.enum(["pending", "applied", "rejected"]), requestedBy: Uuid, requestedAt: IsoDateTime,
  decidedBy: Uuid.nullable(), decidedAt: IsoDateTime.nullable(), decisionNote: z.string().nullable(),
  affectedFrom: IsoDate.nullable(), affectedTo: IsoDate.nullable(), canDecide: z.boolean(),
});
export type Correction = z.infer<typeof Correction>;
export const CreateCorrectionRequest = z.object({
  recordType: z.enum(["fuel_entry", "meter_reading", "cost_record"]), recordId: Uuid,
  changes: z.record(z.string(), z.unknown()).refine((c) => Object.keys(c).length > 0, "at least one change"),
  reason: z.string().trim().min(3).max(500),
});
export const DecideCorrectionRequest = z.object({ note: z.string().trim().max(500).optional() });
export const ListCorrectionsQuery = z.object({
  status: z.enum(["pending", "applied", "rejected"]).optional(), recordType: z.enum(["fuel_entry", "meter_reading", "cost_record"]).optional(), recordId: Uuid.optional(),
});

export const FuelPrice = z.object({ id: Uuid, countryCode: z.string(), fuelType: z.string(), priceMinor: z.number().int(), currency: z.string(), effectiveFrom: IsoDateTime });
export type FuelPrice = z.infer<typeof FuelPrice>;
export const CreateFuelPriceRequest = z.object({
  countryCode: z.string().length(2), fuelType: z.string().max(16), priceMinor: z.number().int().positive(), effectiveFrom: IsoDateTime,
});
export const FuelPricesQuery = z.object({ countryCode: z.string().length(2).optional() });

export const ListOf = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item) });

// ---------- M3: offline & sync (E14, docs/M3_Offline_Design.md) ----------
export const SyncEventType = z.enum(["fuel.create", "odometer.record"]);
export type SyncEventType = z.infer<typeof SyncEventType>;
/** fuel.create: the entry id is the event id; the time comes from the event, the driver from the device. */
export const FuelCreatePayload = CreateFuelEntryRequest.omit({ id: true, eventAt: true, driverId: true });
export const OdometerRecordPayload = z.object({ vehicleId: Uuid, odometer: z.number().int().min(0).max(9_999_999) });
export const SyncEvent = z.object({
  /** UUIDv7 made on the device; also the id of the record the event creates. */
  eventId: Uuid,
  type: SyncEventType,
  /** Validated by the handler of `type`. */
  payload: z.record(z.string(), z.unknown()),
  /** 1, 2, 3… per device, no gaps on the device. */
  deviceSeq: z.number().int().positive(),
  deviceTime: IsoDateTime,
  grantId: Uuid,
  /** Monotonic ms between receiving the grant and the action; null when unknown (reboot). */
  elapsedMs: z.number().int().min(0).nullable(),
});
export type SyncEvent = z.infer<typeof SyncEvent>;
export const SyncRequest = z.object({ events: z.array(SyncEvent).min(1).max(50) });
export const SyncStatus = z.enum(["accepted", "warning", "conflict", "rejected", "held"]);
export const SyncResult = z.object({
  eventId: Uuid,
  status: SyncStatus,
  recordId: Uuid.optional(),
  code: z.string().optional(),
  flags: z.array(z.string()).optional(),
});
export type SyncResult = z.infer<typeof SyncResult>;
export const OfflineGrant = z.object({
  /** EdDSA JWS (typ offline-grant+jwt), verifiable with GET /sync/public-key. */
  token: z.string(),
  grantId: Uuid,
  issuedAt: IsoDateTime,
  expiresAt: IsoDateTime,
  vehicleIds: z.array(Uuid),
});
export const ReadSet = z.object({
  vehicles: z.array(Vehicle),
  odometer: z.array(z.object({ vehicleId: Uuid, value: z.number().int(), at: IsoDateTime })),
});
export const SyncState = z.object({
  grant: OfflineGrant,
  readSet: ReadSet,
  /** Highest device_seq applied with no gap; the device may drop outbox rows up to here. */
  lastAppliedSeq: z.number().int().min(0),
  serverTime: IsoDateTime,
});
export const SyncResponse = SyncState.extend({ results: z.array(SyncResult) });
export const SyncPublicKey = z.object({ publicKeyPem: z.string() });
export const SyncConflict = z.object({
  id: Uuid, eventId: Uuid, type: z.string(), reason: z.string(), status: z.enum(["open", "accepted", "rejected", "corrected"]),
  branchId: Uuid.nullable(), payload: z.record(z.string(), z.unknown()), deviceTime: IsoDateTime, estimatedTime: IsoDateTime.nullable(),
  serverTime: IsoDateTime, flags: z.array(z.string()), createdBy: Uuid, createdAt: IsoDateTime,
  resolutionReason: z.string().nullable(), resolvedBy: Uuid.nullable(), resolvedAt: IsoDateTime.nullable(),
  correction: z.record(z.string(), z.unknown()).nullable(), recordType: z.string().nullable(), recordId: Uuid.nullable(),
});
export type SyncConflict = z.infer<typeof SyncConflict>;
/** Fields a reviewer may change when correcting an offline event (OFF-010). */
export const SyncCorrection = z.object({
  vehicleId: Uuid.optional(), odometer: z.number().int().min(0).max(9_999_999).optional(),
  quantity: z.number().positive().max(100_000).optional(), amountMinor: z.number().int().positive().optional(), fuelType: z.string().max(16).optional(),
}).strict().refine((c) => Object.keys(c).length > 0, { message: "empty_correction" });
export const ResolveSyncConflictRequest = z.object({
  decision: z.enum(["accept", "reject", "correct"]),
  reason: z.string().trim().min(3).max(500),
  correction: SyncCorrection.optional(),
}).refine((r) => (r.decision === "correct") === !!r.correction, { message: "correction_required_for_correct_only", path: ["correction"] });
export const ListSyncConflictsQuery = z.object({ status: z.enum(["open", "accepted", "rejected", "corrected"]).optional() });

export const Empty = z.object({});
export const Ok = z.object({ ok: z.literal(true) });

export { TENANT_ROLES };
