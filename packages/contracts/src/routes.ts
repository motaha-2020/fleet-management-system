import { z } from "zod";
import * as S from "./schemas.js";

export type Method = "GET" | "POST" | "PATCH" | "DELETE";

export interface RouteDef {
  method: Method;
  path: string;
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  response: z.ZodTypeAny;
  /** Public routes skip the auth guard. */
  public?: boolean;
  /** Binary request/response (file upload / download); called with `client.raw`. */
  binary?: "upload" | "download";
  summary: string;
}

const r = <const T extends RouteDef>(d: T) => d;

/**
 * The single API contract (ADR-008). The API validates bodies and queries with these schemas,
 * and the web/mobile clients are typed from the same object.
 */
export const routes = {
  // ---------- Auth ----------
  login: r({ method: "POST", path: "/auth/login", body: S.LoginRequest, response: S.LoginResponse, public: true, summary: "Email + password; may return an MFA challenge" }),
  mfaVerify: r({ method: "POST", path: "/auth/mfa", body: S.MfaVerifyRequest, response: S.TokenResponse, public: true, summary: "Complete login with a TOTP code (verify or enroll)" }),
  refresh: r({ method: "POST", path: "/auth/refresh", body: S.RefreshRequest, response: S.TokenResponse, public: true, summary: "Rotate refresh token" }),
  logout: r({ method: "POST", path: "/auth/logout", body: S.RefreshRequest, response: S.Ok, public: true, summary: "Revoke refresh token" }),
  acceptInvite: r({ method: "POST", path: "/auth/accept-invite", body: S.AcceptInviteRequest, response: S.LoginResponse, public: true, summary: "Set password from an invite" }),
  driverActivate: r({ method: "POST", path: "/auth/driver/activate", body: S.DriverActivateRequest, response: S.TokenResponse, public: true, summary: "Bind a driver device with a one-time activation code" }),
  switchRole: r({ method: "POST", path: "/auth/switch-role", body: S.SwitchRoleRequest, response: S.TokenResponse, summary: "Change the active role (SEC-002)" }),
  me: r({ method: "GET", path: "/me", response: S.SessionUser, summary: "Current session" }),

  // ---------- Platform ----------
  listTenants: r({ method: "GET", path: "/platform/tenants", response: S.ListOf(S.Tenant), summary: "List tenants (platform admin)" }),
  createTenant: r({ method: "POST", path: "/platform/tenants", body: S.CreateTenantRequest, response: S.CreateTenantResponse, summary: "Provision a tenant (async)" }),
  getTenant: r({ method: "GET", path: "/platform/tenants/:id", response: S.Tenant, summary: "Tenant status" }),
  suspendTenant: r({ method: "POST", path: "/platform/tenants/:id/suspend", response: S.Tenant, summary: "Suspend (read-only) — TEN-004" }),
  reactivateTenant: r({ method: "POST", path: "/platform/tenants/:id/reactivate", response: S.Tenant, summary: "Reactivate a suspended tenant" }),

  // ---------- Users ----------
  listUsers: r({ method: "GET", path: "/users", response: S.ListOf(S.TenantUser), summary: "Company users (not drivers)" }),
  inviteUser: r({ method: "POST", path: "/users", body: S.InviteUserRequest, response: S.InviteUserResponse, summary: "Invite a user with a role and branches" }),
  updateUser: r({ method: "PATCH", path: "/users/:id", body: S.UpdateUserRequest, response: S.TenantUser, summary: "Change role, branches or deactivate" }),
  resetUserMfa: r({ method: "POST", path: "/users/:id/reset-mfa", response: S.TenantUser, summary: "Force MFA re-enrolment (lost phone)" }),

  // ---------- Branches ----------
  listBranches: r({ method: "GET", path: "/branches", response: S.ListOf(S.Branch), summary: "Branches visible to the user" }),
  createBranch: r({ method: "POST", path: "/branches", body: S.CreateBranchRequest, response: S.Branch, summary: "Create branch" }),
  updateBranch: r({ method: "PATCH", path: "/branches/:id", body: S.UpdateBranchRequest, response: S.Branch, summary: "Update branch" }),

  // ---------- Vendors ----------
  listVendors: r({ method: "GET", path: "/vendors", query: S.ListVendorsQuery, response: S.ListOf(S.Vendor), summary: "Vendors (active only unless includeInactive)" }),
  createVendor: r({ method: "POST", path: "/vendors", body: S.CreateVendorRequest, response: S.Vendor, summary: "Create vendor" }),
  updateVendor: r({ method: "PATCH", path: "/vendors/:id", body: S.UpdateVendorRequest, response: S.Vendor, summary: "Update or deactivate vendor" }),

  // ---------- Vehicles ----------
  listVehicles: r({ method: "GET", path: "/vehicles", response: S.ListOf(S.Vehicle), summary: "Vehicles in scope" }),
  createVehicle: r({ method: "POST", path: "/vehicles", body: S.CreateVehicleRequest, response: S.Vehicle, summary: "Create vehicle" }),
  getVehicle: r({ method: "GET", path: "/vehicles/:id", response: S.Vehicle, summary: "Vehicle by id" }),
  updateVehicle: r({ method: "PATCH", path: "/vehicles/:id", body: S.UpdateVehicleRequest, response: S.Vehicle, summary: "Edit master data" }),
  changeVehicleStatus: r({ method: "POST", path: "/vehicles/:id/status", body: S.VehicleStatusRequest, response: S.Vehicle, summary: "Activate / deactivate (VEH-003)" }),
  transferVehicle: r({ method: "POST", path: "/vehicles/:id/transfer", body: S.TransferVehicleRequest, response: S.Vehicle, summary: "Branch transfer (VEH-005)" }),
  disposeVehicle: r({ method: "POST", path: "/vehicles/:id/dispose", body: S.DisposeVehicleRequest, response: S.Vehicle, summary: "Dispose (VEH-006)" }),
  vehicleBranchHistory: r({ method: "GET", path: "/vehicles/:id/branch-history", response: S.ListOf(S.BranchTransfer), summary: "Branch transfers" }),

  // ---------- Drivers ----------
  listDrivers: r({ method: "GET", path: "/drivers", response: S.ListOf(S.Driver), summary: "Drivers in scope" }),
  createDriver: r({ method: "POST", path: "/drivers", body: S.CreateDriverRequest, response: S.Driver, summary: "Create driver" }),
  getDriver: r({ method: "GET", path: "/drivers/:id", response: S.Driver, summary: "Driver by id" }),
  updateDriver: r({ method: "PATCH", path: "/drivers/:id", body: S.UpdateDriverRequest, response: S.Driver, summary: "Edit driver master / employment status" }),
  setDriverAccount: r({ method: "POST", path: "/drivers/:id/account", body: S.DriverAccountRequest, response: S.Driver, summary: "Enable / disable login (DRV-002)" }),
  revealDriverSensitive: r({ method: "POST", path: "/drivers/:id/reveal", response: S.RevealResponse, summary: "Reveal national ID (audited, DRV-007)" }),
  issueActivationCode: r({ method: "POST", path: "/drivers/:id/activation-code", response: S.ActivationCodeResponse, summary: "Issue one-time activation code (revokes old device)" }),

  // ---------- Documents ----------
  listDocumentTypes: r({ method: "GET", path: "/document-types", response: S.ListOf(S.DocumentType), summary: "Effective document types (country + company)" }),
  createDocumentType: r({ method: "POST", path: "/document-types", body: S.CreateDocumentTypeRequest, response: S.DocumentType, summary: "Company custom type" }),
  updateDocumentType: r({ method: "PATCH", path: "/document-types/:code", body: S.UpdateDocumentTypeRequest, response: S.DocumentType, summary: "Tighten a country type or edit a custom one" }),
  listDocuments: r({ method: "GET", path: "/documents", query: S.ListDocumentsQuery, response: S.ListDocumentsResponse, summary: "Documents in scope" }),
  createDocument: r({ method: "POST", path: "/documents", body: S.CreateDocumentRequest, response: S.Document, summary: "Create document (draft)" }),
  uploadDocumentFile: r({ method: "POST", path: "/documents/:id/file", binary: "upload", response: S.Document, summary: "Upload the file (raw body, ≤10 MB, PDF/JPG/PNG)" }),
  submitDocument: r({ method: "POST", path: "/documents/:id/submit", response: S.Document, summary: "Draft → Pending verification" }),
  verifyDocument: r({ method: "POST", path: "/documents/:id/verify", response: S.Document, summary: "Verify (maker ≠ checker)" }),
  rejectDocument: r({ method: "POST", path: "/documents/:id/reject", body: S.RejectDocumentRequest, response: S.Document, summary: "Reject with reason" }),
  downloadDocument: r({ method: "GET", path: "/documents/:id/file", binary: "download", response: S.Empty, summary: "Download file (audited)" }),

  // ---------- Audit ----------
  listAudit: r({ method: "GET", path: "/audit", query: S.ListAuditQuery, response: S.ListAuditResponse, summary: "Audit log (append-only)" }),
} as const;

export type Routes = typeof routes;
export type RouteName = keyof Routes;
