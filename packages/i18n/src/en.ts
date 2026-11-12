import type { Messages } from "./index.js";

export const en: Messages = {
  app: { name: "Fleet Platform", switchLang: "العربية" },
  common: { save: "Save", cancel: "Cancel", loading: "Loading…", logout: "Sign out", add: "Add", none: "None", optional: "optional", copy: "Copy", copied: "Copied", retry: "Retry", close: "Close" },
  auth: {
    loginTitle: "Sign in", email: "Email", password: "Password", login: "Sign in",
    invalid: "Email or password is incorrect", locked: "Account temporarily locked after failed attempts. Try again in 15 minutes",
    acceptTitle: "Activate your account", newPassword: "New password (at least 12 characters)", activate: "Activate account",
    inviteInvalid: "This invite link is invalid, used or expired",
  },
  nav: { vehicles: "Vehicles", drivers: "Drivers", tenants: "Companies" },
  roles: { platform_admin: "Platform admin", company_admin: "Company admin", fleet_manager: "Fleet manager", finance_reviewer: "Finance reviewer", driver: "Driver", viewer: "Viewer" },
  tenants: {
    title: "Companies", add: "Add company", name: "Company name", slug: "Company code (lowercase)", country: "Country",
    adminName: "Company admin name", adminEmail: "Company admin email", status: "Status", schema: "DB version",
    inviteLink: "Company admin invite link — send it to them, valid for 7 days:", retry: "Retry provisioning",
    statuses: { provisioning: "Provisioning", active: "Active", suspended: "Suspended", failed: "Failed", terminated: "Terminated" },
  },
  vehicles: {
    title: "Vehicles", add: "Add vehicle", fleetNumber: "Fleet number", registrationNumber: "Plate number", vin: "VIN",
    make: "Make", model: "Model", year: "Year", primaryFuelType: "Fuel type", primaryTankCapacity: "Tank capacity",
    secondaryFuelType: "Second fuel (bi-fuel)", secondaryTankCapacity: "Second tank capacity", meterType: "Meter type",
    requiredLicenseCategory: "Required license", ownershipType: "Ownership", branch: "Branch", status: "Status",
    empty: "No vehicles yet. Add the first one.",
    meterTypes: { distance: "Distance (km)", hours: "Engine hours", both: "Both" },
    ownershipTypes: { owned: "Owned", leased: "Leased", rented: "Rented" },
    statuses: { draft: "Draft", active: "Active", inactive: "Inactive", disposed: "Disposed" },
    created: "Vehicle added",
  },
  drivers: {
    title: "Drivers", add: "Add driver", fullName: "Full name", username: "Username", phone: "Mobile", branch: "Branch",
    device: "Device", deviceActive: "Activated", deviceNone: "Not activated", issueCode: "Issue activation code",
    codeTitle: "Activation code", codeHelp: "Give the driver the username and this code to activate the app. Valid 24 hours, single use; issuing it revokes any previous device.",
    expires: "Expires", empty: "No drivers yet.",
  },
  driverApp: {
    activateTitle: "Activate the app", activateHelp: "Enter the username and activation code your fleet manager gave you.",
    username: "Username", code: "Activation code", activate: "Activate", invalid: "Username or code is incorrect or expired",
    locked: "Too many wrong attempts. Try again in 15 minutes", hello: "Hello", vehicles: "Vehicles", noVehicles: "No vehicles are available to you right now.",
    refresh: "Refresh", logout: "Sign out", online: "Online", offline: "Offline", lastUpdate: "Last updated",
    plate: "Plate", fuel: "Fuel", tank: "Tank",
  },
  errors: {
    required: "Required", duplicate: "Used by another vehicle", out_of_range: "Value out of range", unknown_fuel_type: "Unknown fuel type",
    unknown_license_category: "Unknown license category", same_as_primary: "Must differ from the primary fuel", invalid_vin: "Invalid VIN (17 characters)",
    requires_secondary_fuel: "Choose the second fuel first", taken: "Already taken", unknown_branch: "Unknown branch",
    validation_failed: "Please fix the highlighted fields", duplicate_record: "A vehicle with the same identifiers already exists", username_taken: "This username is already taken", slug_taken: "This company code is already taken",
    generic: "Something went wrong. Please try again.", forbidden: "You don't have permission to do this", network: "Can't reach the server",
  },
};
