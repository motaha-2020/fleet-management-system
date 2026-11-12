import { z } from "zod";
import { ROLES, TENANT_ROLES } from "@fleet/config";
import { METER_TYPES, OWNERSHIP_TYPES, VEHICLE_STATUSES } from "@fleet/domain";

export const Uuid = z.uuid();
export const IsoDateTime = z.iso.datetime({ offset: true });

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
export const Branch = z.object({ id: Uuid, code: z.string(), name: z.string() });
export type Branch = z.infer<typeof Branch>;

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
  createdAt: IsoDateTime,
});
export type Vehicle = z.infer<typeof Vehicle>;

// ---------- Drivers ----------
export const CreateDriverRequest = z.object({
  id: Uuid.optional(),
  branchId: Uuid,
  fullName: z.string().trim().min(2).max(200),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,64}$/, "letters, digits, dot, dash, underscore"),
  phone: z.string().trim().max(20).nullish(),
});
export type CreateDriverRequest = z.input<typeof CreateDriverRequest>;

export const Driver = z.object({
  id: Uuid,
  branchId: Uuid,
  fullName: z.string(),
  username: z.string(),
  phone: z.string().nullable(),
  status: z.enum(["active", "inactive"]),
  hasActiveDevice: z.boolean(),
  createdAt: IsoDateTime,
});
export type Driver = z.infer<typeof Driver>;

export const ActivationCodeResponse = z.object({ code: z.string(), expiresAt: IsoDateTime, username: z.string() });

export const ListOf = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item) });

export const Empty = z.object({});
export const Ok = z.object({ ok: z.literal(true) });

export { TENANT_ROLES };
