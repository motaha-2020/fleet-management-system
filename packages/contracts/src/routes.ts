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

  // ---------- Assignments & handover (E07) ----------
  listAssignments: r({ method: "GET", path: "/assignments", query: S.ListAssignmentsQuery, response: S.ListOf(S.Assignment), summary: "Assignments in scope" }),
  createAssignment: r({ method: "POST", path: "/assignments", body: S.CreateAssignmentRequest, response: S.Assignment, summary: "Assign a driver to a vehicle" }),
  endAssignment: r({ method: "POST", path: "/assignments/:id/end", body: S.EndAssignmentRequest, response: S.Assignment, summary: "End an assignment" }),
  backdateAssignment: r({ method: "POST", path: "/assignments/:id/backdate", body: S.BackdateAssignmentRequest, response: S.Assignment, summary: "Move the start earlier (ASN-006)" }),
  createHandover: r({ method: "POST", path: "/handovers", body: S.CreateHandoverRequest, response: S.Handover, summary: "Hand the vehicle to another authorized driver" }),
  listHandovers: r({ method: "GET", path: "/vehicles/:id/handovers", response: S.ListOf(S.Handover), summary: "Handovers of a vehicle" }),
  vehicleCustody: r({ method: "GET", path: "/vehicles/:id/custody", query: S.PeriodQuery, response: S.ListOf(S.CustodySegment), summary: "Custody timeline with gaps (ASN-009)" }),

  // ---------- Odometer (E08) ----------
  vehicleOdometer: r({ method: "GET", path: "/vehicles/:id/odometer", response: S.OdometerView, summary: "Unified odometer timeline" }),
  createReading: r({ method: "POST", path: "/meter-readings", body: S.CreateReadingRequest, response: S.MeterReading, summary: "Manual / opening reading" }),
  createReplacement: r({ method: "POST", path: "/meter-replacements", body: S.CreateReplacementRequest, response: S.MeterReplacement, summary: "Meter replacement (ODO-009)" }),

  // ---------- Fuel (E09) ----------
  listFuelEntries: r({ method: "GET", path: "/fuel-entries", query: S.ListFuelQuery, response: S.ListOf(S.FuelEntry), summary: "Fuel entries in scope" }),
  createFuelEntry: r({ method: "POST", path: "/fuel-entries", body: S.CreateFuelEntryRequest, response: S.FuelEntry, summary: "Record a fuel entry (idempotent by id)" }),
  getFuelEntry: r({ method: "GET", path: "/fuel-entries/:id", response: S.FuelEntry, summary: "Fuel entry" }),
  uploadFuelReceipt: r({ method: "POST", path: "/fuel-entries/:id/receipt", binary: "upload", response: S.FuelEntry, summary: "Receipt photo (JPG/PNG/PDF)" }),
  downloadFuelReceipt: r({ method: "GET", path: "/fuel-entries/:id/receipt", binary: "download", response: S.Empty, summary: "Receipt (audited)" }),
  acceptFuelEntry: r({ method: "POST", path: "/fuel-entries/:id/accept", response: S.FuelEntry, summary: "Accept after review (maker ≠ checker)" }),
  voidFuelEntry: r({ method: "POST", path: "/fuel-entries/:id/void", body: S.VoidRequest, response: S.FuelEntry, summary: "Void with reason" }),
  vehicleFuelStats: r({ method: "GET", path: "/vehicles/:id/fuel-stats", query: S.PeriodQuery, response: S.FuelStats, summary: "Purchased vs Full-to-Full consumption" }),
  currentFuelPrices: r({ method: "GET", path: "/fuel-prices", response: S.ListOf(S.FuelPrice), summary: "Official prices in force for the company's country" }),

  // ---------- Costs (E15) ----------
  listCosts: r({ method: "GET", path: "/costs", query: S.ListCostsQuery, response: S.ListOf(S.CostRecord), summary: "Recorded costs" }),
  createCost: r({ method: "POST", path: "/costs", body: S.CreateCostRequest, response: S.CostRecord, summary: "Manual cost" }),
  voidCost: r({ method: "POST", path: "/costs/:id/void", body: S.VoidRequest, response: S.CostRecord, summary: "Void a manual cost" }),
  costSummary: r({ method: "GET", path: "/costs/summary", query: S.CostSummaryQuery, response: S.CostSummary, summary: "Recorded cost and cost/km per vehicle" }),

  // ---------- Corrections (E16) ----------
  listCorrections: r({ method: "GET", path: "/corrections", query: S.ListCorrectionsQuery, response: S.ListOf(S.Correction), summary: "Corrections in scope" }),
  requestCorrection: r({ method: "POST", path: "/corrections", body: S.CreateCorrectionRequest, response: S.Correction, summary: "Request a correction (maker)" }),
  approveCorrection: r({ method: "POST", path: "/corrections/:id/approve", body: S.DecideCorrectionRequest, response: S.Correction, summary: "Approve and apply (checker)" }),
  rejectCorrection: r({ method: "POST", path: "/corrections/:id/reject", body: S.DecideCorrectionRequest, response: S.Correction, summary: "Reject" }),

  // ---------- Platform: official fuel prices (FUEL-017) ----------
  listFuelPrices: r({ method: "GET", path: "/platform/fuel-prices", query: S.FuelPricesQuery, response: S.ListOf(S.FuelPrice), summary: "Price history" }),
  createFuelPrice: r({ method: "POST", path: "/platform/fuel-prices", body: S.CreateFuelPriceRequest, response: S.FuelPrice, summary: "New effective-dated price" }),

  // ---------- Maintenance (E10) ----------
  listTemplates: r({ method: "GET", path: "/maintenance/templates", response: S.ListOf(S.MaintenanceTemplate), summary: "Maintenance templates" }),
  createTemplate: r({ method: "POST", path: "/maintenance/templates", body: S.CreateTemplateRequest, response: S.MaintenanceTemplate, summary: "Create template with items" }),
  updateTemplate: r({ method: "PATCH", path: "/maintenance/templates/:id", body: S.UpdateTemplateRequest, response: S.MaintenanceTemplate, summary: "Rename / deactivate template" }),
  addTemplateItem: r({ method: "POST", path: "/maintenance/templates/:id/items", body: S.AddTemplateItemRequest, response: S.MaintenanceTemplate, summary: "Add item" }),
  updateTemplateItem: r({ method: "PATCH", path: "/maintenance/template-items/:id", body: S.UpdateTemplateItemRequest, response: S.MaintenanceTemplate, summary: "Edit item" }),
  vehicleMaintenance: r({ method: "GET", path: "/vehicles/:id/maintenance", response: S.VehicleMaintenance, summary: "Items with due status and forecast" }),
  setMaintenanceOverride: r({ method: "POST", path: "/vehicles/:id/maintenance/:code/override", body: S.SetOverrideRequest, response: S.VehicleMaintenance, summary: "Per-vehicle interval (US-E10-01)" }),
  setMaintenanceBaseline: r({ method: "POST", path: "/vehicles/:id/maintenance/:code/baseline", body: S.SetBaselineRequest, response: S.VehicleMaintenance, summary: "Opening baseline" }),
  maintenanceDue: r({ method: "GET", path: "/maintenance/due", query: S.MaintenanceDueQuery, response: S.ListOf(S.MaintenanceDueRow), summary: "Items due across vehicles in scope" }),

  listDefects: r({ method: "GET", path: "/defects", query: S.ListDefectsQuery, response: S.ListOf(S.Defect), summary: "Defect reports" }),
  createDefect: r({ method: "POST", path: "/defects", body: S.CreateDefectRequest, response: S.Defect, summary: "Report a defect (WO-001)" }),
  uploadDefectPhoto: r({ method: "POST", path: "/defects/:id/photo", binary: "upload", response: S.Defect, summary: "Defect photo" }),
  downloadDefectPhoto: r({ method: "GET", path: "/defects/:id/photo", binary: "download", response: S.Empty, summary: "Defect photo (audited)" }),
  triageDefect: r({ method: "POST", path: "/defects/:id/triage", response: S.Defect, summary: "Mark triaged" }),
  rejectDefect: r({ method: "POST", path: "/defects/:id/reject", body: S.RejectDefectRequest, response: S.Defect, summary: "Reject with reason" }),
  duplicateDefect: r({ method: "POST", path: "/defects/:id/duplicate", body: S.DuplicateDefectRequest, response: S.Defect, summary: "Mark duplicate" }),
  convertDefect: r({ method: "POST", path: "/defects/:id/convert", body: S.ConvertDefectRequest, response: S.WorkOrder, summary: "Convert to work order" }),

  listWorkOrders: r({ method: "GET", path: "/work-orders", query: S.ListWorkOrdersQuery, response: S.ListOf(S.WorkOrder), summary: "Work orders" }),
  createWorkOrder: r({ method: "POST", path: "/work-orders", body: S.CreateWorkOrderRequest, response: S.WorkOrder, summary: "Create work order" }),
  workOrderStatus: r({ method: "POST", path: "/work-orders/:id/status", body: S.WorkOrderStatusRequest, response: S.WorkOrder, summary: "Lifecycle (WO-003, WO-006)" }),

  listVisits: r({ method: "GET", path: "/maintenance/visits", query: S.ListVisitsQuery, response: S.ListOf(S.MaintenanceVisit), summary: "Maintenance visits" }),
  createVisit: r({ method: "POST", path: "/maintenance/visits", body: S.CreateVisitRequest, response: S.MaintenanceVisit, summary: "Record a visit (draft or completed)" }),
  completeVisit: r({ method: "POST", path: "/maintenance/visits/:id/complete", response: S.MaintenanceVisit, summary: "Complete: cost, odometer, baselines" }),

  // ---------- Alerts & notifications (E13) ----------
  listAlerts: r({ method: "GET", path: "/alerts", query: S.ListAlertsQuery, response: S.ListOf(S.Alert), summary: "Alerts in scope (drivers: their own)" }),
  alertStatus: r({ method: "POST", path: "/alerts/:id/status", body: S.AlertStatusRequest, response: S.Alert, summary: "Acknowledge / start / resolve / close (ALR-002)" }),
  scanAlerts: r({ method: "POST", path: "/alerts/scan", response: S.AlertScanResult, summary: "Run the alert scan for this company now" }),
  listNotifications: r({ method: "GET", path: "/notifications", query: S.ListNotificationsQuery, response: S.ListOf(S.Notification), summary: "Delivery log (NTF-003)" }),
  // ---------- Fuel budgets (FUEL-015) ----------
  listFuelBudgets: r({ method: "GET", path: "/fuel-budgets", query: S.FuelBudgetQuery, response: S.ListOf(S.FuelBudgetStatus), summary: "Budgets of a month with actuals" }),
  setFuelBudget: r({ method: "POST", path: "/fuel-budgets", body: S.SetFuelBudgetRequest, response: S.FuelBudget, summary: "Create or change a monthly budget" }),

  // ---------- Traffic fines (E29) ----------
  listFines: r({ method: "GET", path: "/fines", query: S.ListFinesQuery, response: S.ListOf(S.Fine), summary: "Fines in scope" }),
  createFine: r({ method: "POST", path: "/fines", body: S.CreateFineRequest, response: S.Fine, summary: "Record a fine (one cost, INC-003/004)" }),
  suggestFineDriver: r({ method: "GET", path: "/fines/suggest-driver", query: S.SuggestDriverQuery, response: S.SuggestedDriver, summary: "Custodian at the violation time" }),
  confirmFineDriver: r({ method: "POST", path: "/fines/:id/driver", body: S.ConfirmFineDriverRequest, response: S.Fine, summary: "Confirm the responsible driver" }),
  finePayment: r({ method: "POST", path: "/fines/:id/payment", body: S.FinePaymentRequest, response: S.Fine, summary: "Payment status (no new cost)" }),
  voidFine: r({ method: "POST", path: "/fines/:id/void", body: S.VoidFineRequest, response: S.Fine, summary: "Void a fine and its cost" }),

  // ---------- Dashboards & reports (E18) ----------
  dashboard: r({ method: "GET", path: "/dashboard", query: S.DashboardQuery, response: S.Dashboard, summary: "Executive & fleet manager dashboard (scoped)" }),
  report: r({ method: "GET", path: "/reports/:id", query: S.ReportQuery, response: S.Report, summary: "Standard report (RPT-001..007)" }),
  exportReport: r({ method: "GET", path: "/reports/:id/export", query: S.ReportQuery, binary: "download", response: S.Empty, summary: "Excel / CSV export (audited)" }),

  // ---------- Readiness (E12) ----------
  readiness: r({ method: "GET", path: "/readiness", query: S.ReadinessQuery, response: S.Readiness, summary: "Evaluate a vehicle, a driver or both" }),
  vehiclesReadiness: r({ method: "GET", path: "/readiness/vehicles", response: S.ListOf(S.VehicleReadinessRow), summary: "Readiness of vehicles in scope" }),
  readinessRules: r({ method: "GET", path: "/readiness/rules", response: S.ListOf(S.ReadinessRule), summary: "Rule catalog with company risk" }),
  setReadinessRule: r({ method: "POST", path: "/readiness/rules/:code", body: S.SetRuleRiskRequest, response: S.ReadinessRule, summary: "Raise a rule's risk (never lower)" }),
  listOverrides: r({ method: "GET", path: "/readiness/overrides", query: S.ListOverridesQuery, response: S.ListOf(S.ReadinessOverride), summary: "Overrides" }),
  createOverride: r({ method: "POST", path: "/readiness/overrides", body: S.CreateOverrideRequest, response: S.ReadinessOverride, summary: "Override R2/R3 with reason and expiry" }),
  revokeOverride: r({ method: "POST", path: "/readiness/overrides/:id/revoke", response: S.ReadinessOverride, summary: "Revoke override" }),

  // ---------- Audit ----------
  listAudit: r({ method: "GET", path: "/audit", query: S.ListAuditQuery, response: S.ListAuditResponse, summary: "Audit log (append-only)" }),

  // ---------- Offline & sync (E14) ----------
  syncPublicKey: r({ method: "GET", path: "/sync/public-key", response: S.SyncPublicKey, public: true, summary: "Key that verifies Offline Grants on the device" }),
  syncState: r({ method: "POST", path: "/sync/grant", response: S.SyncState, summary: "Fresh Offline Grant + read set for the device" }),
  syncEvents: r({ method: "POST", path: "/sync/events", body: S.SyncRequest, response: S.SyncResponse, summary: "Offline events, idempotent and applied in device order" }),
  listSyncConflicts: r({ method: "GET", path: "/sync/conflicts", query: S.ListSyncConflictsQuery, response: S.ListOf(S.SyncConflict), summary: "Conflict queue" }),
  startUpload: r({ method: "POST", path: "/uploads", body: S.StartUploadRequest, response: S.UploadState, summary: "Start or resume a photo upload for a record" }),
  uploadChunk: r({ method: "PATCH", path: "/uploads/:id", binary: "upload", response: S.UploadState, summary: "Append a chunk (≤ 64 KB) at the Upload-Offset header" }),
  resolveSyncConflict: r({ method: "POST", path: "/sync/conflicts/:id/resolve", body: S.ResolveSyncConflictRequest, response: S.SyncConflict, summary: "Accept, reject or correct an offline event, with a reason" }),
} as const;

export type Routes = typeof routes;
export type RouteName = keyof Routes;
