import { pgTable, uuid, text, timestamp, integer, boolean, numeric, bigserial, jsonb, char } from "drizzle-orm/pg-core";

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
  version: integer("version").notNull(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
});

export const invites = pgTable("invites", {
  id: uuid("id").primaryKey(),
  identityId: uuid("identity_id").notNull(),
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
  timezone: text("timezone").notNull(),
});

export const branches = pgTable("branches", {
  id: uuid("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
});
