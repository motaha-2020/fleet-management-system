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
  /** "Keep me signed in": the session renews for 30 days on every use instead of ending after 24 hours. */
  remember: z.boolean().optional(),
});

export const SessionUser = z.object({
  identityId: Uuid,
  displayName: z.string(),
  role: z.enum(ROLES),
  tenant: z.object({ id: Uuid, slug: z.string(), name: z.string(), countryCode: z.string() }).nullable(),
  branchIds: z.array(Uuid),
  driverId: Uuid.nullable(),
  /** Other roles this person holds; SEC-002 role switcher. */
  memberships: z.array(z.object({ id: Uuid, role: z.enum(ROLES), tenantSlug: z.string(), tenantName: z.string() })),
  currentMembershipId: Uuid.nullable(),
  /** Break-glass support session (read-only, time-limited). */
  support: z.object({ grantId: Uuid, expiresAt: IsoDateTime }).optional(),
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

/**
 * Password was right on a browser that is not trusted yet: a 6-digit code was sent to the account email
 * (owner decision, 13 Nov 2026: replaces the authenticator app). `emailHint` is the masked address.
 */
export const MfaChallenge = z.object({
  mfa: z.literal("email"),
  mfaToken: z.string(),
  emailHint: z.string(),
});
export type MfaChallenge = z.infer<typeof MfaChallenge>;
export const LoginResponse = z.union([TokenResponse, MfaChallenge]);
export type LoginResponse = z.infer<typeof LoginResponse>;
export const isMfaChallenge = (r: LoginResponse): r is MfaChallenge => "mfaToken" in r;

/** The 6-digit code from the email. */
export const MfaVerifyRequest = z.object({ mfaToken: z.string().min(20).max(2048), code: z.string().trim().regex(/^\d{6}$/) });
export const MfaResendRequest = z.object({ mfaToken: z.string().min(20).max(2048) });
export const SwitchRoleRequest = z.object({ membershipId: Uuid });

/** "Forgot password": always answered the same way, whether or not the email exists. */
export const ForgotPasswordRequest = z.object({ email: z.email().max(254) });
export const ResetPasswordRequest = z.object({ token: z.string().min(20).max(256), password: z.string().min(12).max(256) });
/** An admin-made reset link (shown to the admin; also emailed when email works). */
export const PasswordResetLink = z.object({ link: z.string(), expiresAt: IsoDateTime, emailed: z.boolean() });

/** Platform outgoing email. The password is write-only: never returned, only whether one is set. */
export const MailSettings = z.object({
  source: z.enum(["site", "environment", "none"]),
  host: z.string().nullable(), port: z.number().int().nullable(), secure: z.boolean().nullable(), username: z.string().nullable(),
  passwordSet: z.boolean(), fromAddress: z.string().nullable(), fromName: z.string().nullable(), updatedAt: IsoDateTime.nullable(),
});
export type MailSettings = z.infer<typeof MailSettings>;
export const SaveMailSettingsRequest = z.object({
  host: z.string().trim().min(3).max(253), port: z.number().int().min(1).max(65535), secure: z.boolean(),
  username: z.string().trim().max(254).optional(),
  /** Omit to keep the saved password; an empty string clears it. */
  password: z.string().max(512).optional(),
  fromAddress: z.email().max(254), fromName: z.string().trim().max(100).optional(),
});
export const TestMailRequest = z.object({ to: z.email().max(254) });

export const RefreshRequest = z.object({
  refreshToken: z.string().min(20).max(512).optional(),
  /** Devices with a registered key: ECDSA signature (DER, base64) of "fleet-refresh-v1:" + refreshToken. */
  deviceProof: z.string().min(16).max(200).optional(),
});

export const AcceptInviteRequest = z.object({
  token: z.string().min(20).max(256),
  password: z.string().min(12).max(256),
});

export const DriverActivateRequest = z.object({
  username: z.string().min(3).max(64),
  code: z.string().min(4).max(32),
  deviceName: z.string().min(1).max(100),
  platform: z.enum(["android", "ios", "web"]),
  /** Public key of the hardware-held device key (EC P-256, SPKI DER, base64). */
  devicePublicKey: z.string().min(80).max(400).optional(),
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
  role: z.enum(ROLES), branchIds: z.array(Uuid), active: z.boolean(), invitePending: z.boolean(),
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

export const READING_SOURCES = ["opening", "manual", "fuel", "handover", "replacement", "correction", "maintenance"] as const;
export const MeterReading = z.object({
  id: Uuid, vehicleId: Uuid, value: z.number().int(), cumulative: z.number().int(), eventAt: IsoDateTime, recordedAt: IsoDateTime,
  sourceType: z.enum(READING_SOURCES), sourceId: Uuid.nullable(), status: z.enum(["valid", "warning", "conflict", "corrected", "excluded"]),
  reasons: z.array(z.string()), corroborates: z.array(Uuid), correctedBy: Uuid.nullable(),
  /** Meter photo from the driver app: whether it arrived, when it was taken, and where (null when not shared). */
  hasPhoto: z.boolean(), photoTakenAt: IsoDateTime.nullable(),
  location: z.object({ lat: z.number(), lng: z.number(), accuracyM: z.number().nullable() }).nullable(),
  locationStatus: z.enum(["ok", "denied", "unavailable"]).nullable(),
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

// ---------- M4: maintenance (E10) & readiness (E12) ----------
const MaintType = z.enum(["preventive", "corrective", "accident"]);
const ItemCode = z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,32}$/);
export const TemplateItem = z.object({
  id: Uuid, code: z.string(), name: z.string(), intervalKm: z.number().int().nullable(), intervalMonths: z.number().int().nullable(),
  safety: z.boolean(), status: z.enum(["active", "inactive"]),
});
export const MaintenanceTemplate = z.object({
  id: Uuid, name: z.string(), make: z.string().nullable(), model: z.string().nullable(), status: z.enum(["active", "inactive"]), items: z.array(TemplateItem),
});
export type MaintenanceTemplate = z.infer<typeof MaintenanceTemplate>;
const ItemInput = z.object({
  code: ItemCode, name: z.string().trim().min(2).max(100), intervalKm: z.number().int().positive().nullish(), intervalMonths: z.number().int().positive().max(120).nullish(),
  safety: z.boolean().default(false),
}).refine((i) => i.intervalKm != null || i.intervalMonths != null, { message: "interval_required", path: ["intervalKm"] });
export const CreateTemplateRequest = z.object({
  id: Uuid.optional(), name: z.string().trim().min(2).max(100), make: z.string().trim().max(64).nullish(), model: z.string().trim().max(64).nullish(),
  items: z.array(ItemInput).min(1).max(50),
}).refine((t) => !t.model || !!t.make, { message: "make_required", path: ["make"] });
export const UpdateTemplateRequest = z.object({ name: z.string().trim().min(2).max(100).optional(), status: z.enum(["active", "inactive"]).optional() });
export const AddTemplateItemRequest = ItemInput;
export const UpdateTemplateItemRequest = z.object({
  name: z.string().trim().min(2).max(100).optional(), intervalKm: z.number().int().positive().nullable().optional(),
  intervalMonths: z.number().int().positive().max(120).nullable().optional(), safety: z.boolean().optional(), status: z.enum(["active", "inactive"]).optional(),
});

export const ItemDue = z.object({
  status: z.enum(["ok", "upcoming", "due", "overdue", "unknown_baseline"]), dueKm: z.number().nullable(), dueDate: IsoDate.nullable(),
  remainingKm: z.number().nullable(), remainingDays: z.number().nullable(), forecastDate: IsoDate.nullable(), quality: z.enum(["reliable", "estimated", "unavailable"]),
});
export const VehicleMaintenanceItem = z.object({
  code: z.string(), name: z.string(), safety: z.boolean(), templateId: Uuid,
  intervalKm: z.number().int().nullable(), intervalMonths: z.number().int().nullable(), overridden: z.boolean(),
  baseline: z.object({ doneOn: IsoDate, odometer: z.number().int().nullable(), sourceType: z.enum(["visit", "opening"]) }).nullable(),
  due: ItemDue,
});
export const VehicleMaintenance = z.object({
  vehicleId: Uuid, currentOdometer: z.number().int().nullable(), kmPerDay: z.number().nullable(), items: z.array(VehicleMaintenanceItem),
});
export const SetOverrideRequest = z.object({ intervalKm: z.number().int().positive().nullable(), intervalMonths: z.number().int().positive().max(120).nullable() })
  .refine((o) => o.intervalKm != null || o.intervalMonths != null, { message: "interval_required", path: ["intervalKm"] });
export const SetBaselineRequest = z.object({ doneOn: IsoDate, odometer: z.number().int().min(0).nullable() });
export const MaintenanceDueRow = z.object({ vehicleId: Uuid, fleetNumber: z.string(), branchId: Uuid, code: z.string(), name: z.string(), safety: z.boolean(), due: ItemDue });
export const MaintenanceDueQuery = z.object({ status: z.enum(["upcoming", "due", "overdue", "unknown_baseline"]).optional() });

export const DEFECT_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const Defect = z.object({
  id: Uuid, vehicleId: Uuid, branchId: Uuid, driverId: Uuid.nullable(), reportedAt: IsoDateTime, recordedAt: IsoDateTime, description: z.string(),
  severity: z.enum(DEFECT_SEVERITIES), drivable: z.boolean(), hasPhoto: z.boolean(),
  status: z.enum(["reported", "triaged", "converted", "rejected", "duplicate"]), decidedBy: Uuid.nullable(), decidedAt: IsoDateTime.nullable(),
  decisionReason: z.string().nullable(), workOrderId: Uuid.nullable(), duplicateOf: Uuid.nullable(), flags: z.array(z.string()), createdBy: Uuid,
});
export type Defect = z.infer<typeof Defect>;
export const CreateDefectRequest = z.object({
  id: Uuid.optional(), vehicleId: Uuid, driverId: Uuid.nullish(), description: z.string().trim().min(3).max(1000),
  severity: z.enum(DEFECT_SEVERITIES), drivable: z.boolean(),
});
export const ListDefectsQuery = z.object({ status: z.enum(["reported", "triaged", "converted", "rejected", "duplicate", "open"]).optional(), vehicleId: Uuid.optional() });
export const RejectDefectRequest = z.object({ reason: z.string().trim().min(3).max(500) });
export const DuplicateDefectRequest = z.object({ duplicateOf: Uuid, reason: z.string().trim().min(3).max(500) });
export const ConvertDefectRequest = z.object({
  title: z.string().trim().min(3).max(200), type: MaintType.default("corrective"), notDrivable: z.boolean(), scheduledFor: IsoDate.nullish(), vendorId: Uuid.nullish(),
});

export const WORK_ORDER_STATUSES = ["open", "scheduled", "in_progress", "completed", "closed", "cancelled"] as const;
export const WorkOrder = z.object({
  id: Uuid, vehicleId: Uuid, branchId: Uuid, defectId: Uuid.nullable(), type: MaintType, title: z.string(), notDrivable: z.boolean(),
  status: z.enum(WORK_ORDER_STATUSES), scheduledFor: IsoDate.nullable(), vendorId: Uuid.nullable(), offRoadAt: IsoDateTime.nullable(),
  returnToServiceAt: IsoDateTime.nullable(), downtimeHours: z.number().nullable(), closeReason: z.string().nullable(), hasCompletedVisit: z.boolean(),
  createdBy: Uuid, createdAt: IsoDateTime,
});
export type WorkOrder = z.infer<typeof WorkOrder>;
export const CreateWorkOrderRequest = z.object({
  id: Uuid.optional(), vehicleId: Uuid, type: MaintType, title: z.string().trim().min(3).max(200), notDrivable: z.boolean().default(false),
  scheduledFor: IsoDate.nullish(), vendorId: Uuid.nullish(), offRoadAt: IsoDateTime.optional(),
});
export const WorkOrderStatusRequest = z.object({ status: z.enum(["scheduled", "in_progress", "completed", "closed", "cancelled"]), reason: z.string().trim().min(3).max(500).optional(), scheduledFor: IsoDate.optional() });
export const ListWorkOrdersQuery = z.object({ status: z.enum([...WORK_ORDER_STATUSES, "active"]).optional(), vehicleId: Uuid.optional() });

export const MaintenanceVisit = z.object({
  id: Uuid, vehicleId: Uuid, branchId: Uuid, workOrderId: Uuid.nullable(), vendorId: Uuid.nullable(), type: MaintType, visitDate: IsoDate,
  odometer: z.number().int().nullable(), readingStatus: z.string().nullable(), netMinor: z.number().int().nullable(), taxMinor: z.number().int(),
  grossMinor: z.number().int().nullable(), currency: z.string(), partsMinor: z.number().int().nullable(), laborMinor: z.number().int().nullable(),
  otherMinor: z.number().int().nullable(), unallocatedMinor: z.number().int().nullable(), invoiceRef: z.string().nullable(), notes: z.string().nullable(),
  items: z.array(z.string()), status: z.enum(["draft", "completed", "voided"]), completedAt: IsoDateTime.nullable(), costId: Uuid.nullable(), createdBy: Uuid,
});
export type MaintenanceVisit = z.infer<typeof MaintenanceVisit>;
export const CreateVisitRequest = z.object({
  id: Uuid.optional(), vehicleId: Uuid, workOrderId: Uuid.nullish(), vendorId: Uuid.nullish(), type: MaintType, visitDate: IsoDate,
  odometer: z.number().int().min(0).nullish(), netMinor: z.number().int().min(0).nullish(), taxMinor: z.number().int().min(0).default(0),
  partsMinor: z.number().int().min(0).nullish(), laborMinor: z.number().int().min(0).nullish(), otherMinor: z.number().int().min(0).nullish(),
  invoiceRef: z.string().trim().max(64).nullish(), notes: z.string().trim().max(1000).nullish(), items: z.array(ItemCode).max(50).default([]),
  complete: z.boolean().default(false),
});
export const ListVisitsQuery = z.object({ vehicleId: Uuid.optional(), workOrderId: Uuid.optional() });

export const ReadinessQuery = z.object({ vehicleId: Uuid.optional(), driverId: Uuid.optional() });
export const ReadinessRule = z.object({
  code: z.string(), dimension: z.string(), name: z.object({ ar: z.string(), en: z.string() }),
  defaultRisk: z.union([z.enum(["R1", "R2", "R3", "R4"]), z.literal("document_type")]), companyRisk: z.enum(["R1", "R2", "R3", "R4"]).nullable(), configurable: z.boolean(),
});
export const SetRuleRiskRequest = z.object({ risk: z.enum(["R1", "R2", "R3", "R4"]) });
export const ReadinessOverride = z.object({
  id: Uuid, ruleCode: z.string(), entityType: z.enum(["vehicle", "driver"]), entityId: Uuid, subject: z.string().nullable(), risk: z.enum(["R2", "R3"]),
  reason: z.string(), expiresAt: IsoDateTime, createdBy: Uuid, createdAt: IsoDateTime, revokedAt: IsoDateTime.nullable(), active: z.boolean(),
});
export const CreateOverrideRequest = z.object({
  ruleCode: z.string().max(64), entityType: z.enum(["vehicle", "driver"]), entityId: Uuid, subject: z.string().max(64).nullish(),
  reason: z.string().trim().min(3).max(500), expiresAt: IsoDateTime,
});
export const ListOverridesQuery = z.object({ entityType: z.enum(["vehicle", "driver"]).optional(), entityId: Uuid.optional() });
export const VehicleReadinessRow = z.object({ vehicleId: Uuid, outcome: z.enum(["allowed", "warning", "restricted"]), codes: z.array(z.string()) });

// ---------- M5: alerts & notifications (E13), fuel budgets (FUEL-015) ----------
const AlertStatusE = z.enum(["open", "acknowledged", "in_progress", "resolved", "closed"]);
export const Alert = z.object({
  id: Uuid, type: z.string(), severity: z.enum(["low", "medium", "high", "critical"]), status: AlertStatusE, escalated: z.boolean(), level: z.number().int(),
  entityType: z.string(), entityId: Uuid, branchId: Uuid.nullable(), subject: z.string().nullable(), params: z.record(z.string(), z.unknown()),
  ownerId: Uuid.nullable(), ownerName: z.string().nullable(), escalationOwnerId: Uuid.nullable(), ownerFallback: z.boolean(),
  createdAt: IsoDateTime, updatedAt: IsoDateTime, acknowledgedAt: IsoDateTime.nullable(), resolvedAt: IsoDateTime.nullable(),
  resolution: z.enum(["auto", "manual"]).nullable(), resolutionNote: z.string().nullable(), closedAt: IsoDateTime.nullable(),
});
export type Alert = z.infer<typeof Alert>;
export const ListAlertsQuery = z.object({
  status: z.enum(["active", "open", "acknowledged", "in_progress", "resolved", "closed", "all"]).optional(),
  type: z.string().max(64).optional(), entityId: Uuid.optional(), mine: z.enum(["true", "false"]).optional(),
});
export const AlertStatusRequest = z.object({ status: z.enum(["acknowledged", "in_progress", "resolved", "closed"]), note: z.string().trim().min(3).max(500).optional() });
export const AlertScanResult = z.object({ created: z.number().int(), escalated: z.number().int(), resolved: z.number().int(), notified: z.number().int() });
export const Notification = z.object({
  id: Uuid, alertId: Uuid, recipientId: Uuid, channel: z.enum(["email", "push", "in_app"]), locale: z.enum(["ar", "en"]), address: z.string().nullable(),
  subject: z.string(), status: z.enum(["queued", "sent", "failed", "skipped"]), attempts: z.number().int(), lastError: z.string().nullable(),
  provider: z.string().nullable(), createdAt: IsoDateTime, sentAt: IsoDateTime.nullable(), readAt: IsoDateTime.nullable(),
});
export const ListNotificationsQuery = z.object({ status: z.enum(["queued", "sent", "failed", "skipped"]).optional(), alertId: Uuid.optional() });

const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month_format");
export const FuelBudget = z.object({
  id: Uuid, scope: z.enum(["company", "branch", "vehicle"]), branchId: Uuid.nullable(), vehicleId: Uuid.nullable(), month: Month,
  amountMinor: z.number().int().nullable(), liters: z.number().nullable(),
});
export const SetFuelBudgetRequest = z.object({
  scope: z.enum(["company", "branch", "vehicle"]), branchId: Uuid.nullish(), vehicleId: Uuid.nullish(), month: Month,
  amountMinor: z.number().int().positive().nullish(), liters: z.number().positive().nullish(),
}).refine((b) => b.amountMinor != null || b.liters != null, { message: "amount_or_liters", path: ["amountMinor"] });
export const FuelBudgetQuery = z.object({ month: Month.optional() });
export const FuelBudgetStatus = FuelBudget.extend({
  actualMinor: z.number().int(), actualLiters: z.number(), amountPercent: z.number().nullable(), litersPercent: z.number().nullable(),
  varianceMinor: z.number().int().nullable(), threshold: z.number().nullable(),
});

// ---------- M5: traffic fines (E29) ----------
export const Fine = z.object({
  id: Uuid, vehicleId: Uuid, branchId: Uuid, violationAt: IsoDateTime, amountMinor: z.number().int(), currency: z.string(), authorityRef: z.string().nullable(),
  dueDate: IsoDate.nullable(), description: z.string().nullable(), paymentStatus: z.enum(["unpaid", "paid", "disputed"]), paidOn: IsoDate.nullable(),
  suggestedDriverId: Uuid.nullable(), driverId: Uuid.nullable(), driverConfirmedAt: IsoDateTime.nullable(), source: z.enum(["manual", "import"]),
  status: z.enum(["active", "voided"]), voidReason: z.string().nullable(), costId: Uuid.nullable(), createdAt: IsoDateTime,
});
export type Fine = z.infer<typeof Fine>;
export const CreateFineRequest = z.object({
  id: Uuid.optional(), vehicleId: Uuid, violationAt: IsoDateTime, amountMinor: z.number().int().positive(), authorityRef: z.string().trim().min(2).max(64).nullish(),
  dueDate: IsoDate.nullish(), description: z.string().trim().max(500).nullish(),
  /** The responsible driver as confirmed by the user; null = no custodian. Omitted = not confirmed yet. */
  driverId: Uuid.nullish(),
});
export const ListFinesQuery = z.object({ vehicleId: Uuid.optional(), paymentStatus: z.enum(["unpaid", "paid", "disputed"]).optional(), includeVoided: z.enum(["true", "false"]).optional() });
export const ConfirmFineDriverRequest = z.object({ driverId: Uuid.nullable() });
export const FinePaymentRequest = z.object({ paymentStatus: z.enum(["unpaid", "paid", "disputed"]), paidOn: IsoDate.optional() });
export const VoidFineRequest = z.object({ reason: z.string().trim().min(3).max(500) });
export const SuggestDriverQuery = z.object({ vehicleId: Uuid, at: IsoDateTime });
export const SuggestedDriver = z.object({ driverId: Uuid.nullable(), driverName: z.string().nullable() });

// ---------- M5: dashboards, KPIs & reports (E18) ----------
export const DashboardQuery = z.object({ from: IsoDate.optional(), to: IsoDate.optional(), branchId: Uuid.optional() });
/** US-E16-03: a month whose KPIs are (being) recalculated, and why. */
export const KpiRecalculation = z.object({
  id: Uuid, month: IsoDate, causeType: z.literal("correction"), causeId: Uuid, reason: z.string(), status: z.enum(["pending", "done"]),
  requestedAt: IsoDateTime, completedAt: IsoDateTime.nullable(),
  /** Headline values before and after (done only): cost per km, fuel consumption, operating cost. */
  before: z.record(z.string(), z.number().nullable()).nullable(), after: z.record(z.string(), z.number().nullable()).nullable(),
});
export type KpiRecalculation = z.infer<typeof KpiRecalculation>;
export const KpiRecalculateResult = z.object({ processed: z.number().int(), months: z.array(IsoDate) });
export const Dashboard = z.object({
  from: IsoDate, to: IsoDate, currency: z.string(),
  vehicles: z.object({ total: z.number().int(), active: z.number().int(), restricted: z.number().int(), available: z.number().int() }),
  costs: z.object({ operatingMinor: z.number().int(), fuelMinor: z.number().int(), maintenanceMinor: z.number().int(), finesMinor: z.number().int() }),
  kpis: z.object({
    fuelConsumption: Measured, fuelCostPerKm: Measured, costPerKm: Measured, maintenanceCompliance: Measured, documentCompliance: Measured,
    availability: Measured, dataCoverage: Measured, syncSuccess: Measured, fuelBudgetVariance: Measured,
  }),
  distance: Measured,
  openAlerts: z.number().int(), overdueMaintenance: z.number().int(),
  fleet: z.object({
    byBranch: z.array(z.object({ branchId: Uuid, name: z.string(), vehicles: z.number().int(), restricted: z.number().int() })),
    activeAssignments: z.number().int(), documentsExpiring: z.number().int(), pendingVerifications: z.number().int(), maintenanceDue: z.number().int(),
    openWorkOrders: z.number().int(), fuelSpendMinor: z.number().int(), fuelBudgetMinor: z.number().int().nullable(), syncConflicts: z.number().int(),
  }),
  /** US-E16-03: true while a month of the period is being recalculated after a correction. */
  recalculating: z.boolean(),
  /** Recalculations of the period's months, newest first (the reason the numbers changed). */
  recalculations: z.array(KpiRecalculation),
});
export type Dashboard = z.infer<typeof Dashboard>;
export const REPORT_IDS = ["fuel", "maintenance", "documents", "costs", "odometer_exceptions", "assignments", "audit", "fines"] as const;
export type ReportId = (typeof REPORT_IDS)[number];
export const ReportQuery = z.object({
  from: IsoDate.optional(), to: IsoDate.optional(), branchId: Uuid.optional(),
  /** Vehicle class (the license category the vehicle needs: PRO1…PRIVATE) — the Pilot's "vehicle type". */
  vehicleClass: z.string().max(32).optional(),
  format: z.enum(["csv", "xlsx"]).optional(), locale: z.enum(["ar", "en"]).optional(),
});
export const Report = z.object({
  id: z.enum(REPORT_IDS), from: IsoDate, to: IsoDate,
  columns: z.array(z.object({ key: z.string(), label: z.string(), type: z.enum(["text", "number", "money", "date", "datetime"]) })),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))),
  totals: z.record(z.string(), z.number()),
  /** Drill-down: the source record of each row (RPT-010). */
  links: z.array(z.object({ entityType: z.string(), entityId: Uuid }).nullable()),
});
export type Report = z.infer<typeof Report>;

// ---------- M5: import & onboarding (E17) ----------
export const IMPORT_ENTITIES = ["vehicles", "drivers", "opening_odometer", "fines", "costs"] as const;
export const ImportRowError = z.object({ row: z.number().int(), column: z.string(), code: z.string() });
export const ImportBatch = z.object({
  id: Uuid, entity: z.enum(IMPORT_ENTITIES), mode: z.enum(["all_or_nothing", "partial"]),
  status: z.enum(["validated", "imported", "partially_imported", "failed", "rolled_back"]),
  fileName: z.string(), rowCount: z.number().int(), errorCount: z.number().int(), importedCount: z.number().int(),
  mapping: z.record(z.string(), z.string()), errors: z.array(ImportRowError),
  /** Preview: the first rows as mapped (IMP-002). */
  preview: z.array(z.record(z.string(), z.string())),
  createdBy: Uuid, createdAt: IsoDateTime, importedAt: IsoDateTime.nullable(), rolledBackAt: IsoDateTime.nullable(), rollbackReason: z.string().nullable(),
  canRollback: z.boolean(),
});
export type ImportBatch = z.infer<typeof ImportBatch>;
export const CreateImportRequest = z.object({
  entity: z.enum(IMPORT_ENTITIES), fileName: z.string().trim().min(1).max(200),
  /** The CSV or XLSX file, base64. */
  content: z.string().min(1).max(7_000_000),
  /** Optional: file header → template field. Unmapped headers are matched by name. */
  mapping: z.record(z.string(), z.string()).optional(),
  /** Master data only; financial records are always all-or-nothing (IMP-003). */
  mode: z.enum(["all_or_nothing", "partial"]).optional(),
});
export const RollbackImportRequest = z.object({ reason: z.string().trim().min(3).max(500) });

// ---------- M6: break-glass support access (SEC-007) ----------
export const SupportGrant = z.object({
  id: Uuid, tenantId: Uuid, tenantName: z.string(), requestedBy: Uuid, requestedByName: z.string(), reason: z.string(),
  status: z.enum(["requested", "approved", "rejected", "revoked", "expired"]), decidedBy: Uuid.nullable(), decidedAt: IsoDateTime.nullable(),
  expiresAt: IsoDateTime.nullable(), createdAt: IsoDateTime,
});
export const RequestSupportAccess = z.object({ reason: z.string().trim().min(10).max(500) });
export const DecideSupportAccess = z.object({ approve: z.boolean() });

// ---------- M6: operations (NFR-008 / US-E19-02) ----------
const OpsKindE = z.enum(["sync", "notification", "import", "job", "api_error", "backup", "security"]);
export const OpsEvent = z.object({
  id: z.number().int(), at: IsoDateTime, tenantId: Uuid.nullable(), tenantName: z.string().nullable(), kind: OpsKindE,
  severity: z.enum(["info", "warning", "error", "critical"]), code: z.string(), detail: z.record(z.string(), z.unknown()),
});
export const OpsQuery = z.object({ kind: OpsKindE.optional(), tenantId: Uuid.optional(), sinceMinutes: z.coerce.number().int().min(1).max(60 * 24 * 30).optional() });
export const OpsSummary = z.object({
  windowMinutes: z.number().int(),
  rows: z.array(z.object({ tenantId: Uuid.nullable(), tenantName: z.string().nullable(), kind: OpsKindE, errors: z.number().int(), warnings: z.number().int(), lastAt: IsoDateTime })),
  lastBackup: z.object({ at: IsoDateTime, code: z.string(), severity: z.string() }).nullable(),
});

// ---------- M6: consent (PRV-002 / US-E19-04) ----------
export const RecordConsentRequest = z.object({
  id: Uuid.optional(), kind: z.enum(["camera", "photos", "location", "notifications"]), decision: z.enum(["granted", "denied"]), decidedAt: IsoDateTime, appVersion: z.string().max(40).nullish(),
});
export const Consent = z.object({
  id: Uuid, identityId: Uuid, driverId: Uuid.nullable(), deviceId: Uuid.nullable(), kind: z.enum(["camera", "photos", "location", "notifications"]),
  decision: z.enum(["granted", "denied"]), appVersion: z.string().nullable(), decidedAt: IsoDateTime,
});
export const ListConsentsQuery = z.object({ driverId: Uuid });

// ---------- Push notifications (NTF-001) ----------
/** An Expo push token of this device; null turns push off for the device. */
export const RegisterPushTokenRequest = z.object({ token: z.string().regex(/^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]{10,}\]$/).nullable() });

// ---------- Effective-dated policies (GEN-007 / US-E03-03) ----------
export const PolicyVersion = z.object({
  id: Uuid, key: z.string(), value: z.number(), effectiveFrom: IsoDate, retroactive: z.boolean(), reason: z.string(), recalculated: z.number().int(),
  createdBy: Uuid, createdAt: IsoDateTime,
});
export const Policy = z.object({
  key: z.string(), name: z.object({ ar: z.string(), en: z.string() }), unit: z.string(), min: z.number(), max: z.number(), default: z.number(),
  current: z.number(), next: z.object({ value: z.number(), effectiveFrom: IsoDate }).nullable(), versions: z.array(PolicyVersion),
});
export const SetPolicyRequest = z.object({
  value: z.number(), effectiveFrom: IsoDate, reason: z.string().trim().min(3).max(500),
  /** Explicit decision to apply from a past date; the affected records are recalculated (GEN-007). */
  retroactive: z.boolean().default(false),
});

export const ListOf = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item) });

// ---------- M3: offline & sync (E14, docs/M3_Offline_Design.md) ----------
export const SyncEventType = z.enum(["fuel.create", "odometer.record", "defect.report"]);
export type SyncEventType = z.infer<typeof SyncEventType>;
/** fuel.create: the entry id is the event id; the time comes from the event, the driver from the device. */
export const FuelCreatePayload = CreateFuelEntryRequest.omit({ id: true, eventAt: true, driverId: true });
/** Where the phone was when the meter photo was taken. */
export const GeoPoint = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracyM: z.number().min(0).max(100_000).nullable() });
/**
 * odometer.record. The driver app also sends when the meter photo was taken and where (owner decision,
 * 13 Nov 2026); the photo itself follows through the resumable upload (odometer_photo). A denied or
 * unavailable location does not block the reading.
 */
export const OdometerRecordPayload = z.object({
  vehicleId: Uuid, odometer: z.number().int().min(0).max(9_999_999),
  photoTakenAt: IsoDateTime.optional(),
  location: GeoPoint.nullable().optional(),
  locationStatus: z.enum(["ok", "denied", "unavailable"]).optional(),
});
/** defect.report (WO-001): works offline; the photo follows through the resumable upload (defect_photo). */
export const DefectReportPayload = z.object({
  vehicleId: Uuid, description: z.string().trim().min(3).max(1000), severity: z.enum(["low", "medium", "high", "critical"]), drivable: z.boolean(),
});
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
export const ReadinessReason = z.object({
  code: z.string(), dimension: z.enum(["vehicle", "driver", "availability", "authorization"]), entityType: z.enum(["vehicle", "driver"]), entityId: Uuid,
  subject: z.string().nullable(), risk: z.enum(["R1", "R2", "R3", "R4"]), outcome: z.enum(["allowed", "warning", "restricted"]),
  overrideId: Uuid.nullable(), overrideExpiresAt: IsoDateTime.nullable(),
});
export type ReadinessReason = z.infer<typeof ReadinessReason>;
export const Readiness = z.object({ outcome: z.enum(["allowed", "warning", "restricted"]), reasons: z.array(ReadinessReason), evaluatedAt: IsoDateTime });
export type Readiness = z.infer<typeof Readiness>;
export const ReadSet = z.object({
  vehicles: z.array(Vehicle),
  odometer: z.array(z.object({ vehicleId: Uuid, value: z.number().int(), at: IsoDateTime })),
  /** Readiness of the driver with each assigned vehicle, shown to the driver (US-E12-02). */
  readiness: z.array(z.object({ vehicleId: Uuid, outcome: z.enum(["allowed", "warning", "restricted"]), reasons: z.array(ReadinessReason) })).default([]),
  /** US-E18-03 / NTF-001 in-app: the driver's open notices (e.g. a rejected defect report), newest first. */
  notices: z.array(z.object({ id: Uuid, type: z.string(), subject: z.string(), body: z.string(), createdAt: IsoDateTime })).default([]),
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
/** Resumable upload (OFF-008): start (idempotent per record), then send chunks at the offset the server reports. */
export const StartUploadRequest = z.object({
  recordType: z.enum(["fuel_receipt", "defect_photo", "odometer_photo"]),
  recordId: Uuid,
  totalBytes: z.number().int().positive().max(512_000),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export const UploadState = z.object({ uploadId: Uuid, recordType: z.string(), recordId: Uuid, totalBytes: z.number().int(), receivedBytes: z.number().int(), completed: z.boolean() });
export type UploadState = z.infer<typeof UploadState>;
export const ListSyncConflictsQuery = z.object({ status: z.enum(["open", "accepted", "rejected", "corrected"]).optional() });

export const Empty = z.object({});
export const Ok = z.object({ ok: z.literal(true) });

export { TENANT_ROLES };
