# Product Requirements Document (PRD)
## Fleet Management SaaS Platform

**Document Version:** 0.2 — Validated Baseline Candidate
**Document Date:** 11 November 2026
**Status:** Decisions applied under Product Owner delegation — Pending formal Sign-off
**Supersedes:** `PRD_v0.1.md` · **Basis:** `PRD_Gap_Analysis_v0.1.md` (150 findings, Decision Log §6)
**Backlog:** `Backlog_Epics_Stories_v0.2.md`

## Version History

| Version | Date | Change |
|---|---|---|
| 0.1 | 11 Nov 2026 | Discovery Draft |
| 0.2 | 11 Nov 2026 | Gap analysis applied: Requirement IDs, MoSCoW, Pilot/Commercial split, RBAC Matrix, State Machines, Standards & Defaults, new modules (Vendors, Work Orders, Accidents & Fines, Inspection), KPI Dictionary, Pilot thresholds |

## Reading Guide

- **ID:** `<PREFIX>-<NNN>` ثابت لا يُعاد استخدامه.
- **Pri:** `M` Must · `S` Should · `C` Could.
- **Rel:** `P` Pilot MVP · `C` Commercial Release.
- **(D)** = قيمة افتراضية Configurable، معرّفة في §3.
- ما لم يُذكر غير ذلك، كل المتطلبات تخضع للمبادئ العامة في §4.

---

# 1. Vision, Problem, Objectives

**Vision:** منصة لإدارة وتشغيل ومراقبة أساطيل المركبات عبر Web Dashboard وتطبيق Mobile موحد، تنتج بيانات تشغيلية ومالية قابلة للتتبع والتحقق. تبدأ بشركة واحدة في دولة واحدة، بهيكل يدعم Multi-Tenant / Multi-Country.

**Business Problems:** تشتت البيانات · صعوبة مطابقة الوقود والكروت · غياب سجل صيانة موحد · عدم وضوح التكلفة الحقيقية · ضعف متابعة المستندات · غياب سجل عهدة موثوق · فقد العمليات Offline · عدم وضوح جودة البيانات · صعوبة التوسع.

| Objective | KPI القياس | Target |
|---|---|---|
| Centralized Operations | Data Coverage | ≥ 90% (Pilot) |
| Cost Visibility | Cost Records Reconciled to Source | ≥ 99% |
| Maintenance Control | Maintenance Compliance % | Baseline في الـPilot |
| Fuel Control | Card Matching Coverage | ≥ 95% |
| Operational Accountability | Custody Coverage (فترات لها مسؤول معروف) | ≥ 95% |
| Compliance Support | Document Compliance % | Baseline في الـPilot |
| Offline Reliability | Sync Success Rate | ≥ 99.5%، صفر فقد مؤكد |
| Decision Support | KPIs مع Data Quality Status | 100% من الـKPIs |
| SaaS Expansion | Tenant Provisioning آلي | < 30 دقيقة |

---

# 2. Scope

## 2.1 Module Map

| Module | Prefix | Activation | Release | Depends On |
|---|---|---|---|---|
| Tenancy & SaaS Admin | TEN | Mandatory | P (أساسي) / C (Subscriptions) | — |
| Company Administration & RBAC | ADM / SEC | Mandatory | P | TEN |
| Country Configuration | CTR | Mandatory | P (دولة واحدة) / C (متعدد) | TEN |
| Vendors Master | VND | Mandatory | P | ADM |
| Vehicles | VEH | Mandatory | P | ADM |
| Drivers | DRV | Mandatory | P | ADM |
| Assignments & Handover | ASN | Mandatory | P | VEH, DRV |
| Odometer / Meter | ODO | Mandatory | P | VEH |
| Fuel | FUEL | Mandatory | P | ODO, ASN |
| Maintenance & Work Orders | MNT / WO | Mandatory | P | ODO, VND |
| Documents | DOC | Mandatory | P | VEH, DRV |
| Operational Readiness | OPS | Mandatory | P | DOC, MNT, ASN |
| Alerts & Notifications | ALR / NTF | Mandatory | P (بدون SLA Calendar) / C (SLA كامل) | — |
| Offline & Sync | OFF | Mandatory | P | — |
| Import / Export | IMP | Mandatory | P | — |
| Audit & Corrections | AUD | Mandatory | P | — |
| Dashboards, KPIs, Reports | KPI / RPT | Mandatory | P (أساسي) / C (متقدم) | — |
| Fuel Cards & Reconciliation | CARD | Optional | C | FUEL, VND |
| Cost Management & Allocation | FIN | Mandatory | P (Recorded) / C (Allocated, Period Close) | — |
| Multi-Currency FX | FX | Optional | C (Schema-ready في P) | FIN |
| Driver Sessions | SES | Optional | C | ASN, ODO |
| Trips | TRP | Optional | C | SES (لو مفعّل) |
| Leave & Availability | LEV | Optional | C | DRV |
| Accidents & Fines | INC | Optional | C | VEH, DRV, FIN |
| Inspection Checklist | INS | Optional | C | VEH |

تعطيل موديول اختياري: يخفي وظائفه، وتُعرض الـKPIs المعتمدة عليه كـ`Not Applicable` وليس صفرًا.

## 2.2 Out of Scope — Initial Commercial Release

Continuous GPS Tracking · Real-Time Telematics · GPS/OBD Hardware · Dispatch Optimization · Trip Expenses · Multi-stop Trips · Payroll/HR كامل · Full ERP Ledger · Depreciation / Full TCO · Automatic Fuel Provider APIs · AI/ML Predictive Maintenance · Multi-Level Workflow Engine · Tire position/tread tracking · Driver-level efficiency scoring · Public API & Webhooks · ERP Connectors (يوجد Export ملفّي) · تخزين PIN أو بيانات الكروت الحساسة · Automated Tenant Region Migration.

---

# 3. Standards & Defaults

## 3.1 Reference Standards

| Area | Standard |
|---|---|
| Countries / Currencies / Languages | ISO 3166-1 · ISO 4217 · BCP 47 |
| Date-Time | ISO 8601؛ التخزين UTC + IANA Timezone |
| Units (internal) | SI: km، Liter؛ التحويل للعرض فقط |
| Money | Decimal بدقة العملة (ISO 4217 minor units)، بدون Floating Point |
| Web Security | OWASP ASVS Level 2 · OWASP Top 10 |
| Mobile Security | OWASP MASVS |
| Authentication | NIST SP 800-63B · MFA بـTOTP (RFC 6238) |
| Encryption | TLS 1.2+ في النقل · AES-256 في التخزين |
| Accessibility | WCAG 2.1 AA |
| FX | IAS 21 — سعر تاريخ المعاملة |
| Incident Severity | ITIL (Sev1–Sev4) |

## 3.2 Default Values (كلها Configurable ضمن Platform Guardrails)

| Key | Default |
|---|---|
| D-ODO-MAXDAY — أقصى مسافة يومية قبل المراجعة | 1,500 km |
| D-ODO-CORROB — فرق قراءتين متزامنتين يُعتبر تأكيدًا | ±2 km خلال 10 دقائق |
| D-FUEL-TANKTOL — تجاوز سعة الخزان | +5% |
| D-FUEL-PRICETOL — انحراف سعر اللتر عن المرجع | ±20% |
| D-FUEL-DUPWIN — نافذة كشف التكرار | 30 دقيقة |
| D-FUEL-CONSTOL — انحراف الاستهلاك عن متوسط المركبة | ±30% |
| D-MNT-UPCOMING — عتبة Upcoming | 500 km أو 14 يوم |
| D-DOC-LEAD — تنبيهات قبل الانتهاء | 30 / 14 / 7 أيام |
| D-DOC-GRACE — فترة السماح بعد الانتهاء | 0 يوم |
| D-SES-OPENMAX — Session مفتوحة قبل التنبيه | 14 ساعة |
| D-REC-AMT / TIME / LTR — هوامش المطابقة | ±1% (أو ±1 وحدة عملة) / ±2 ساعة / ±2% |
| D-OFF-WINDOW / D-OFF-MAX — صلاحية Offline | 72h / 168h (Platform Maximum) |
| D-OFF-CLOCK — انحراف ساعة الجهاز قبل التعليم | 5 دقائق |
| D-FILE-PHOTO / D-FILE-DOC — حجم الملفات | صورة ≤ 500 KB بعد الضغط / مستند ≤ 10 MB (PDF, JPG, PNG) |
| D-BUD-THRESH — عتبات الميزانية | 80% / 100% |
| D-SEC-LOCKOUT | 5 محاولات فاشلة → قفل 15 دقيقة |
| D-SEC-WEBIDLE / ABS | 30 دقيقة Idle / 12 ساعة Absolute |
| D-SEC-PWD | ≥ 12 حرف، فحص القوائم المسرّبة، بدون تغيير دوري إجباري |
| D-SEC-BREAKGLASS | 24 ساعة، Read-only |
| D-FX-LOOKBACK | آخر سعر سابق حتى 7 أيام (Estimated) |
| D-RET-FIN / AUDIT / GPS | 7 سنوات / 7 سنوات / 1 سنة — مؤقت حتى OD-07 |
| D-BKP | PITR، RPO ≤ 15 دقيقة، RTO ≤ 4 ساعات، احتفاظ 35 يوم، Restore Test ربع سنوي |

---

# 4. Global Principles (تنطبق على كل الموديولات)

| ID | Principle | Pri | Rel |
|---|---|---|---|
| GEN-001 | كل سجل تشغيلي يحفظ **Event Time** (وقت الواقعة) و**Recorded Time** (وقت الاستلام بالسيرفر) منفصلين | M | P |
| GEN-002 | **No Hard Delete** للسجلات التشغيلية والمالية؛ الإلغاء بـVoid/Cancel مع سبب. الحذف الفعلي فقط للـDrafts غير المرسلة وRetention Purge | M | P |
| GEN-003 | **No Silent Overwrite:** كل تعديل ينشئ Correction (Previous, New, Reason, By, At, Approval) | M | P |
| GEN-004 | **Maker ≠ Checker:** لا يعتمد المستخدم سجلًا أنشأه | M | P |
| GEN-005 | **Missing ≠ Zero:** البيانات الناقصة تُعرض Unavailable/Partial ولا تدخل الحسابات كصفر | M | P |
| GEN-006 | لا تُحتسب أي Financial Transaction مرتين؛ لكل مصروف Expense Identity واحد | M | P |
| GEN-007 | الإعدادات **Effective-dated**؛ لا أثر رجعي إلا بقرار صريح + Recalculation | M | P |
| GEN-008 | **Precedence:** Platform Guardrails > Country Mandatory > Company Config؛ الشركة تشدّد ولا تخفف القواعد الإلزامية | M | P |
| GEN-009 | كل Authorization يُنفّذ Server-side؛ إخفاء عنصر الواجهة ليس حماية | M | P |
| GEN-010 | Timezone: التخزين UTC؛ تقارير الفرع بتوقيته، والمجمّعة بتوقيت الشركة | M | P |
| GEN-011 | كل KPI يُعرض مع **Data Quality Status** | M | P |
| GEN-012 | السجل الذي يفشل في قاعدة تحقق **يُحفظ ويُعلَّم** (Warning/Conflict) ولا يُرفض بصمت — عدا أخطاء الصيغة والحقول الإلزامية | M | P |

---

# 5. Users, Roles & RBAC

## 5.1 Roles

| Role | Scope | Summary |
|---|---|---|
| Platform Administrator | Platform | Tenants، Country Templates، صحة الخدمة. لا وصول لبيانات العملاء إلا بـBreak-Glass |
| Company Administrator | Tenant | إعداد الشركة، المستخدمين، السياسات، كل التقارير |
| Fleet Manager | Assigned Branches | المركبات، السائقين، التخصيص، المراجعة والاعتماد |
| Finance Reviewer | Tenant (مالي) | التكاليف، الكروت، المطابقة، Period Close |
| Driver | Own records | تسجيل العمليات الميدانية، Offline |
| Viewer | Tenant / Branches | قراءة فقط |

## 5.2 Requirements

| ID | Requirement | Pri | Rel |
|---|---|---|---|
| SEC-001 | الصلاحية = User + Active Role + Tenant + Assigned Branches + Action + Resource | M | P |
| SEC-002 | Multiple Roles per User مع **دور نشط واحد** في كل لحظة وRole Switcher | M | P |
| SEC-003 | تطبيق RBAC Matrix (§5.3) كـBaseline | M | P |
| SEC-004 | Admin/Manager/Finance: Email + Password (D-SEC-PWD) + **MFA إلزامي** للـPlatform Admin وCompany Admin | M | P |
| SEC-005 | Driver: Phone + OTP، ثم Device-bound Token + PIN/Biometric لفتح التطبيق | M | P |
| SEC-006 | Lockout (D-SEC-LOCKOUT)، Web Session Timeout (D-SEC-WEBIDLE/ABS)، Revocation فوري عند تعطيل الحساب | M | P |
| SEC-007 | **Break-Glass:** طلب → موافقة Company Admin → وصول مؤقت (D-SEC-BREAKGLASS) → Audit ظاهر للعميل | M | P |
| SEC-008 | هوية واحدة على المنصة + Membership لكل Tenant مع Tenant Switcher | S | C |
| SEC-009 | Custom Roles ينشئها Company Admin من Permissions معرّفة | S | C |
| SEC-010 | Shared Device Mode لسائقين متعددين على جهاز واحد | C | C |
| SEC-011 | Audit Log (Append-only) لكل عملية حساسة: Login، تغيير صلاحية، اعتماد، Correction، Override، Download مستند، Export | M | P |
| SEC-012 | Tenant Isolation Tests آلية + Penetration Test قبل الإنتاج | M | P |

## 5.3 RBAC Matrix (Baseline)

✅ Full · 🔵 Assigned Branches · 👤 Own · 👁 View · ✔️ Approve/Verify · — None

| Resource / Action | Platform Admin | Company Admin | Fleet Manager | Finance | Driver | Viewer |
|---|---|---|---|---|---|---|
| Tenants / Country Templates | ✅ | — | — | — | — | — |
| Company settings, users, roles | — | ✅ | — | — | — | — |
| Vendors | — | ✅ | 🔵 | ✅ | — | 👁 |
| Vehicles create/edit | — | ✅ | 🔵 | 👁 | 👁 المخصصة | 👁 |
| Vehicle transfer / dispose | — | ✅ | 🔵 نقل فقط | — | — | — |
| Drivers create/edit | — | ✅ | 🔵 | — | 👤 بيانات الاتصال | 👁 |
| Assignments | — | ✅ | 🔵 | — | 👁👤 | 👁 |
| Handover | — | ✅ | 🔵✔️ | — | 👤 إنشاء | — |
| Fuel entry create | — | ✅ | 🔵 | — | 👤 | — |
| Fuel entry review / void | — | ✅ | 🔵✔️ | ✔️ | — | — |
| Odometer manual / correction | — | ✅ | 🔵 | — | 👤 إنشاء | — |
| Defect report | — | ✅ | 🔵 | — | 👤 إنشاء | — |
| Work orders / visits | — | ✅ | 🔵 | 👁 | — | 👁 |
| Documents upload | — | ✅ | 🔵 | — | 👤 | — |
| Documents verify | — | ✔️ | 🔵✔️ | — | — | — |
| Readiness override (R2/R3) | — | ✅ | 🔵 حسب الإعداد | — | — | — |
| Fuel cards, statements, reconciliation | — | ✅ | 🔵👁 | ✅✔️ | — | — |
| Sessions / Trips | — | ✅ | 🔵✔️ | — | 👤 | 👁 |
| Leave | — | ✅ | 🔵✔️ | — | 👤 | — |
| Costs create/edit | — | ✅ | 🔵 | ✅ | — | — |
| Period close | — | ✅ | — | ✅ | — | — |
| Sync conflicts resolve | — | ✅ | 🔵 | ✔️ المالية | — | — |
| Corrections approve | — | ✅ | 🔵 غير المالية | ✔️ المالية | — | — |
| Dashboards & reports | Platform health | ✅ | 🔵 | ✅ مالي | Driver Home | 👁 |
| Audit log | Platform audit | ✅ | 🔵👁 | 👁 مالي | — | — |
| Import | — | ✅ | 🔵 Master Data | ✅ مالي | — | — |

---

# 6. Tenancy & SaaS Administration (TEN)

**Confirmed:** Database per Tenant · Single Region Initially, Region-Ready.

| ID | Requirement | Pri | Rel |
|---|---|---|---|
| TEN-001 | إنشاء Tenant آليًا: Database + Storage معزول + Default Roles + Country Template + Admin Invite + Audit | M | P |
| TEN-002 | Tenant Routing آمن؛ كل طلب يُربط بـTenant واحد من الهوية الموثّقة لا من مدخلات العميل | M | P |
| TEN-003 | عزل Documents/Photos لكل Tenant | M | P |
| TEN-004 | Tenant Lifecycle: Provisioning → Active → Suspended (Read-only) → Terminated | M | P |
| TEN-005 | Backup وMonitoring لكل Tenant (D-BKP) | M | P |
| TEN-006 | Schema Migration مُدار عبر كل قواعد البيانات مع تقرير حالة وRollback | M | P |
| TEN-007 | كل Tenant مرتبط بـHome Region | M | P |
| TEN-008 | Subscription/Plan مع حدود (Vehicles/Users/Storage) وتحذير قبل الحد | S | C |
| TEN-009 | Tenant Termination: Export مصرح → Retention Review → Deletion/Archive → Audit Evidence | S | C |

---

# 7. Country Configuration (CTR)

**Confirmed:** Platform Templates + Company Configuration.

| ID | Requirement | Pri | Rel |
|---|---|---|---|
| CTR-001 | Country Template: Code، Currency، Timezone، Distance/Volume Unit، Fuel Types، License Categories، Mandatory Documents، Eligibility Policies، Working Calendar/Holidays، Week Start، Tax Rules، Retention | M | P |
| CTR-002 | Company Layer: Branch Settings، Fuel Budgets، Maintenance Policies، Alert Recipients، SLA، Optional Modules، Schedules، Reporting Currency | M | P |
| CTR-003 | Country Lifecycle: Draft → Configuration Ready → Compliance Review → UAT Approved → Active ⇄ Suspended؛ الاعتماد: Product Owner + Compliance + UAT | M | C |
| CTR-004 | i18n: Arabic RTL، English LTR، French LTR؛ لغة لكل مستخدم؛ تنسيق محلي للتاريخ/الأرقام/العملة؛ إشعارات مترجمة | M | P (AR/EN) · C (FR) |
| CTR-005 | Hijri Calendar display | C | Deferred حتى OD-01 |

---

# 8. Vendors Master (VND)

| ID | Requirement | Pri | Rel |
|---|---|---|---|
| VND-001 | Vendor: ID، Name، Type (Workshop / Fuel Provider / Lessor / Insurer / Other)، Contact، Tax ID، Branch coverage، Status | M | P |
| VND-002 | Vendor مطلوب مرجعيًا في Maintenance Visit، Fuel Card، Lease Contract، Cost Record | M | P |
| VND-003 | تعطيل Vendor لا يؤثر على السجلات التاريخية | M | P |

---

# 9. Vehicles (VEH)

| ID | Requirement | Pri | Rel |
|---|---|---|---|
| VEH-001 | Vehicle Master: Vehicle ID، Fleet Number، Registration Number، VIN، Country of Registration، Type، Make/Model/Year، Fuel Type، **Tank Capacity**، **Meter Type (Distance/Hours/Both)**، **Required License Category**، Ownership Type، Branch، Cost Center، Operational Start Date | M | P |
| VEH-002 | Uniqueness داخل الـTenant للمركبات غير Disposed: Fleet Number، Registration Number، VIN | M | P |
| VEH-003 | **Lifecycle:** Draft → Active ⇄ Inactive → Disposed (Sold/Scrapped/Returned) | M | P |
| VEH-004 | **Availability** محسوبة ومنفصلة: Available / In Use / Under Maintenance / Restricted / Out of Service | M | P |
| VEH-005 | Branch Transfer: يحفظ الفرع السابق وتاريخ النقل؛ لا يعيد نسبة العمليات التاريخية؛ ينبّه للـAssignments والكروت المتأثرة | M | P |
| VEH-006 | Disposal Record: Date، Final Odometer، Sale Value؛ منع أي عملية بـEvent Time بعد Disposal Date | M | P |
| VEH-007 | Lease/Rental Contract: Vendor، Start/End، Periodic Cost، Distance Allowance؛ Alert قبل الانتهاء وعند تجاوز الـAllowance | S | C |
| VEH-008 | Vehicle 360 View (§26.3) | M | P |

---

# 10. Drivers (DRV)

| ID | Requirement | Pri | Rel |
|---|---|---|---|
| DRV-001 | Driver Master: ID، Employee Ref، Name، Contact، Home Branch، License No./Categories/Expiry، Employment Status | M | P |
| DRV-002 | Driver Record منفصل عن User Account؛ التاريخ يبقى بعد تعطيل الحساب | M | P |
| DRV-003 | Employment Status: Active / Suspended / Terminated — منفصل عن Account Status | M | P |
| DRV-004 | Eligibility تُعاد تقييمها: عند تغيير أي مدخل، Job يومي، وعند كل Enforcement Point Online | M | P |
| DRV-005 | License Grace Period (D-DOC-GRACE) per Country | S | P |
| DRV-006 | التخصيص خارج Home Branch يتطلب صلاحية على الفرعين | S | P |

---

# 11. Assignments & Handover (ASN)

| ID | Requirement | Pri | Rel |
|---|---|---|---|
| ASN-001 | Assignment: Vehicle، Driver، Role (Primary/Secondary)، Start، End (اختياري)، Created By | M | P |
| ASN-002 | مركبة ↔ **Primary Driver واحد** لكل فترة؛ Secondary Drivers متعددون مسموح | M | P |
| ASN-003 | السائق Primary لمركبة واحدة في نفس الفترة (Configurable) | M | P |
| ASN-004 | منع التداخل المخالف لـASN-002/003 عند الحفظ مع رسالة تحدد التعارض | M | P |
| ASN-005 | Assignment يمر على Readiness (§17) عند الإنشاء | M | P |
| ASN-006 | Backdated Assignment بصلاحية + Recalculation + Audit | S | P |
| ASN-007 | **Handover:** From، To، Vehicle، Timestamp، Odometer، Photo، Notes؛ المستلم يجب أن يكون مخوّلًا ومؤهلًا؛ لا ينشئ Assignment | M | P |
| ASN-008 | Handover يعمل Offline بتأكيد الطرفين؛ Verification لاحق من Fleet Manager | S | C |
| ASN-009 | Custody Timeline: لكل لحظة مسؤول معروف أو فجوة ظاهرة | M | P |

---

# 12. Odometer / Meter (ODO)

| ID | Requirement | Pri | Rel |
|---|---|---|---|
| ODO-001 | Timeline موحد لكل مركبة؛ المصادر: Opening Balance، Fuel، Session، Trip، Maintenance، Handover، Manual | M | P |
| ODO-002 | Reading: Vehicle، Value، Event Time، Recorded Time، Source Type/ID، Photo، Created By، Validation Status | M | P |
| ODO-003 | Validation Status: Valid / Warning / Conflict / Corrected / Excluded | M | P |
| ODO-004 | **Conflict** إذا القراءة أقل من قراءة Valid سابقة زمنيًا أو أعلى من لاحقة زمنيًا | M | P |
| ODO-005 | **Warning** إذا المسافة/اليوم > D-ODO-MAXDAY | M | P |
| ODO-006 | قراءات Conflict/Excluded تُستبعد من الـKPIs حتى المعالجة؛ السجل المصدر يبقى محفوظًا (GEN-012) | M | P |
| ODO-007 | Current Odometer = آخر قراءة Valid حسب Event Time | M | P |
| ODO-008 | قراءتان ضمن D-ODO-CORROB = Corroborating وليستا تكرارًا | S | P |
| ODO-009 | Meter Replacement Event (Old Final، New Start، Date، Evidence) يبدأ Segment؛ المسافة = مجموع الـSegments | M | P |
| ODO-010 | Correction لا تعيد ضبط التاريخ؛ تنشئ نسخة مصححة وتطلق Recalculation | M | P |
| ODO-011 | دعم Engine Hours لمركبات Meter Type = Hours/Both | S | C |

---

# 13. Fuel (FUEL)

| ID | Requirement | Pri | Rel |
|---|---|---|---|
| FUEL-001 | Fuel Entry: Vehicle، Driver، Event Time، Odometer، Liters، Total Amount (Net/Tax/Gross)، Currency، Fuel Type، Full/Partial، Payment (Cash/Card)، Receipt Photo، Location (اختياري)، Notes، Recorded On Behalf Of | M | P |
| FUEL-002 | Lifecycle: Draft → Submitted → [Under Review] → Accepted → Voided؛ المراجعة Configurable | M | P |
| FUEL-003 | الحقول الإلزامية + Liters > 0 + Amount > 0 وإلا رفض | M | P |
| FUEL-004 | Liters > Tank Capacity × (1 + D-FUEL-TANKTOL) → Conflict | M | P |
| FUEL-005 | Unit Price = Amount ÷ Liters؛ خارج Reference ± D-FUEL-PRICETOL → Warning | S | P |
| FUEL-006 | Possible Duplicate: نفس Vehicle + Amount + Liters خلال D-FUEL-DUPWIN، أو نفس Receipt/Transaction Ref | M | P |
| FUEL-007 | Fuel Type ≠ Vehicle Fuel Type → Warning | M | P |
| FUEL-008 | سائق بدون Assignment سارٍ → Allowed with Warning + Review (لا تُمنع واقعة حدثت) | M | P |
| FUEL-009 | Receipt Photo: إلزامية للـCash، اختيارية للـCard (Configurable) | M | P |
| FUEL-010 | السائق يعدّل قبل Submit/Sync فقط؛ بعدها Correction Request | M | P |
| FUEL-011 | **Full-to-Full:** Consumption (L/100km) = Σ Liters بعد Full السابقة حتى Full الحالية (شاملة) ÷ المسافة بين القراءتين × 100 | M | P |
| FUEL-012 | الدورة Valid فقط إذا قراءتا الحدّين Valid ولا يوجد Conflict/Void غير معالج داخلها؛ وإلا Partial/Unavailable | M | P |
| FUEL-013 | Purchased Liters تُعرض منفصلة عن Calculated Consumption | M | P |
| FUEL-014 | استهلاك خارج متوسط المركبة ± D-FUEL-CONSTOL → Anomaly Flag للمراجعة | S | C |
| FUEL-015 | Fuel Budget: Entity (Vehicle/Branch/Company) + Monthly + Amount و/أو Liters + Alerts عند D-BUD-THRESH | S | P |

---

# 14. Fuel Cards & Reconciliation (CARD)

| ID | Requirement | Pri | Rel |
|---|---|---|---|
| CARD-001 | Card Master: Provider (Vendor)، Reference، Type (Prepaid/Postpaid)، Assigned Entity Type/ID لكل كارت، Currency، Limit/Budget، Validity | M | C |
| CARD-002 | Lifecycle: Active / Blocked / Lost / Expired / Cancelled؛ تفويلة على كارت غير Active → Conflict | M | C |
| CARD-003 | Prepaid: **Confirmed Balance** من كشف المزود فقط؛ **Estimated** = Confirmed − تفويلات التطبيق غير المطابقة بعد آخر كشف | M | C |
| CARD-004 | Top-Up ليست Fuel Expense؛ Settlement لا يضاعف Provider Charges | M | C |
| CARD-005 | Postpaid: Credit Limit، Utilization، Settlements، Over-Limit Alert | M | C |
| CARD-006 | Statement Import بـTemplate/Mapping محفوظ لكل Provider؛ Idempotent بـProvider Transaction Ref | M | C |
| CARD-007 | Auto-Match: Card Ref + Amount (D-REC-AMT) + Time (D-REC-TIME) + Liters (D-REC-LTR)؛ مرشح واحد → Matched؛ جزئي أو متعدد → Under Review | M | C |
| CARD-008 | States: Unmatched → Matched \| Conflict → Under Review → Resolved | M | C |
| CARD-009 | Provider Transaction بدون تفويلة → Fuel Expense بمصدر Provider + Data Quality Partial + Alert؛ ربطها لاحقًا بتفويلة لا ينشئ مصروفًا ثانيًا | M | C |
| CARD-010 | تفويلة Offline بكارت → Pending Card Validation عند المزامنة | M | C |

---

# 15. Maintenance & Work Orders (MNT / WO)

| ID | Requirement | Pri | Rel |
|---|---|---|---|
| MNT-001 | Types: Preventive / Corrective / Accident-Related | M | P |
| MNT-002 | Templates حسب Vehicle Type/Model + Overrides للمركبة؛ Items قابلة للتعريف | M | P |
| MNT-003 | Intervals: Distance / Date / Combined = **Whichever Comes First** | M | P |
| MNT-004 | Status: OK / Upcoming (D-MNT-UPCOMING) / Due / Overdue / Unknown Baseline | M | P |
| MNT-005 | Forecast من آخر Baseline موثوق + معدل حركة حديث؛ Baseline ناقص أو Conflict → Unknown/Estimated | M | P |
| MNT-006 | Maintenance Visit: Vehicle، Date، Odometer، Vendor، Type، Items، **Invoice Total (Net/Tax/Gross) إلزامي**، Breakdown اختياري (Parts/Labor/Other)، Attachment، Status | M | P |
| MNT-007 | Σ Breakdown يجب أن = Invoice Total أو يُعرض الفرق كـUnallocated؛ التقارير تحسب Invoice Total مرة واحدة | M | P |
| MNT-008 | Visit مكتملة تحدّث Baseline البنود المنفذة وتغلق التنبيهات المرتبطة | M | P |
| WO-001 | **Defect Report** (Driver): Vehicle، Description، Severity، Photo، Drivable? — يعمل Offline | M | P |
| WO-002 | Defect: Reported → Triaged → Converted \| Rejected \| Duplicate | M | P |
| WO-003 | **Work Order:** Open → Scheduled → In Progress → Completed → Closed؛ Cancelled قبل Completed | M | P |
| WO-004 | Work Order "Not Drivable" → Availability = Under Maintenance + Restriction R4 حتى الإغلاق | M | P |
| WO-005 | Downtime = من Off-Road حتى Return to Service | S | P |
| WO-006 | Visit تُربط بـWork Order؛ إغلاق الـWO يتطلب Visit أو سبب | M | P |

---

# 16. Documents (DOC)

| ID | Requirement | Pri | Rel |
|---|---|---|---|
| DOC-001 | Document Types: Predefined (Country) + Custom (Company)؛ لكل Type: Mandatory?، Has Expiry?، Lead Times، Risk Category، Driver-visible? | M | P |
| DOC-002 | Record: Entity (Vehicle/Driver)، Type، Number، Issue/Expiry، Country، Attachment (D-FILE-DOC)، Version | M | P |
| DOC-003 | **Verification Status:** Draft → Pending → Verified \| Rejected؛ Verified → Superseded | M | P |
| DOC-004 | **Validity** محسوبة: Valid / Expiring / Expired / No Expiry — منفصلة عن Verification | M | P |
| DOC-005 | الاستبدال يحفظ النسخة السابقة | M | P |
| DOC-006 | Pending Verification للأهلية: Configurable per Type (Default: Allowed with Warning) | M | P |
| DOC-007 | السائق يرى المستندات المحددة لمركبته الحالية؛ View وDownload صلاحيتان منفصلتان | M | P |
| DOC-008 | Audit لكل Download | M | P |
| DOC-009 | تنبيهات Expiry حسب D-DOC-LEAD | M | P |

---

# 17. Operational Readiness (OPS)

**Confirmed:** Configurable by Risk · Outcomes: Allowed / Allowed with Warning / Restricted.

| ID | Requirement | Pri | Rel |
|---|---|---|---|
| OPS-001 | Dimensions: Vehicle Eligibility، Driver Eligibility، Availability، Assignment Authorization | M | P |
| OPS-002 | Risk: R1 Informational · R2 Administrative · R3 Operational · R4 Legal/Safety | M | P |
| OPS-003 | Rule Catalog Configurable: Condition → Dimension → Risk → Outcome (§17.1) | M | P |
| OPS-004 | القاعدة الأكثر تقييدًا تحدد النتيجة | M | P |
| OPS-005 | R4 لا Override؛ R2/R3 Override بصلاحية + Reason + Expiry إلزامي + Audit | M | P |
| OPS-006 | غياب البيانات ≠ مخالفة؛ لكن القاعدة قد تعرّف "غياب الدليل الإلزامي" كسبب Restriction صراحةً | M | P |
| OPS-007 | **Enforcement Points:** Assignment Create، Session Start، Trip Start، Handover. Fuel Entry/Defect Report = Warning فقط | M | P |
| OPS-008 | إزالة Restriction تتطلب زوال السبب وإعادة التقييم | M | P |

### 17.1 Default Rule Catalog (القيم القانونية تُعتمد بعد OD-05)

| Rule | Risk | Outcome |
|---|---|---|
| رخصة السائق منتهية / فئة لا تطابق المركبة | R4 | Restricted |
| مستند مركبة إلزامي قانونيًا منتهٍ | R4 | Restricted |
| Work Order "Not Drivable" | R4 | Restricted |
| صيانة Overdue لبند سلامة | R3 | Restricted (Override) |
| السائق في إجازة معتمدة / لا Assignment سارٍ | R3 | Restricted |
| مستند إلزامي Pending Verification | R2 | Allowed with Warning |
| صيانة وقائية Overdue (بند عادي) | R2 | Allowed with Warning |
| مستند ينتهي قريبًا | R1 | Allowed |

---

# 18. Driver Sessions (SES) — Optional

| ID | Requirement | Pri | Rel |
|---|---|---|---|
| SES-001 | Start: Driver، Vehicle، Time، Opening Odometer، Photo/Location اختياري؛ يمر على Readiness | M | C |
| SES-002 | End: Time، Closing Odometer، Notes | M | C |
| SES-003 | مركبة = Session مفتوحة واحدة؛ سائق = Session مفتوحة واحدة؛ التعارض Offline → Conflict Review | M | C |
| SES-004 | Session مفتوحة > D-SES-OPENMAX → Alert؛ إغلاق إداري بدليل = Estimated | M | C |
| SES-005 | Used Day: كل يوم (بتوقيت الفرع) تلمسه Session. Driven Day: يوم بمسافة > 0 من قراءات Valid | M | C |
| SES-006 | Opening ≠ Closing السابقة بأكثر من Tolerance → Unaccounted Distance Flag | S | C |
| SES-007 | غياب Session لا يُفسَّر Idle؛ حركة بدون Session → Missing Session Alert | M | C |
| SES-008 | **Hierarchy:** Assignment (من يحق له) ⊃ Session (من يستخدم) ⊃ Trip. Handover يغلق Session ويفتح أخرى | M | C |

# 19. Trips (TRP) — Optional

| ID | Requirement | Pri | Rel |
|---|---|---|---|
| TRP-001 | Trip: Vehicle، Driver، Date، Purpose، Destination، Start/End Odometer، Start/End GPS، Notes؛ إلزامية Purpose/Destination Configurable | M | C |
| TRP-002 | Lifecycle: Draft → Pending Approval → Approved \| Rejected → In Progress → Completed؛ Cancelled قبل In Progress | M | C |
| TRP-003 | Approval Mode: Prior Required / Not Required؛ Emergency Trip (Configurable) بـPost-Approval | M | C |
| TRP-004 | GPS عند البداية والنهاية فقط بموافقة؛ الرفض يسجَّل "Permission Denied" ولا يمنع؛ GPS الموبايل ليس دليلًا قاطعًا | M | C |
| TRP-005 | لو Sessions مفعّلة: Trip داخل Session؛ Trip Start يفتح Session تلقائيًا | M | C |
| TRP-006 | Trip Coverage % = Σ Valid Trip Distance ÷ Valid Recorded Distance؛ الفرق ليس Unauthorized Usage تلقائيًا | S | C |

# 20. Leave & Availability (LEV) — Optional

| ID | Requirement | Pri | Rel |
|---|---|---|---|
| LEV-001 | Leave Request: Type، Start/End، Notes؛ Pending → Approved \| Rejected؛ Approved → Cancelled | M | C |
| LEV-002 | إجازة معتمدة لسائق له Assignment → Alert لتعيين Substitute + Restriction R3 خلال الإجازة | M | C |
| LEV-003 | Availability % = Available Hours ÷ Scheduled Hours (Working Schedule) | S | C |
| LEV-004 | Leave Balance اختياري؛ ليس HR/Payroll | C | C |

# 21. Accidents & Fines (INC) — Optional

| ID | Requirement | Pri | Rel |
|---|---|---|---|
| INC-001 | Accident: Vehicle، Driver، Time، Location، Description، Photos، Third Party، Police/Insurance Ref، Status (Reported → Under Review → Closed) | S | C |
| INC-002 | ربط Accident بـWork Order (Accident-Related) وبتكاليف الإصلاح والتعويض | S | C |
| INC-003 | Fine: Vehicle، Violation Time، Amount، Authority Ref، Due Date؛ السائق المسؤول يُقترح من Custody Timeline ويُؤكَّد يدويًا | S | C |
| INC-004 | Fine تسجَّل Cost (Category = Fines) مرة واحدة | S | C |

# 22. Inspection Checklist (INS) — Optional

| ID | Requirement | Pri | Rel |
|---|---|---|---|
| INS-001 | Checklist Templates حسب Vehicle Type؛ تنفَّذ عند Session Start/Handover (Configurable)، Offline | C | C |
| INS-002 | بند Fail ينشئ Defect Report تلقائيًا | C | C |

---

# 23. Cost Management (FIN) & Multi-Currency (FX)

| ID | Requirement | Pri | Rel |
|---|---|---|---|
| FIN-001 | Cost Record: Category، Vehicle/Branch، Cost Center، Vendor، Net/Tax/Gross، Currency، Expense Date، Payment Date، Coverage Start/End، Attachment، Source (Manual/Fuel/Maintenance/Provider/Fine) | M | P |
| FIN-002 | Categories: Fuel، Preventive، Corrective، Accident، Insurance، Licensing، Rental/Lease، Fines، Other (Configurable) | M | P |
| FIN-003 | Fuel وMaintenance تنشئ Cost تلقائيًا من سجلها (Expense Identity واحد) | M | P |
| FIN-004 | **Recorded View** حسب Expense Date | M | P |
| FIN-005 | التقارير Net افتراضيًا (Configurable Gross) | M | P |
| FIN-006 | **Allocated View:** Daily Proration = Amount ÷ Coverage Days (شامل)؛ الباقي من التقريب في آخر فترة؛ Σ Allocated = Amount | M | C |
| FIN-007 | Refund = تكلفة سالبة مرتبطة بالأصل وتعيد التوزيع | S | C |
| FIN-008 | Allocation تتوقف عند Disposal Date؛ المتبقي يُعرض Unallocated | S | C |
| FIN-009 | Cost/km = Cost ÷ Valid Distance لنفس الفترة؛ Recorded وAllocated منفصلان؛ Distance غير موثوقة → Unavailable | M | P (Recorded) · C (Allocated) |
| FIN-010 | **Period Close** شهري؛ بعد الإغلاق: Adjustment في فترة مفتوحة أو Reopen بموافقة | S | C |
| FIN-011 | تكاليف غير مرتبطة بمركبة تسجَّل على الفرع ولا تدخل Cost/km للمركبات | S | C |
| FX-001 | كل سجل مالي يحفظ Original Amount + Currency | M | P |
| FX-002 | التحويل لعملة التقارير بسعر Expense Date؛ يحفظ Rate، Date، Source، Policy Version | M | C |
| FX-003 | سعر مفقود: آخر سعر سابق ضمن D-FX-LOOKBACK (Estimated)؛ وإلا يُعرض المبلغ غير محوّل منفصلًا (Partial) | M | C |
| FX-004 | لا تُجمع عملات مختلفة مباشرة؛ Published Reports تحتفظ بمراجع الأسعار | M | C |

---

# 24. Alerts & Notifications (ALR / NTF)

| ID | Requirement | Pri | Rel |
|---|---|---|---|
| ALR-001 | Alert Catalog: Type → Trigger → Severity → Default Owner → Auto-Resolve Condition | M | P |
| ALR-002 | Status: Open → Acknowledged → In Progress → Resolved → Closed؛ Escalated = Flag | M | P |
| ALR-003 | لا تنبيه مكرر لنفس السبب المفتوح (Dedup Key = Type + Entity + Cause) | M | P |
| ALR-004 | Auto-Resolved عند زوال السبب مع Audit | M | P |
| ALR-005 | Primary Owner + Escalation Owner؛ غياب المالك → Fallback إلى Escalation ثم Company Admin | M | P |
| ALR-006 | SLA: Acknowledgement + Resolution + Reminders + One-Level Escalation حسب Calendar/Business Hours وSeverity | M | C |
| ALR-007 | Critical Safety Alerts بـCalendar Time (24×7)؛ التصعيد لا يزيل Restriction | M | C |
| NTF-001 | Channels: In-App (P)، Push (P)، Email (P)؛ بلغة المستخدم | M | P |
| NTF-002 | User Preferences (قنوات، Quiet Hours)؛ Critical لا تُكتم | S | C |
| NTF-003 | Delivery Status يسجَّل؛ الإرسال ≠ القراءة | M | P |

**Pilot Alert Types:** Document Expiring/Expired · Maintenance Upcoming/Overdue · Odometer Conflict · Fuel Anomaly/Duplicate · Fuel Budget · Defect Reported · Restriction Raised · Sync Conflict.
**Commercial:** Card Balance/Limit · Unmatched Provider Txn · Session Not Closed · Missing Session · Pending Trip/Leave Approval · Lease Expiry.

---

# 25. Offline & Sync (OFF)

**Confirmed:** Last Verified Eligibility.

| ID | Requirement | Pri | Rel |
|---|---|---|---|
| OFF-001 | وظائف Offline للسائق: Fuel Entry، Odometer، Defect Report، Photo (P)؛ Session، Trip، Handover، Inspection (C). Approvals تتطلب اتصالًا | M | P / C |
| OFF-002 | Offline Authorization صالح D-OFF-WINDOW منذ آخر تحقق (≤ D-OFF-MAX)، ويتحقق من: User، Tenant، Assignment، Vehicle، Eligibility، Credential | M | P |
| OFF-003 | بعد انتهاء الصلاحية: منع بدء عمليات جديدة، مع السماح بإغلاق القائم وإرسال المعلّق | M | P |
| OFF-004 | كل حدث: Event ID فريد (UUID)، Device ID، Device Sequence، Device Time، Clock Offset عند آخر اتصال | M | P |
| OFF-005 | Sync **Idempotent** بالـEvent ID؛ Retry آلي بـBackoff؛ إعادة الإرسال لا تنشئ سجلًا ثانيًا | M | P |
| OFF-006 | انحراف الساعة > D-OFF-CLOCK أو Device Time في المستقبل → Flag للمراجعة | M | P |
| OFF-007 | المعالجة حسب Device Sequence ثم Event Time؛ حدث يعتمد على آخر لم يصل → Pending Dependency | M | P |
| OFF-008 | النصوص تُرسل قبل الصور؛ الصور تُضغط (D-FILE-PHOTO) وتُستكمل لاحقًا | M | P |
| OFF-009 | Conflict Types: Duplicate، Overlapping Session، Odometer Conflict، Assignment Expired، Eligibility Changed، Card Inactive | M | P |
| OFF-010 | التعارض يُعرض على Fleet Manager/Admin؛ **لا Last-Write-Wins صامت**؛ الأصل محفوظ والقرار موثق ويطلق Recalculation | M | P |
| OFF-011 | Offline Cache مشفّر؛ يُمسح عند تعطيل الحساب أو Logout؛ تحذير قبل Logout مع وجود Pending | M | P |
| OFF-012 | واجهة: Online/Offline Indicator، Pending Count، حالة كل حدث (Pending/Sent/Failed/Conflict) | M | P |
| OFF-013 | Offline Read Set: المركبة المخصصة، آخر عداد، المستندات المسموحة، الصيانة المستحقة | S | P |

---

# 26. Data Quality, Corrections, KPIs & Reports

| ID | Requirement | Pri | Rel |
|---|---|---|---|
| KPI-001 | Data Quality: **Reliable** (كل المدخلات Valid) · **Estimated** (قيمة مشتقة/إدارية) · **Partial** (تغطية ناقصة فوق الحد) · **Unavailable** | M | P |
| KPI-002 | Calculation Status منفصل عن Data Coverage % | S | C |
| AUD-001 | Correction: Record، Previous، New، Reason، By، At، Approval، Affected Periods | M | P |
| AUD-002 | Corrections على سجل مالي أو عداد Valid → Maker/Checker | M | P |
| AUD-003 | Historical Recalculation كـBackground Job مع مؤشر "Recalculating" | M | P |
| AUD-004 | Published Report Snapshots لا تتغير؛ النسخة المصححة إصدار جديد مع سبب الاختلاف | S | C |

## 26.1 KPI Dictionary

| KPI | Formula | Rel |
|---|---|---|
| Fuel Consumption (L/100km) | FUEL-011 على Valid Cycles | P |
| Fuel Cost/km | Fuel Cost ÷ Valid Distance | P |
| Recorded Cost/km | Recorded Operating Cost ÷ Valid Distance | P |
| Allocated Cost/km | Allocated Operating Cost ÷ Valid Distance | C |
| Maintenance Compliance % | بنود نُفذت قبل Overdue ÷ بنود استحقت في الفترة | P |
| Maintenance Overdue | عدد البنود Overdue الآن | P |
| Document Compliance % | مستندات إلزامية Valid+Verified ÷ إجمالي الإلزامية | P |
| Vehicle Availability % | (Scheduled Hours − Downtime) ÷ Scheduled Hours | P |
| Vehicle Utilization % | Driven Days ÷ Available Days | C |
| Used Days / Driven Days | SES-005 | C |
| Fuel Budget Variance | Actual − Budget (و%) | P |
| Card Matching Coverage | Matched ÷ Eligible Card Transactions | C |
| Trip Coverage % | TRP-006 | C |
| Alert SLA Compliance | Alerts within SLA ÷ Applicable Alerts | C |
| Data Coverage % | فترات/سجلات ببيانات Valid ÷ نطاق القياس | P |
| Sync Success Rate | Events accepted ÷ Events submitted | P |

**قواعد عامة:** الفترة بتوقيت الفرع · Valid Distance من قراءات Valid فقط · المقام = 0 أو غير موثوق → Unavailable.

## 26.2 Dashboards

- **Executive (P):** Total/Active/Restricted/Available Vehicles، Operating/Fuel/Maintenance Cost، Cost/km، Open Alerts، Overdue Maintenance، Data Coverage.
- **Fleet Manager (P):** Vehicles by Branch، Assignments، Documents Expiring، Pending Verifications، Maintenance Due، Open Work Orders، Fuel Spend vs Budget، Sync Conflicts.
- **Driver Home (P):** المركبة الحالية، حالة الأهلية، المستندات، Pending Sync، آخر العمليات.
- **Finance (C):** Cards، Reconciliation، Allocated Costs، Period Status.

## 26.3 Vehicle 360 (VEH-008)
Master · Custody/Assignment History · Odometer Timeline · Fuel & Efficiency · Maintenance & Work Orders · Documents · Costs · Alerts · (C) Sessions، Trips، Accidents/Fines.

## 26.4 Standard Reports

| ID | Report | Rel |
|---|---|---|
| RPT-001 | Fuel Entries & Consumption | P |
| RPT-002 | Maintenance History & Due | P |
| RPT-003 | Document Expiry | P |
| RPT-004 | Cost by Vehicle / Branch / Category | P |
| RPT-005 | Odometer Exceptions | P |
| RPT-006 | Assignment & Custody History | P |
| RPT-007 | Audit Log | P |
| RPT-008 | Fuel Card Statement & Reconciliation | C |
| RPT-009 | Allocated Cost & Cost/km | C |
| RPT-010 | Export: Excel/CSV (P)، PDF وScheduled Email (C)؛ Filters: Period، Branch، Vehicle Type؛ Drill-down للسجل المصدر | M |

---

# 27. Import & Onboarding (IMP)

| ID | Requirement | Pri | Rel |
|---|---|---|---|
| IMP-001 | Sources: Excel، CSV؛ Template رسمي لكل كيان | M | P |
| IMP-002 | Workflow: Upload → Mapping → Preview → Validation → Error Review → Approval → Import → Audit | M | P |
| IMP-003 | Default: All-or-Nothing للسجلات المالية، Partial مسموح للـMaster Data | M | P |
| IMP-004 | Opening Balances: Odometer، Assignment، Maintenance Baseline، Documents، Card Balance — منفصلة عن Historical Transactions | M | P |
| IMP-005 | Backdated Import: كشف التكرار، حفظ Event Date، Import Batch ID، Recalculation | M | P |
| IMP-006 | Batch Rollback قبل استخدام سجلاته في عمليات لاحقة | S | P |

---

# 28. Conceptual Data Model

**Platform:** Tenant · Tenant Region · Country Template · Country Policy Version · Platform Identity · Subscription/Plan · Platform Audit · Break-Glass Grant.

**Tenant:** Company · Branch · Cost Center · User Membership · Role · Permission · Device · Vendor · Vehicle · Lease Contract · Disposal Record · Driver · Assignment · Handover · Meter Reading · Meter Replacement · Fuel Entry · Fuel Budget · Fuel Card · Card Transaction · Reconciliation Item · Maintenance Template · Maintenance Item · Defect Report · Work Order · Maintenance Visit · Document Type · Document Record · Readiness Rule · Readiness Override · Driver Session · Trip · Leave Request · Accident · Fine · Inspection · Cost Record · Cost Allocation · FX Rate · Period Close · Alert · SLA Policy · Notification Event · Offline Event · Conflict Review · Correction · Import Batch · Audit Event · Report Snapshot.

**Key Cardinalities:** Vehicle 1—N Assignment، Meter Reading، Fuel Entry، Work Order، Document، Cost · Driver 1—N Assignment، Fuel Entry · Work Order 1—N Visit · Defect 0..1—1 Work Order · Fuel Entry 0..1—0..1 Card Transaction (Reconciliation) · Fuel Entry / Visit / Fine 1—1 Cost Record · Cost Record 1—N Allocation.

**Principles:** Immutable IDs · Historical relationships · Effective-dating · Source references · Referential Integrity · Tenant separation. (Conceptual — ليس Physical Schema.)

---

# 29. Non-Functional Requirements

| ID | Requirement | Pri | Rel |
|---|---|---|---|
| NFR-001 | Security وفق OWASP ASVS L2 وMASVS؛ TLS 1.2+؛ AES-256 at rest؛ Secrets Management | M | P |
| NFR-002 | Availability 99.5% شهريًا (خارج الصيانة المجدولة) | M | P |
| NFR-003 | Performance: p95 قراءة < 500ms، كتابة < 1s، Dashboard < 3s، Sync 100 حدث نصي < 30s — تُراجع بعد OD-02 | M | P |
| NFR-004 | Backup & Recovery حسب D-BKP؛ اتساق Database/Files | M | P |
| NFR-005 | Platforms: Android 8.0+، iOS 15+؛ آخر نسختين من Chrome/Edge/Safari/Firefox | M | P |
| NFR-006 | Usability: مهام السائق الأساسية ≤ 5 خطوات؛ Camera Input؛ رسائل خطأ واضحة؛ RTL كامل | M | P |
| NFR-007 | Accessibility WCAG 2.1 AA للـWeb | S | C |
| NFR-008 | Observability: App، DB، Sync/Notification/Import Failures، Backup Status، Security Events، لكل Tenant | M | P |
| NFR-009 | Scalability أفقية للـTenants والمركبات والتخزين بدون افتراض Multi-Region | M | P |
| NFR-010 | Audit Log Append-only بـRetention = D-RET-AUDIT | M | P |

# 30. Privacy & Retention

| ID | Requirement | Pri | Rel |
|---|---|---|---|
| PRV-001 | كل Data Category لها Retention Policy (D-RET-*) حتى اعتماد OD-07 | M | P |
| PRV-002 | Consent داخل التطبيق لجمع الموقع والصور، مع سجل الموافقة | M | P |
| PRV-003 | Driver Data Export + Anonymization بعد انتهاء الـRetention مع بقاء السجلات المالية | S | C |
| PRV-004 | مراجعة Data Residency عند تفعيل دولة: Hosting، Backup، Processing، Cross-border، Sub-processors | M | C |
| PRV-005 | Data Minimization: GPS عند بداية/نهاية الرحلة فقط | M | C |

---

# 31. Pilot Operating Model & Acceptance

**Strategy:** First Real Customer + Pilot · **Cutover:** Parallel Run (2–4 أسابيع) ثم Cutover؛ النظام القديم System of Record أثناء التشغيل المزدوج.
**Stages:** Preparation → Controlled Live Operation → Reconciliation → Acceptance.
**Scope:** Pilot MVP (Rel = P)، فرع إلى فرعين (يُؤكد بعد OD-02).

## 31.1 Pilot Thresholds

| KPI | Threshold |
|---|---|
| Import Accuracy | ≥ 99% من السجلات بدون خطأ بعد المراجعة |
| Driver Adoption | ≥ 80% من التفويلات مسجلة عبر التطبيق |
| Offline Sync Success | ≥ 99.5%، صفر فقد لحدث مؤكد |
| Duplicate Financial Records | 0 |
| Financial Reconciliation to Source | ≥ 99% من القيمة |
| Data Coverage | ≥ 90% |
| Permission / Tenant Isolation Tests | 100% Pass |
| Restore Test | Pass ضمن RPO/RTO |
| Open Defects | Sev1 = 0، Sev2 = 0 |

## 31.2 Severity

| Sev | Definition | Response / Resolve |
|---|---|---|
| Sev1 | وصول غير مصرح، فقد بيانات، تكرار مالي، تجاوز Restriction R4، توقف الخدمة | 1h / 4h (24×7) |
| Sev2 | وظيفة أساسية معطلة بدون بديل، حساب خاطئ | 4h / 1 يوم عمل |
| Sev3 | خلل له بديل | 1 / 5 أيام عمل |
| Sev4 | تجميلي | الإصدار التالي |

## 31.3 Gates

- **G1 Data Readiness:** Master Data مكتمل، لا تكرارات مؤثرة، Opening Odometer موثوق أو معلَّم، Assignments صحيحة، المستندات مصنفة.
- **G2 Operational:** سيناريوهات Fuel، Maintenance/Work Order، Odometer، Documents، Alerts تمر بالـAcceptance Tests.
- **G3 Security & Integrity:** Tenant Isolation، RBAC، Pen Test، لا فقد/تكرار بعد Retry، Corrections موثقة، Restrictions تعمل.
- **G4 Financial & Analytical:** Worked Examples (Gap Analysis ملحق E) تمر؛ لا Double Counting؛ Data Quality ظاهر؛ Recalculation صحيح.
- **G5 Business:** Customer Sign-off، Training، Support جاهز، Restore مُختبر، **Pilot Scope Verified**.
- **Commercial Release Gate (منفصل):** نفس G2–G4 على متطلبات Rel = C.

**No-Go:** أي Sev1/Sev2 مفتوح في: Unauthorized Access · Data Loss · Duplicate Financial · R4 Bypass · Calculation Integrity · Recovery Failure · Compliance.
**Exit Plan:** عند No-Go: استمرار النظام القديم + Export كامل لبيانات العميل + خطة معالجة.

---

# 32. Risks

| Risk | Mitigation |
|---|---|
| Poor Master Data | Import Validation + Opening Balance |
| Driver Resistance | UX ≤ 5 خطوات + Training |
| Offline Conflicts / Clock Errors | Unique Events + Sequence + Clock Offset + Review |
| Wrong Odometer | Unified Timeline + Validation + Corroboration |
| Financial Double Counting | Expense Identity + Idempotent Imports |
| Data Manipulation / Fraud | Anomaly Flags + Receipt Photos + Maker/Checker |
| Poor Receipt Photo Quality | ضغط ذكي + إعادة التقاط |
| Database-per-Tenant Overhead | Automated Provisioning + Managed Migrations |
| Third-party Dependency (Push/SMS/Email) | Fallback Channel + Delivery Status |
| First-Customer Lock-in | كل تخصيص = Configuration لا Code |
| Regional Data Restrictions | Country Activation Gate |
| Full Scope Complexity | Pilot MVP ثم Commercial Wave |

# 33. Release Plan

| Phase | Content |
|---|---|
| A — Design | PRD Sign-off، Architecture، Data Dictionary، Test Strategy |
| B — Foundation | TEN، SEC/ADM، CTR، VND، VEH، DRV، DOC، AUD، NFR base |
| C — Core Operations | ASN، ODO، FUEL، MNT/WO، OPS، OFF، FIN (Recorded) |
| D — Control & Insight | ALR/NTF، IMP، KPI/RPT (Pilot)، Dashboards |
| E — **Pilot** | Preparation → Parallel Run → Reconciliation → G1–G5 |
| F — Commercial Wave | CARD، SES، TRP، LEV، FIN (Allocated/Close)، FX، INC، INS، SLA، Subscriptions، FR |
| G — Commercial Gate | UAT، Security/Recovery، Go/No-Go |

ترتيب تخطيطي وليس جدولًا زمنيًا.

# 34. Open Decisions

| ID | Decision | Status |
|---|---|---|
| OD-01 | First Operating Country | **Open** — Business |
| OD-02 | First Customer Fleet Profile | **Open** — Business |
| OD-05 | Country Legal Eligibility Rules | **Open** — بعد OD-01 |
| OD-06 | Data Hosting Region | **Open** — بعد OD-01 |
| OD-07 | Legal Retention Periods | **Open** — Default مؤقت 7 سنوات |
| OD-14 | Commercial Pricing & Packaging | **Open** — Business |
| OD-16 | Tenant Migration Procedure | Future |
| OD-03, 04, 08–13, 15, 17–28 | — | **Decided** (Gap Analysis §6) |

# 35. Glossary

| Term | Meaning |
|---|---|
| Tenant | شركة عميلة بقاعدة بيانات مستقلة |
| Event Time / Recorded Time | وقت الواقعة / وقت استلام السيرفر |
| Assignment | تفويض إداري لسائق على مركبة لفترة |
| Handover | نقل عهدة فعلي مؤقت بين سائقين مخوّلين |
| Custody Timeline | سجل من كان مسؤولًا عن المركبة في كل لحظة |
| Full-to-Full | حساب الاستهلاك بين تفويلتين Full |
| Valid Distance | مسافة محسوبة من قراءات Valid فقط |
| Recorded / Allocated Cost | التكلفة بتاريخ المصروف / موزعة على فترة الاستفادة |
| Expense Identity | معرّف وحيد يمنع احتساب المصروف مرتين |
| Defect Report / Work Order | بلاغ عطل / أمر شغل صيانة |
| Readiness | قرار السماح بالتشغيل: Allowed / Warning / Restricted |
| Break-Glass | وصول دعم مؤقت بموافقة العميل |
| Maker/Checker | فصل من ينشئ السجل عمّن يعتمده |
| Data Quality Status | Reliable / Estimated / Partial / Unavailable |

# 36. Approval Status

| Area | Status |
|---|---|
| Business Vision، Deployment Strategy، Tenant Model، Country Config Strategy | Confirmed |
| Functional Scope + Pilot MVP، RBAC Baseline، Standards & Defaults، Pilot Thresholds | Decided under delegation — Pending formal Sign-off |
| Country/Legal، Hosting Region، Fleet Profile، Pricing | Open |
| Final PRD Sign-off | Not Approved |
