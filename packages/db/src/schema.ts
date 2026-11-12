import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, integer, boolean, numeric, bigserial, bigint, jsonb, char, date, customType } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

// ---------------- Control plane ----------------
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  countryCode: char("country_code", { length: 2 }).notNull(),
  homeRegion: text("home_region").notNull(),
  status: text("status").$type<"provisioning" | "active" | "suspended" | "failed" | "terminated">().notNull(),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenantDbLocations = pgTable("tenant_db_locations", {
  tenantId: uuid("tenant_id").primaryKey(),
  host: text("host").notNull(),
  port: integer("port").notNull(),
  dbName: text("db_name").notNull(),
  dbRole: text("db_role").notNull(),
  dbPasswordEnc: text("db_password_enc").notNull(),
  schemaVersion: integer("schema_version"),
});

export const provisioningSteps = pgTable("provisioning_steps", {
  tenantId: uuid("tenant_id").notNull(),
  step: text("step").notNull(),
  status: text("status").$type<"done" | "failed">().notNull(),
  detail: text("detail"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenantMigrations = pgTable("tenant_migrations", {
  tenantId: uuid("tenant_id").notNull(),
  version: integer("version").notNull().default(1),
  status: text("status").$type<"success" | "failed">().notNull(),
  error: text("error"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const identities = pgTable("identities", {
  id: uuid("id").primaryKey(),
  email: text("email"),
  username: text("username"),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash"),
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  mfaSecretEnc: text("mfa_secret_enc"),
  mfaPendingSecretEnc: text("mfa_pending_secret_enc"),
  mfaEnabledAt: timestamp("mfa_enabled_at", { withTimezone: true }),
  mfaLastStep: bigint("mfa_last_step", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenantKeys = pgTable("tenant_keys", {
  tenantId: uuid("tenant_id").primaryKey(),
  dataKeyEnc: text("data_key_enc").notNull(),
});

export const memberships = pgTable("memberships", {
  id: uuid("id").primaryKey(),
  identityId: uuid("identity_id").notNull(),
  tenantId: uuid("tenant_id").notNull(),
  role: text("role").$type<"company_admin" | "fleet_manager" | "finance_reviewer" | "driver" | "viewer">().notNull(),
  branchIds: uuid("branch_ids").array().notNull().default([]),
  driverId: uuid("driver_id"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invites = pgTable("invites", {
  id: uuid("id").primaryKey(),
  identityId: uuid("identity_id").notNull(),
  tenantId: uuid("tenant_id"),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

export const devices = pgTable("devices", {
  id: uuid("id").primaryKey(),
  identityId: uuid("identity_id").notNull(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  platform: text("platform").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  /** SPKI DER, base64, of the device's hardware key (null for devices activated before M3). */
  publicKey: text("public_key"),
  keyAlg: text("key_alg").$type<"ES256">(),
});

export const activationCodes = pgTable("activation_codes", {
  id: uuid("id").primaryKey(),
  identityId: uuid("identity_id").notNull(),
  tenantId: uuid("tenant_id").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull(),
});

export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey(),
  identityId: uuid("identity_id").notNull(),
  membershipId: uuid("membership_id"),
  deviceId: uuid("device_id"),
  familyId: uuid("family_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  replacedBy: uuid("replaced_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const fuelPrices = pgTable("fuel_prices", {
  id: uuid("id").primaryKey(),
  countryCode: char("country_code", { length: 2 }).notNull(),
  fuelType: text("fuel_type").notNull(),
  priceMinor: integer("price_minor").notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const platformAudit = pgTable("platform_audit", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  actorId: uuid("actor_id"),
  tenantId: uuid("tenant_id"),
  action: text("action").notNull(),
  detail: jsonb("detail").notNull().default({}),
});

// ---------------- Tenant ----------------
export const company = pgTable("company", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  countryCode: char("country_code", { length: 2 }).notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  timezone: text("timezone").notNull().default("Africa/Cairo"),
});

export const branches = pgTable("branches", {
  id: uuid("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Africa/Cairo"),
  weekendDays: integer("weekend_days").array().notNull().default([5]),
  status: text("status").$type<"active" | "inactive">().notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const vendors = pgTable("vendors", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").$type<"workshop" | "fuel_provider" | "lessor" | "insurer" | "other">().notNull(),
  contactName: text("contact_name"),
  phone: text("phone"),
  email: text("email"),
  taxId: text("tax_id"),
  branchIds: uuid("branch_ids").array().notNull().default([]),
  status: text("status").$type<"active" | "inactive">().notNull().default("active"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const vehicleBranchHistory = pgTable("vehicle_branch_history", {
  id: uuid("id").primaryKey(),
  vehicleId: uuid("vehicle_id").notNull(),
  fromBranchId: uuid("from_branch_id").notNull(),
  toBranchId: uuid("to_branch_id").notNull(),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
  reason: text("reason"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documentTypes = pgTable("document_types", {
  code: text("code").primaryKey(),
  entityType: text("entity_type").$type<"vehicle" | "driver">().notNull(),
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  mandatory: boolean("mandatory").notNull(),
  hasExpiry: boolean("has_expiry").notNull(),
  risk: text("risk").$type<"R1" | "R2" | "R3" | "R4">().notNull(),
  driverVisibility: text("driver_visibility").$type<"none" | "view" | "download">().notNull().default("none"),
  sensitive: boolean("sensitive").notNull().default(false),
  status: text("status").$type<"active" | "inactive">().notNull().default("active"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documentTypeSettings = pgTable("document_type_settings", {
  code: text("code").primaryKey(),
  mandatory: boolean("mandatory"),
  driverVisibility: text("driver_visibility").$type<"none" | "view" | "download">(),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey(),
  entityType: text("entity_type").$type<"vehicle" | "driver">().notNull(),
  entityId: uuid("entity_id").notNull(),
  typeCode: text("type_code").notNull(),
  number: text("number"),
  issueDate: date("issue_date"),
  expiryDate: date("expiry_date"),
  countryCode: char("country_code", { length: 2 }),
  version: integer("version").notNull().default(1),
  status: text("status").$type<"draft" | "pending" | "verified" | "rejected" | "superseded">().notNull(),
  fileKey: text("file_key"),
  fileName: text("file_name"),
  fileMime: text("file_mime"),
  fileSize: integer("file_size"),
  fileSha256: text("file_sha256"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  verifiedBy: uuid("verified_by"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  supersededBy: uuid("superseded_by"),
});

export const vehicles = pgTable("vehicles", {
  id: uuid("id").primaryKey(),
  branchId: uuid("branch_id").notNull(),
  fleetNumber: text("fleet_number").notNull(),
  registrationNumber: text("registration_number").notNull(),
  registrationNormalized: text("registration_normalized").notNull(),
  vin: text("vin"),
  make: text("make").notNull(),
  model: text("model").notNull(),
  year: integer("year").notNull(),
  primaryFuelType: text("primary_fuel_type").notNull(),
  primaryTankCapacity: numeric("primary_tank_capacity", { precision: 10, scale: 3, mode: "number" }).notNull(),
  secondaryFuelType: text("secondary_fuel_type"),
  secondaryTankCapacity: numeric("secondary_tank_capacity", { precision: 10, scale: 3, mode: "number" }),
  meterType: text("meter_type").$type<"distance" | "hours" | "both">().notNull(),
  requiredLicenseCategory: text("required_license_category").notNull(),
  ownershipType: text("ownership_type").$type<"owned" | "leased" | "rented">().notNull(),
  status: text("status").$type<"draft" | "active" | "inactive" | "disposed">().notNull(),
  disposedAt: date("disposed_at"),
  disposalReason: text("disposal_reason").$type<"sold" | "scrapped" | "returned">(),
  disposalOdometer: integer("disposal_odometer"),
  disposalValueMinor: bigint("disposal_value_minor", { mode: "number" }),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const drivers = pgTable("drivers", {
  id: uuid("id").primaryKey(),
  branchId: uuid("branch_id").notNull(),
  identityId: uuid("identity_id").notNull(),
  fullName: text("full_name").notNull(),
  username: text("username").notNull(),
  phone: text("phone"),
  status: text("status").$type<"active" | "inactive">().notNull(),
  employeeRef: text("employee_ref"),
  nationalIdEnc: text("national_id_enc"),
  nationalIdBidx: text("national_id_bidx"),
  nationalIdMask: text("national_id_mask"),
  licenseNumber: text("license_number"),
  licenseCategories: text("license_categories").array().notNull().default([]),
  licenseExpiry: date("license_expiry"),
  employmentStatus: text("employment_status").$type<"active" | "suspended" | "terminated">().notNull().default("active"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  actorId: uuid("actor_id"),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: uuid("entity_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  branchId: uuid("branch_id"),
});

// ---------------- Tenant: M2 ledgers ----------------
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const assignments = pgTable("assignments", {
  id: uuid("id").primaryKey(),
  vehicleId: uuid("vehicle_id").notNull(),
  driverId: uuid("driver_id").notNull(),
  role: text("role").$type<"primary" | "secondary">().notNull(),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at"),
  status: text("status").$type<"active" | "cancelled">().notNull().default("active"),
  notes: text("notes"),
  createdBy: uuid("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const meterReplacements = pgTable("meter_replacements", {
  id: uuid("id").primaryKey(),
  vehicleId: uuid("vehicle_id").notNull(),
  eventAt: ts("event_at").notNull(),
  oldFinal: integer("old_final").notNull(),
  newStart: integer("new_start").notNull(),
  reason: text("reason"),
  createdBy: uuid("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type ReadingSource = "opening" | "manual" | "fuel" | "handover" | "replacement" | "correction";
export const meterReadings = pgTable("meter_readings", {
  id: uuid("id").primaryKey(),
  vehicleId: uuid("vehicle_id").notNull(),
  value: integer("value").notNull(),
  eventAt: ts("event_at").notNull(),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
  sourceType: text("source_type").$type<ReadingSource>().notNull(),
  sourceId: uuid("source_id"),
  status: text("status").$type<"valid" | "warning" | "conflict" | "corrected" | "excluded">().notNull(),
  reasons: text("reasons").array().notNull().default([]),
  corroborates: uuid("corroborates").array().notNull().default([]),
  correctedBy: uuid("corrected_by"),
  createdBy: uuid("created_by").notNull(),
});

export const handovers = pgTable("handovers", {
  id: uuid("id").primaryKey(),
  vehicleId: uuid("vehicle_id").notNull(),
  fromDriverId: uuid("from_driver_id"),
  toDriverId: uuid("to_driver_id").notNull(),
  eventAt: ts("event_at").notNull(),
  odometer: integer("odometer").notNull(),
  readingId: uuid("reading_id"),
  notes: text("notes"),
  createdBy: uuid("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const fuelEntries = pgTable("fuel_entries", {
  id: uuid("id").primaryKey(),
  vehicleId: uuid("vehicle_id").notNull(),
  driverId: uuid("driver_id"),
  branchId: uuid("branch_id").notNull(),
  eventAt: ts("event_at").notNull(),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
  odometer: integer("odometer").notNull(),
  readingId: uuid("reading_id"),
  fuelType: text("fuel_type").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 3, mode: "number" }).notNull(),
  unit: text("unit").$type<"L" | "m3">().notNull(),
  isFull: boolean("is_full").notNull(),
  netMinor: bigint("net_minor", { mode: "number" }).notNull(),
  taxMinor: bigint("tax_minor", { mode: "number" }).notNull().default(0),
  grossMinor: bigint("gross_minor", { mode: "number" }).generatedAlwaysAs(sql`net_minor + tax_minor`),
  currency: char("currency", { length: 3 }).notNull(),
  payment: text("payment").$type<"cash" | "card">().notNull(),
  receiptRef: text("receipt_ref"),
  receiptFileKey: text("receipt_file_key"),
  receiptFileMime: text("receipt_file_mime"),
  referencePriceMinor: integer("reference_price_minor"),
  referenceOfficial: boolean("reference_official"),
  status: text("status").$type<"submitted" | "under_review" | "accepted" | "voided">().notNull(),
  flags: text("flags").array().notNull().default([]),
  notes: text("notes"),
  createdBy: uuid("created_by").notNull(),
  reviewedBy: uuid("reviewed_by"),
  reviewedAt: ts("reviewed_at"),
  voidReason: text("void_reason"),
});

export const costRecords = pgTable("cost_records", {
  id: uuid("id").primaryKey(),
  category: text("category").$type<"fuel" | "preventive" | "corrective" | "accident" | "insurance" | "licensing" | "rental" | "fines" | "tolls" | "other">().notNull(),
  vehicleId: uuid("vehicle_id"),
  branchId: uuid("branch_id").notNull(),
  vendorId: uuid("vendor_id"),
  netMinor: bigint("net_minor", { mode: "number" }).notNull(),
  taxMinor: bigint("tax_minor", { mode: "number" }).notNull().default(0),
  grossMinor: bigint("gross_minor", { mode: "number" }).generatedAlwaysAs(sql`net_minor + tax_minor`),
  currency: char("currency", { length: 3 }).notNull(),
  taxRecoverable: boolean("tax_recoverable").notNull(),
  expenseDate: date("expense_date").notNull(),
  sourceType: text("source_type").$type<"manual" | "fuel" | "maintenance" | "provider" | "fine">().notNull(),
  sourceId: uuid("source_id"),
  eInvoiceUuid: text("e_invoice_uuid"),
  description: text("description"),
  status: text("status").$type<"active" | "voided">().notNull().default("active"),
  flags: text("flags").array().notNull().default([]),
  createdBy: uuid("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const corrections = pgTable("corrections", {
  id: uuid("id").primaryKey(),
  recordType: text("record_type").$type<"fuel_entry" | "meter_reading" | "cost_record">().notNull(),
  recordId: uuid("record_id").notNull(),
  branchId: uuid("branch_id").notNull(),
  changes: jsonb("changes").$type<Record<string, { from: unknown; to: unknown }>>().notNull(),
  reason: text("reason").notNull(),
  financial: boolean("financial").notNull(),
  status: text("status").$type<"pending" | "applied" | "rejected">().notNull(),
  requestedBy: uuid("requested_by").notNull(),
  requestedAt: ts("requested_at").notNull().defaultNow(),
  decidedBy: uuid("decided_by"),
  decidedAt: ts("decided_at"),
  decisionNote: text("decision_note"),
  affectedFrom: date("affected_from"),
  affectedTo: date("affected_to"),
});

// ---------- M3: offline & sync (E14) ----------
export const offlineGrants = pgTable("offline_grants", {
  id: uuid("id").primaryKey(),
  deviceId: uuid("device_id").notNull(),
  identityId: uuid("identity_id").notNull(),
  driverId: uuid("driver_id"),
  vehicleIds: uuid("vehicle_ids").array().notNull().default([]),
  issuedAt: ts("issued_at").notNull(),
  expiresAt: ts("expires_at").notNull(),
});

export const deviceSyncState = pgTable("device_sync_state", {
  deviceId: uuid("device_id").primaryKey(),
  lastAppliedSeq: bigint("last_applied_seq", { mode: "number" }).notNull().default(0),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export type SyncEventStatus = "held" | "accepted" | "warning" | "conflict" | "rejected";
export const ingestedEvents = pgTable("ingested_events", {
  eventId: uuid("event_id").primaryKey(),
  deviceId: uuid("device_id").notNull(),
  deviceSeq: bigint("device_seq", { mode: "number" }).notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  deviceTime: ts("device_time").notNull(),
  serverTime: ts("server_time").notNull().defaultNow(),
  estimatedTime: ts("estimated_time"),
  clockDriftMs: bigint("clock_drift_ms", { mode: "number" }),
  elapsedMs: bigint("elapsed_ms", { mode: "number" }),
  grantId: uuid("grant_id"),
  status: text("status").$type<SyncEventStatus>().notNull(),
  flags: text("flags").array().notNull().default([]),
  result: jsonb("result").$type<Record<string, unknown>>(),
  recordType: text("record_type"),
  recordId: uuid("record_id"),
  createdBy: uuid("created_by").notNull(),
  appliedAt: ts("applied_at"),
});

export const uploads = pgTable("uploads", {
  id: uuid("id").primaryKey(),
  recordType: text("record_type").$type<"fuel_receipt">().notNull(),
  recordId: uuid("record_id").notNull(),
  totalBytes: integer("total_bytes").notNull(),
  receivedBytes: integer("received_bytes").notNull().default(0),
  sha256: text("sha256").notNull(),
  data: bytea("data"),
  completedAt: ts("completed_at"),
  createdBy: uuid("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const syncConflicts = pgTable("sync_conflicts", {
  id: uuid("id").primaryKey(),
  eventId: uuid("event_id").notNull(),
  branchId: uuid("branch_id"),
  reason: text("reason").notNull(),
  status: text("status").$type<"open" | "accepted" | "rejected" | "corrected">().notNull().default("open"),
  resolutionReason: text("resolution_reason"),
  resolvedBy: uuid("resolved_by"),
  resolvedAt: ts("resolved_at"),
  correction: jsonb("correction").$type<Record<string, unknown>>(),
  recordType: text("record_type"),
  recordId: uuid("record_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
