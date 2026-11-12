/** Country templates (CTR-001). Values from docs/Country_Profile_Egypt.md §1–2. */
export interface FuelType { code: string; name: { ar: string; en: string }; unit: "L" | "m3" }

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
};

export const COUNTRY_TEMPLATES: Record<string, CountryTemplate> = { EG: EGYPT };
