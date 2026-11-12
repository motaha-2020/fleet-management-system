/** Country templates (CTR-001). Values from docs/Country_Profile_Egypt.md §1–2. */
export interface FuelType { code: string; name: { ar: string; en: string }; unit: "L" | "m3" }

export type RiskCategory = "R1" | "R2" | "R3" | "R4";
export type DriverVisibility = "none" | "view" | "download";

export interface DocumentTypeDef {
  code: string;
  entityType: "vehicle" | "driver";
  name: { ar: string; en: string };
  mandatory: boolean;
  hasExpiry: boolean;
  risk: RiskCategory;
  driverVisibility: DriverVisibility;
  /** Sensitive personal data (DRV-007): hidden from roles without driver.view_sensitive. */
  sensitive: boolean;
}

export const COST_CATEGORIES = ["fuel", "preventive", "corrective", "accident", "insurance", "licensing", "rental", "fines", "tolls", "other"] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

export interface CountryTemplate {
  code: string;
  currency: string;
  currencyMinorUnits: number;
  timezone: string;
  languages: readonly string[];
  distanceUnit: "km";
  weekStart: "saturday" | "sunday" | "monday";
  phonePrefix: string;
  fuelTypes: readonly FuelType[];
  licenseCategories: readonly { code: string; name: { ar: string; en: string } }[];
  documentTypes: readonly DocumentTypeDef[];
  /** FIN-013: is the tax on this category recoverable? Non-recoverable tax is part of the cost. */
  taxRecoverable: Record<CostCategory, boolean>;
  /** Default VAT rate for display/help; amounts are always entered explicitly. */
  vatRate: number;
}

export const EGYPT: CountryTemplate = {
  code: "EG",
  currency: "EGP",
  currencyMinorUnits: 2,
  timezone: "Africa/Cairo",
  languages: ["ar", "en"],
  distanceUnit: "km",
  weekStart: "saturday",
  phonePrefix: "+20",
  fuelTypes: [
    { code: "PET80", name: { ar: "بنزين 80", en: "Petrol 80" }, unit: "L" },
    { code: "PET92", name: { ar: "بنزين 92", en: "Petrol 92" }, unit: "L" },
    { code: "PET95", name: { ar: "بنزين 95", en: "Petrol 95" }, unit: "L" },
    { code: "DSL", name: { ar: "سولار", en: "Diesel" }, unit: "L" },
    { code: "CNG", name: { ar: "غاز طبيعي", en: "Natural gas (CNG)" }, unit: "m3" },
  ],
  // ⚖️ Mapping to vehicle types pending legal review (Country Profile §3).
  licenseCategories: [
    { code: "PRIVATE", name: { ar: "خاصة", en: "Private" } },
    { code: "PRO3", name: { ar: "مهنية — درجة ثالثة", en: "Professional — 3rd grade" } },
    { code: "PRO2", name: { ar: "مهنية — درجة ثانية", en: "Professional — 2nd grade" } },
    { code: "PRO1", name: { ar: "مهنية — درجة أولى", en: "Professional — 1st grade" } },
    { code: "MOTO", name: { ar: "دراجة نارية", en: "Motorcycle" } },
  ],
  // Country Profile §5 ⚖️: fuel carries table tax (not recoverable) → fuel cost = gross; VAT 14% elsewhere is recoverable.
  taxRecoverable: {
    fuel: false, preventive: true, corrective: true, accident: true, insurance: true, licensing: false,
    rental: true, fines: false, tolls: false, other: true,
  },
  vatRate: 0.14,
  // Country Profile §4 (⚖️ pending legal review). Companies may tighten, never relax (GEN-008).
  documentTypes: [
    { code: "EG_VEH_LICENSE", entityType: "vehicle", name: { ar: "رخصة تسيير المركبة", en: "Vehicle license" }, mandatory: true, hasExpiry: true, risk: "R4", driverVisibility: "view", sensitive: false },
    { code: "EG_VEH_INS_MANDATORY", entityType: "vehicle", name: { ar: "وثيقة التأمين الإجباري", en: "Compulsory insurance" }, mandatory: true, hasExpiry: true, risk: "R4", driverVisibility: "view", sensitive: false },
    { code: "EG_VEH_INS_COMPREHENSIVE", entityType: "vehicle", name: { ar: "تأمين شامل", en: "Comprehensive insurance" }, mandatory: false, hasExpiry: true, risk: "R2", driverVisibility: "none", sensitive: false },
    { code: "EG_VEH_INSPECTION", entityType: "vehicle", name: { ar: "شهادة الفحص الفني", en: "Technical inspection" }, mandatory: true, hasExpiry: true, risk: "R3", driverVisibility: "view", sensitive: false },
    { code: "EG_VEH_LEASE", entityType: "vehicle", name: { ar: "عقد إيجار / تأجير تمويلي", en: "Lease / rental contract" }, mandatory: false, hasExpiry: true, risk: "R2", driverVisibility: "none", sensitive: false },
    { code: "EG_VEH_TOLL_TAG", entityType: "vehicle", name: { ar: "ملصق الطرق الإلكتروني (كارتة)", en: "Electronic toll tag" }, mandatory: false, hasExpiry: true, risk: "R1", driverVisibility: "view", sensitive: false },
    { code: "EG_DRV_LICENSE", entityType: "driver", name: { ar: "رخصة القيادة", en: "Driving license" }, mandatory: true, hasExpiry: true, risk: "R4", driverVisibility: "download", sensitive: false },
    { code: "EG_DRV_NATIONAL_ID", entityType: "driver", name: { ar: "بطاقة الرقم القومي", en: "National ID card" }, mandatory: true, hasExpiry: true, risk: "R2", driverVisibility: "view", sensitive: true },
    { code: "EG_DRV_DRUG_TEST", entityType: "driver", name: { ar: "تحليل المخدرات", en: "Drug test" }, mandatory: false, hasExpiry: true, risk: "R3", driverVisibility: "none", sensitive: true },
    { code: "EG_DRV_CRIMINAL_RECORD", entityType: "driver", name: { ar: "صحيفة الحالة الجنائية (الفيش)", en: "Criminal record certificate" }, mandatory: false, hasExpiry: true, risk: "R2", driverVisibility: "none", sensitive: true },
    { code: "EG_DRV_MEDICAL", entityType: "driver", name: { ar: "كشف طبي", en: "Medical certificate" }, mandatory: false, hasExpiry: true, risk: "R2", driverVisibility: "none", sensitive: true },
  ],
};

export const COUNTRY_TEMPLATES: Record<string, CountryTemplate> = { EG: EGYPT };
