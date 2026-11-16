/**
 * Vehicle inspection checklist (owner decision, 14 Nov 2026). Each item is OK or not, with an optional note.
 * "critical" items that fail make the inspection a finding for the fleet manager.
 */
export const INSPECTION_ITEMS = [
  { code: "tires", critical: true, name: { ar: "الإطارات والضغط", en: "Tyres and pressure" } },
  { code: "brakes", critical: true, name: { ar: "الفرامل", en: "Brakes" } },
  { code: "lights", critical: true, name: { ar: "الأنوار والإشارات", en: "Lights and indicators" } },
  { code: "oil", critical: false, name: { ar: "مستوى الزيت", en: "Oil level" } },
  { code: "coolant", critical: false, name: { ar: "مياه الردياتير", en: "Coolant" } },
  { code: "wipers", critical: false, name: { ar: "المساحات", en: "Wipers" } },
  { code: "mirrors", critical: false, name: { ar: "المرايات", en: "Mirrors" } },
  { code: "seatbelts", critical: true, name: { ar: "أحزمة الأمان", en: "Seat belts" } },
  { code: "fire_extinguisher", critical: true, name: { ar: "طفاية الحريق", en: "Fire extinguisher" } },
  { code: "first_aid", critical: false, name: { ar: "شنطة الإسعافات", en: "First aid kit" } },
  { code: "body", critical: false, name: { ar: "الهيكل (خبطات أو كسور)", en: "Body (dents or damage)" } },
  { code: "documents", critical: true, name: { ar: "الرخصة والأوراق في العربية", en: "Licence and papers on board" } },
] as const;
export type InspectionItemCode = (typeof INSPECTION_ITEMS)[number]["code"];
export const INSPECTION_CODES = INSPECTION_ITEMS.map((i) => i.code) as readonly InspectionItemCode[];
