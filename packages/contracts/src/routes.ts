import { z } from "zod";
import * as S from "./schemas.js";

export type Method = "GET" | "POST" | "PATCH" | "DELETE";

export interface RouteDef {
  method: Method;
  path: string;
  body?: z.ZodTypeAny;
  response: z.ZodTypeAny;
  /** Public routes skip the auth guard. */
  public?: boolean;
  summary: string;
}

const r = <const T extends RouteDef>(d: T) => d;

/**
 * The single API contract (ADR-008). The API validates bodies with these schemas,
 * and the web/mobile clients are typed from the same object.
 */
export const routes = {
  login: r({ method: "POST", path: "/auth/login", body: S.LoginRequest, response: S.TokenResponse, public: true, summary: "Email + password login (web users)" }),
  refresh: r({ method: "POST", path: "/auth/refresh", body: S.RefreshRequest, response: S.TokenResponse, public: true, summary: "Rotate refresh token" }),
  logout: r({ method: "POST", path: "/auth/logout", body: S.RefreshRequest, response: S.Ok, public: true, summary: "Revoke refresh token" }),
  acceptInvite: r({ method: "POST", path: "/auth/accept-invite", body: S.AcceptInviteRequest, response: S.TokenResponse, public: true, summary: "Set password from an invite" }),
  driverActivate: r({ method: "POST", path: "/auth/driver/activate", body: S.DriverActivateRequest, response: S.TokenResponse, public: true, summary: "Bind a driver device with a one-time activation code" }),
  me: r({ method: "GET", path: "/me", response: S.SessionUser, summary: "Current session" }),

  listTenants: r({ method: "GET", path: "/platform/tenants", response: S.ListOf(S.Tenant), summary: "List tenants (platform admin)" }),
  createTenant: r({ method: "POST", path: "/platform/tenants", body: S.CreateTenantRequest, response: S.CreateTenantResponse, summary: "Provision a tenant (async)" }),
  getTenant: r({ method: "GET", path: "/platform/tenants/:id", response: S.Tenant, summary: "Tenant status" }),

  listBranches: r({ method: "GET", path: "/branches", response: S.ListOf(S.Branch), summary: "Branches visible to the user" }),

  listVehicles: r({ method: "GET", path: "/vehicles", response: S.ListOf(S.Vehicle), summary: "Vehicles in scope" }),
  createVehicle: r({ method: "POST", path: "/vehicles", body: S.CreateVehicleRequest, response: S.Vehicle, summary: "Create vehicle" }),
  getVehicle: r({ method: "GET", path: "/vehicles/:id", response: S.Vehicle, summary: "Vehicle by id" }),

  listDrivers: r({ method: "GET", path: "/drivers", response: S.ListOf(S.Driver), summary: "Drivers in scope" }),
  createDriver: r({ method: "POST", path: "/drivers", body: S.CreateDriverRequest, response: S.Driver, summary: "Create driver" }),
  issueActivationCode: r({ method: "POST", path: "/drivers/:id/activation-code", response: S.ActivationCodeResponse, summary: "Issue one-time activation code (revokes old device)" }),
} as const;

export type Routes = typeof routes;
export type RouteName = keyof Routes;
