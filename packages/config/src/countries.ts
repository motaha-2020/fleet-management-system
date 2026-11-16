/** Country templates (CTR-001). Egypt: docs/Country_Profile_Egypt.md §1–2. Tunisia: docs/Gap_Analysis_Tunisia_v0.3.md. */
/** A name in every language; French and Tunisian fall back to Arabic/English until translated. */
export interface Names { ar: string; en: string; fr?: string; tn?: string }
export interface FuelType { code: string; name: Names; unit: "L" | "m3" }

export type RiskCategory = "R1" | "R2" | "R3" | "R4";
export type DriverVisibility = "none" | "view" | "download";

export interface DocumentTypeDef {
  code: string;
  entityType: "vehicle" | "driver";
  name: Names;
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
  licenseCategories: readonly { code: string; name: Names }[];
  documentTypes: readonly DocumentTypeDef[];
  /** FIN-013: is the tax on this category recoverable? Non-recoverable tax is part of the cost. */
  taxRecoverable: Record<CostCategory, boolean>;
  /** Default VAT rate for display/help; amounts are always entered explicitly. */
  vatRate: number;
  /** INC-005: the vehicle document whose renewal requires fines to be paid (Egypt: the vehicle license). */
  renewalDocumentType: string | null;
  /** National ID format of the country; null = not checked. */
  nationalId: "EG" | "TN" | null;
}

/** Decimal places of each currency (ISO 4217). Money is always stored in minor units. */
export const CURRENCY_MINOR_UNITS: Record<string, number> = { EGP: 2, TND: 3, EUR: 2, USD: 2 };
/** How many minor units make one unit: 100 for EGP, 1000 for TND. */
export const minorFactor = (currency: string | null | undefined) => 10 ** (CURRENCY_MINOR_UNITS[currency ?? ""] ?? 2);
/** "12.5" TND → 12500 millimes. */
export const toMinorUnits = (value: number, currency: string | null | undefined) => Math.round(value * minorFactor(currency));
/** 12500 millimes → 12.5 TND. */
export const fromMinorUnits = (minor: number, currency: string | null | undefined) => minor / minorFactor(currency);

export const EGYPT: CountryTemplate = {
  code: "EG",
  nationalId: "EG",
  renewalDocumentType: "EG_VEH_LICENSE",
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

/**
 * Tunisia (owner, 16 Nov 2026: the system runs in Tunisia). ⚖️ Documents, licence categories and tax treatment
 * still need confirmation by the client. Open question: petrol only, or petrol and diesel (client said petrol only).
 */
export const TUNISIA: CountryTemplate = {
  code: "TN",
  nationalId: "TN",
  renewalDocumentType: null,
  currency: "TND",
  currencyMinorUnits: 3,
  timezone: "Africa/Tunis",
  languages: ["ar", "tn", "fr", "en"],
  distanceUnit: "km",
  weekStart: "monday",
  phonePrefix: "+216",
  fuelTypes: [
    { code: "SSP", name: { ar: "بنزين بدون رصاص", en: "Unleaded petrol", fr: "Essence sans plomb", tn: "بنزين" }, unit: "L" },
    { code: "GO", name: { ar: "غازوال عادي", en: "Diesel", fr: "Gasoil ordinaire", tn: "قازوال" }, unit: "L" },
    { code: "GO50", name: { ar: "غازوال بدون كبريت", en: "Sulphur-free diesel", fr: "Gasoil sans soufre", tn: "قازوال 50" }, unit: "L" },
  ],
  licenseCategories: [
    { code: "A1", name: { ar: "A1 — دراجة نارية خفيفة", en: "A1 — Light motorcycle", fr: "A1 — Motocycle léger" } },
    { code: "A", name: { ar: "A — دراجة نارية", en: "A — Motorcycle", fr: "A — Motocycle" } },
    { code: "B", name: { ar: "B — سيارة خفيفة", en: "B — Car", fr: "B — Véhicule léger" } },
    { code: "BE", name: { ar: "B+E — سيارة بمجرورة", en: "B+E — Car with trailer", fr: "B+E — Véhicule léger avec remorque" } },
    { code: "C1", name: { ar: "C1 — شاحنة خفيفة", en: "C1 — Light truck", fr: "C1 — Camion léger" } },
    { code: "C", name: { ar: "C — شاحنة", en: "C — Truck", fr: "C — Poids lourd" } },
    { code: "CE", name: { ar: "C+E — شاحنة بمجرورة", en: "C+E — Truck with trailer", fr: "C+E — Poids lourd avec remorque" } },
    { code: "D1", name: { ar: "D1 — نقل أشخاص (حتى 17 مقعدًا)", en: "D1 — Minibus", fr: "D1 — Transport de personnes (≤ 17 places)" } },
    { code: "D", name: { ar: "D — حافلة", en: "D — Bus", fr: "D — Autobus" } },
    { code: "DE", name: { ar: "D+E — حافلة بمجرورة", en: "D+E — Bus with trailer", fr: "D+E — Autobus avec remorque" } },
    { code: "H", name: { ar: "H — نقل عمومي (تاكسي ولواج)", en: "H — Public transport (taxi, louage)", fr: "H — Transport public (taxi, louage)" } },
  ],
  // ⚖️ To confirm with the client's accountant: fuel and road taxes are kept as cost; VAT 19% elsewhere is recoverable.
  taxRecoverable: {
    fuel: false, preventive: true, corrective: true, accident: true, insurance: false, licensing: false,
    rental: true, fines: false, tolls: false, other: true,
  },
  vatRate: 0.19,
  documentTypes: [
    { code: "TN_VEH_REGISTRATION", entityType: "vehicle", name: { ar: "البطاقة الرمادية", en: "Registration certificate (carte grise)", fr: "Carte grise", tn: "الكارط قريز" }, mandatory: true, hasExpiry: false, risk: "R4", driverVisibility: "view", sensitive: false },
    { code: "TN_VEH_INSURANCE", entityType: "vehicle", name: { ar: "شهادة التأمين", en: "Insurance certificate", fr: "Attestation d'assurance", tn: "الأسيرونس" }, mandatory: true, hasExpiry: true, risk: "R4", driverVisibility: "view", sensitive: false },
    { code: "TN_VEH_INSPECTION", entityType: "vehicle", name: { ar: "الفحص الفني", en: "Technical inspection", fr: "Visite technique", tn: "الفيزيت" }, mandatory: true, hasExpiry: true, risk: "R3", driverVisibility: "view", sensitive: false },
    { code: "TN_VEH_TAX", entityType: "vehicle", name: { ar: "المعلوم الجبائي على العربات (الفينيات)", en: "Vehicle road tax (vignette)", fr: "Vignette", tn: "الفينيات" }, mandatory: true, hasExpiry: true, risk: "R3", driverVisibility: "view", sensitive: false },
    { code: "TN_VEH_LEASE", entityType: "vehicle", name: { ar: "عقد الإيجار المالي / الكراء", en: "Leasing / rental contract", fr: "Contrat de leasing / location" }, mandatory: false, hasExpiry: true, risk: "R2", driverVisibility: "none", sensitive: false },
    { code: "TN_VEH_TRANSPORT_PERMIT", entityType: "vehicle", name: { ar: "رخصة النقل", en: "Transport permit", fr: "Autorisation de transport" }, mandatory: false, hasExpiry: true, risk: "R3", driverVisibility: "view", sensitive: false },
    { code: "TN_DRV_LICENSE", entityType: "driver", name: { ar: "رخصة السياقة", en: "Driving licence", fr: "Permis de conduire", tn: "البرمي" }, mandatory: true, hasExpiry: true, risk: "R4", driverVisibility: "download", sensitive: false },
    { code: "TN_DRV_CIN", entityType: "driver", name: { ar: "بطاقة التعريف الوطنية", en: "National ID card (CIN)", fr: "Carte d'identité nationale", tn: "الكارط ديدونتيتي" }, mandatory: true, hasExpiry: false, risk: "R2", driverVisibility: "view", sensitive: true },
    { code: "TN_DRV_MEDICAL", entityType: "driver", name: { ar: "شهادة طبية", en: "Medical certificate", fr: "Certificat médical" }, mandatory: false, hasExpiry: true, risk: "R2", driverVisibility: "none", sensitive: true },
    { code: "TN_DRV_CRIMINAL_RECORD", entityType: "driver", name: { ar: "بطاقة عدد 3", en: "Criminal record (bulletin n°3)", fr: "Bulletin n°3" }, mandatory: false, hasExpiry: true, risk: "R2", driverVisibility: "none", sensitive: true },
  ],
};

/** The system runs in Tunisia (owner, 16 Nov 2026); new companies default to it. */
export const DEFAULT_COUNTRY = "TN";
export const COUNTRY_TEMPLATES: Record<string, CountryTemplate> = { TN: TUNISIA, EG: EGYPT };
