# PRD Gap Analysis & Requirements Validation
## Fleet Management SaaS — مراجعة PRD v0.1 بندًا بندًا

**Reviewed Document:** `PRD_v0.1.md` (Discovery Draft, 11 Nov 2026)
**Review Version:** 1.0 — Draft for Approval
**Purpose:** تحديد التعارضات والـMissing Business Rules والمتطلبات الناقصة والغموض، والحصول على قرار لكل بند، قبل إصدار PRD v0.2 وتحويله إلى Epics وUser Stories وAcceptance Criteria.

---

## 0. طريقة الاستخدام

كل Finding له:

| Field | Meaning |
|---|---|
| **ID** | `GAP-<Section>-<No>` مثال `GAP-10-03` |
| **Type** | `CONFLICT` تعارض داخلي · `RULE` قاعدة عمل ناقصة · `REQ` متطلب/حقل ناقص · `AMBIG` صياغة غامضة أو غير قابلة للاختبار · `SCOPE` نطاق غير محدد |
| **Severity** | `Critical` يمنع التطوير أو يهدد سلامة البيانات/المال · `High` يسبب إعادة عمل · `Medium` · `Low` |
| **Proposal** | التعديل المقترح (Proposed — غير معتمد) |
| **Decision** | يملؤها صاحب المنتج: ✅ Approve · ✏️ Modify · ❌ Reject · ⏸ Defer |

**القاعدة:** لا ينتقل أي بند إلى PRD v0.2 كـConfirmed إلا بعد Decision = Approve/Modify.

### Definition of Ready (مقترح) — متى يصبح المتطلب جاهزًا للتحويل لـUser Story
1. له Requirement ID وأولوية (MoSCoW) ونطاق (Pilot / Commercial).
2. الـRole والـScope المسموح محددان في RBAC Matrix.
3. الحالات والانتقالات معرّفة (لو الكيان له Lifecycle).
4. قواعد التحقق لها قيم أو مرجع لإعداد (Configurable + Default).
5. سلوك الـOffline محدد (مسموح / غير مسموح / Read-only).
6. سلوك الخطأ والحالات الحدّية مكتوب.
7. Acceptance Criteria قابلة للقياس بدون كلمات مثل "مناسب"، "موثوق"، "منطقي" بدون تعريف.

---

## 1. ملخص تنفيذي للمراجعة

**التقييم العام:** الـPRD قوي جدًا في مبادئ سلامة البيانات (Event vs Recorded Time، No Double Counting، Missing ≠ Zero، No Silent Overwrites، Data Quality Status). نقطة الضعف الأساسية إن كثير من المتطلبات **مبادئ وليست قواعد قابلة للتنفيذ والاختبار** — كلمات زي "منطقي"، "موثوق"، "وفق السياسة" بدون تعريف السياسة أو قيمها الافتراضية.

### أهم 10 Findings (Critical)

| # | ID | Finding |
|---|---|---|
| 1 | GAP-02-01 | لا يوجد Pilot Scope — كل الموديولات "Full Commercial"، ومعيار G5 يطلب "Full Commercial Scope Verified" في الـPilot |
| 2 | GAP-03-03 | RBAC Matrix غير موجودة (OD-17) — يمنع بدء التطوير |
| 3 | GAP-06-01 | تعارض: "Temporarily Unavailable" داخل Lifecycle رغم طلب فصل Lifecycle عن Readiness |
| 4 | GAP-09-02 | لا توجد قاعدة لتحديد "القراءة المستحيلة" (حد أقصى للمسافة/اليوم، سرعة ضمنية) |
| 5 | GAP-10-02 | لا يوجد Tank Capacity → لا يمكن التحقق من لترات أكبر من سعة الخزان |
| 6 | GAP-21-01 | توقيت الجهاز Offline غير موثوق (Clock Tampering) ولا توجد قاعدة لترتيب الأحداث |
| 7 | GAP-11-04 | لا توجد Matching Tolerances للمطابقة مع كشف المزود |
| 8 | GAP-12-02 | بلاغ السائق (Maintenance Report) غير مربوط بأي Workflow للصيانة التصحيحية |
| 9 | GAP-18-02 | لا يوجد تعريف لمعاملة الضرائب (VAT Gross/Net) في التكاليف |
| 10 | GAP-X-01 | علاقة Session ↔ Trip ↔ Assignment ↔ Handover غير معرّفة عند تفعيلها معًا |

### إحصائية

| Type | Count |
|---|---|
| CONFLICT | 9 |
| RULE | 58 |
| REQ | 63 |
| AMBIG | 14 |
| SCOPE | 6 |
| **Total** | **150** (منها 12 Critical) |

---

## 2. المراجعة بندًا بندًا

### §1 Executive Summary

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-01-01 | AMBIG | High | Success Criteria (§1.4) غير قابلة للقياس، ولا يوجد ربط بين Objectives (§1.3) والـKPIs | ربط كل Objective بـKPI وBaseline مستهدف يُملأ في OD-11 (جدول Objective → KPI → Measurement → Target TBD) | ✅ Approve |
| GAP-01-02 | REQ | Medium | لا يوجد Personas/Fleet Profile (حجم الأسطول، نوع النشاط: نقل، توزيع، سيارات إدارية، معدات) | إضافة Target Customer Profile + ربطها بـOD-02 | ✅ Approve |
| GAP-01-03 | REQ | Low | لا يوجد Version History ولا Glossary | إضافة الاتنين في v0.2 | ✅ Approve |

### §2 Product Scope

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-02-01 | SCOPE | **Critical** | لا يوجد فصل بين Pilot Scope وCommercial Scope؛ و§29 G5 يطلب "Full Commercial Scope Verified" خلال Pilot = تأخير كبير | تعريف **Pilot MVP**: Admin, Vehicles, Drivers, Assignments, Odometer, Fuel, Maintenance (+Work Orders), Documents, Vendors, Alerts (أساسي), Offline, Import, Audit, Basic Dashboards. و**Commercial Wave**: Fuel Cards Reconciliation, Sessions, Trips, Leave, Cost Allocation, Multi-Currency, Accidents & Fines, Advanced KPIs | ✅ Approve |
| GAP-02-02 | SCOPE | High | موديولات مُشار لها بدون تعريف: Vendors/Workshops، Fuel Providers، Accidents، Fines، Lease Contracts | إضافة: **Vendors Master** (Must/Pilot)، **Work Orders** (Must/Pilot)، **Accidents & Fines** (Should/Commercial)، **Inspection Checklist** (Could/Optional)، **Lease/Rental Contracts** ضمن Vehicles (Should) | ✅ Approve |
| GAP-02-03 | SCOPE | Medium | Optional Modules غير محددة بالاسم ولا Dependencies بينها (مثلاً Trips تعتمد على Sessions؟) | جدول Module Activation: Mandatory / Optional + Dependencies + أثر التعطيل على الـKPIs | ✅ Approve |
| GAP-02-04 | SCOPE | Medium | Reports القياسية وExport Formats وAPI/Webhooks غير مذكورة في In/Out Scope | In Scope: Standard Reports + Excel/CSV/PDF Export. Out of Scope (Initial): Public API, Webhooks, ERP Connectors — مع Export ملفّي للمحاسبة | ✅ Approve |

### §3 Users & Roles / RBAC

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-03-01 | REQ | High | أدوار ناقصة شائعة: Finance/Accountant (مراجعة التكاليف والمطابقة)، Viewer/Auditor (قراءة فقط)، Branch Supervisor، Workshop Coordinator | إضافة على الأقل **Finance Reviewer** و**Read-only Viewer** كـPredefined Roles؛ مع Custom Roles (Commercial) | ✅ Approve |
| GAP-03-02 | RULE | High | Platform Admin "دعم محدود ومصرح" بدون آلية | **Break-Glass Access:** طلب دعم → موافقة Company Admin → وصول مؤقت (مدة افتراضية مقترحة 24h) → Read-only افتراضيًا → Audit كامل يظهر للعميل | ✅ Approve |
| GAP-03-03 | REQ | **Critical** | RBAC Matrix غير موجودة (OD-17) | إعداد مسودة Matrix (ملحق A أدناه) للاعتماد | ✅ Approve |
| GAP-03-04 | RULE | High | Segregation of Duties غير معرّف: هل يجوز للسائق اللي سجّل التفويلة أن يعتمدها لو عنده دور Fleet Manager؟ | قاعدة: **لا يجوز لنفس المستخدم إنشاء واعتماد/تحقق نفس السجل** (Maker ≠ Checker) | ✅ Approve |
| GAP-03-05 | AMBIG | Medium | Role Switcher: هل الأدوار المتعددة تعمل في جلسة واحدة أم بالتبديل؟ وما أثر الدور النشط على الـOffline Cache؟ | دور نشط واحد في كل لحظة؛ الـOffline Cache مرتبط بدور Driver فقط في الإصدار الأول | ✅ Approve |
| GAP-03-06 | REQ | High | طريقة دخول السائق غير محددة (Email/Password؟ Phone OTP؟ Employee ID + PIN؟) والأجهزة المشتركة | Proposed: Phone + OTP أو Username + PIN، مع دعم **Shared Device Mode** (Commercial) — يحتاج قرار OD-19 | ✏️ Modify: Phone+OTP ثم PIN/Biometric؛ Shared Device = Commercial |
| GAP-03-07 | REQ | High | MFA غير مذكور | MFA إلزامي لـPlatform Admin وCompany Admin؛ اختياري للباقي | ✅ Approve |
| GAP-03-08 | AMBIG | Medium | هل المستخدم ممكن ينتمي لأكثر من Tenant؟ (§25.1 يذكر Platform User Identity) | Proposed: هوية واحدة على مستوى المنصة + Membership لكل Tenant، مع Tenant Switcher — يحتاج قرار | ✅ Approve |

### §4 SaaS Architecture

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-04-01 | RULE | High | Tenant Provisioning: الخطوات والمدة وما يُنشأ افتراضيًا (Roles, Templates) غير محددة | Provisioning Checklist آلي: DB + Storage Bucket + Default Roles + Country Template + Admin Invite + Audit | ✅ Approve |
| GAP-04-02 | RULE | Medium | Schema Migration عبر قواعد بيانات متعددة (Database per Tenant) غير مذكورة | متطلب: ترقية Schema لكل Tenant بشكل مُدار مع Rollback وتقرير حالة لكل Tenant | ✅ Approve |
| GAP-04-03 | REQ | Medium | Tenant Suspension (عدم دفع / طلب العميل) غير معرّف | حالات Tenant: Provisioning → Active → Suspended (Read-only) → Terminated | ✅ Approve |
| GAP-04-04 | REQ | Medium | Subscription/Plan Limits (عدد مركبات/مستخدمين/تخزين) غير معرّفة | ربط بـOD-14 + متطلب Enforcement للحدود مع تحذير قبل الوصول | ✅ Approve |

### §5 Country Configuration

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-05-01 | REQ | High | ناقص في Country Layer: **Distance Unit (km/mi)**، **Volume Unit (L/gal)**، **Tax/VAT Rules**، Week Start، Public Holidays | إضافتها؛ والحسابات الداخلية بوحدة موحدة مع تحويل للعرض | ✅ Approve |
| GAP-05-02 | RULE | High | Precedence غير معرّف عند التعارض بين Platform/Country/Company | قاعدة: Platform Guardrails > Country Mandatory > Company Config؛ الشركة تستطيع **التشديد فقط** لا التخفيف في القواعد الإلزامية | ✅ Approve |
| GAP-05-03 | RULE | Medium | Effective-dating للإعدادات مذكور في §25 فقط | كل تغيير Policy له Effective From، ولا يُطبق بأثر رجعي إلا بقرار صريح + Recalculation | ✅ Approve |
| GAP-05-04 | AMBIG | Low | Country Activation Statuses بدون مَن يعتمد كل مرحلة | ربط بـOD-15 + جدول Transitions (ملحق B) | ✅ Approve |
| GAP-05-05 | REQ | Low | Hijri Calendar / تنسيق التاريخ المزدوج قد يكون مطلوبًا حسب الدولة | Configurable في Country Layer (Could) | ⏸ Defer (بعد OD-01) |

### §6 Vehicle Management

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-06-01 | CONFLICT | **Critical** | Lifecycle يتضمن "Temporarily Unavailable" بينما §6.2 نفسه يطلب فصل Lifecycle عن Readiness | **Lifecycle:** Draft → Active → Inactive → Disposed (Sold/Scrapped/Returned). **Availability (منفصل):** Available / In Use / Under Maintenance / Restricted / Out of Service | ✅ Approve |
| GAP-06-02 | REQ | High | حقول ناقصة: **Tank Capacity**, VIN/Chassis, Engine No., Color, Odometer Unit, **Meter Type (Odometer/Hours)**, Seating/Payload, License Category Required, Cost Center | إضافتها؛ Tank Capacity وRequired License Category إلزاميان للتحقق | ✅ Approve |
| GAP-06-03 | REQ | Medium | Ownership Type بدون عقد: Owned / Leased / Rented — لا يوجد Lease Contract (Vendor, Start/End, Monthly Cost, KM Allowance) | إضافة Lease/Rental Contract + Alert قبل انتهاء العقد وتجاوز KM Allowance | ✅ Approve |
| GAP-06-04 | RULE | Medium | Disposal: لا يوجد تسجيل Sale Value / Disposal Date / Final Odometer، ولا منع العمليات بعد الـDisposal | إضافة Disposal Record؛ منع أي عملية تشغيلية بتاريخ واقعة بعد Disposal Date | ✅ Approve |
| GAP-06-05 | RULE | Medium | Branch Transfer: من يعتمد؟ وماذا عن الـAssignments والكروت المفتوحة وقت النقل؟ | النقل يتطلب Fleet Manager للفرعين أو Company Admin؛ يُنهي الـAssignment إن كان السائق خارج الفرع الجديد؛ ينبّه للكروت المرتبطة | ✅ Approve |
| GAP-06-06 | RULE | Medium | Uniqueness: Registration Number / Fleet Number / VIN | فريدة داخل الـTenant للمركبات غير Disposed؛ إعادة استخدام رقم اللوحة مسموحة بعد Disposal مع ربط تاريخي | ✅ Approve |

### §7 Driver Management

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-07-01 | REQ | Medium | Driver Status/Lifecycle غير معرّف (Active / Suspended / Terminated) وفصله عن Account Status | إضافة Driver Employment Status منفصل عن User Account Status | ✅ Approve |
| GAP-07-02 | RULE | High | Eligibility: متى تُعاد تقييمها؟ (يوميًا؟ عند كل Start؟ عند تغيير مستند؟) | إعادة تقييم: عند تغيير أي مدخل + Job يومي + عند Start Session/Fuel Entry Online | ✅ Approve |
| GAP-07-03 | REQ | Medium | Grace Period لانتهاء الرخصة غير مذكور | Configurable per Country (Default 0 يوم) | ✅ Approve |
| GAP-07-04 | REQ | Low | ربط Driver بأكثر من فرع أو سائق "Pool" غير محدد | Driver له Home Branch واحد؛ التخصيص خارج الفرع يتطلب صلاحية | ✅ Approve |
| GAP-07-05 | RULE | Medium | Driver Behaviour/Violations (مخالفات، حوادث) غير مرتبطة بالسائق | تُغطى في موديول Accidents & Fines (GAP-02-02) | ✅ Approve |

### §8 Assignment

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-08-01 | RULE | **Critical** | "منع التخصيصات المتعارضة وفق قواعد التشغيل" — القواعد غير مكتوبة | Default: مركبة واحدة ↔ **Primary Driver واحد** في نفس الفترة؛ يُسمح بـSecondary/Substitute Drivers؛ السائق يمكن أن يكون Primary لمركبة واحدة (Configurable) | ✅ Approve |
| GAP-08-02 | AMBIG | High | الفرق بين Substitute Driver وTemporary Handover غير واضح | **Assignment** = تفويض إداري بفترة. **Handover** = نقل عهدة فعلية مؤقت بين سائقَين مخوّلين على نفس المركبة، لا ينشئ Assignment جديد | ✅ Approve |
| GAP-08-03 | RULE | High | هل يحتاج Handover موافقة؟ هل يعمل Offline؟ ماذا لو المستلم غير مؤهل؟ | Handover يتطلب أن يكون المستلم مخوّلًا ومؤهلًا (Last Verified)؛ Offline مسموح مع تأكيد الطرفين؛ Verification لاحق من Fleet Manager | ✅ Approve |
| GAP-08-04 | RULE | Medium | Backdated Assignment وتأثيره على نسب التفويلات السابقة | مسموح بصلاحية + Recalculation للفترات المتأثرة + Audit | ✅ Approve |

### §9 Odometer

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-09-01 | REQ | High | المعدات تعمل بساعات تشغيل (Engine Hours) لا كيلومترات | دعم Meter Type لكل مركبة: Distance أو Hours أو الاتنين؛ الصيانة والاستهلاك يحسبان حسب النوع | ✅ Approve |
| GAP-09-02 | RULE | **Critical** | "قراءة مستحيلة" غير معرّفة | قواعد Configurable: (a) أقل من آخر قراءة موثوقة سابقة زمنيًا → Conflict؛ (b) أعلى من قراءة لاحقة زمنيًا → Conflict؛ (c) مسافة/يوم > Max Daily Distance (Default مقترح 1,500 km) → Warning/Review؛ (d) قفزة > X km عن المتوقع → Review | ✅ Approve |
| GAP-09-03 | RULE | High | حالة القراءة المتعارضة: هل يُحفظ السجل الأصلي (التفويلة) أم يُرفض؟ | **السجل يُقبل ويُحفظ، والقراءة تُعلَّم Conflict** وتُستبعد من الـKPIs حتى المعالجة — لا رفض صامت ولا قبول صامت | ✅ Approve |
| GAP-09-04 | RULE | Medium | Odometer Replacement / Rollover: الإجراء غير موثق | Event من نوع Meter Replacement (Old Final, New Start, Date, Evidence) يبدأ Segment جديد؛ المسافة = مجموع الـSegments | ✅ Approve |
| GAP-09-05 | REQ | Medium | Validation Status values غير معرّفة | Valid / Warning / Conflict / Corrected / Excluded | ✅ Approve |
| GAP-09-06 | RULE | Medium | Current Odometer للمركبة: هل هو آخر قراءة مسجلة أم أعلى قراءة موثوقة؟ | = آخر قراءة Valid حسب Event Time | ✅ Approve |

### §10 Fuel

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-10-01 | AMBIG | High | Fuel Entry تتطلب "Valid Vehicle Assignment" — ماذا لو Fleet Manager سجّل نيابة عن السائق، أو سائق بديل؟ | المستخدم المخوّل يسجل نيابة مع حقل Recorded On Behalf Of؛ السائق غير المخصص → Allowed with Warning + Review | ✅ Approve |
| GAP-10-02 | RULE | **Critical** | Liters > Tank Capacity غير مكتشف | Liters > Tank Capacity × (1 + Tolerance 5%) → Conflict | ✅ Approve |
| GAP-10-03 | RULE | High | Price per Liter غير محسوب ولا مُتحقق منه | Unit Price = Amount ÷ Liters؛ خارج نطاق Reference Price ± X% → Warning | ✅ Approve |
| GAP-10-04 | RULE | High | Duplicate Detection بدون معيار | نفس Vehicle + Amount + Liters خلال نافذة زمنية (Default 30 دقيقة) أو نفس Receipt/Transaction Reference → Possible Duplicate | ✅ Approve |
| GAP-10-05 | RULE | High | Fuel Type mismatch مع المركبة | Fuel Type ≠ Vehicle Fuel Type → Warning (أو Conflict للفئات غير المتوافقة) | ✅ Approve |
| GAP-10-06 | RULE | Medium | Full-to-Full: ماذا لو فيه تفويلة جزئية مفقودة (Missing) داخل الدورة؟ لا يمكن اكتشافها مباشرة | الدورة التي تحتوي Conflict أو Gap معروف → Partial/Unreliable؛ الاستهلاك الشاذ (خارج نطاق النموذج للمركبة ± X%) → Flag | ✅ Approve |
| GAP-10-07 | REQ | High | Fuel Budget غير معرّف (لكل مركبة؟ فرع؟ شهر؟ لترات أم مبلغ؟) | Budget: Entity (Vehicle/Branch/Company) + Period (Monthly) + Unit (Amount و/أو Liters) + Thresholds (80%/100%) | ✅ Approve |
| GAP-10-08 | REQ | Medium | Receipt Photo إلزامية أم اختيارية؟ | Configurable per Company (Default: إلزامية للـCash، اختيارية للكارت) | ✅ Approve |
| GAP-10-09 | RULE | Medium | تعديل/حذف تفويلة بعد الإرسال | السائق يعدّل فقط قبل المراجعة/المزامنة؛ بعدها Correction Request؛ لا Hard Delete — Void مع سبب | ✅ Approve |
| GAP-10-10 | REQ | Low | Fuel Entry Status (Submitted / Under Review / Approved / Voided) غير موجود | إضافة Lifecycle مع Review اختياري حسب الإعداد | ✅ Approve |

### §11 Fuel Cards

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-11-01 | AMBIG | High | Card مرتبط بمركبة أم سائق — "إعداد معتمد" على مستوى الشركة أم الكارت؟ | على مستوى الكارت (كل كارت له Assigned Entity Type)، مع Default من الشركة | ✅ Approve |
| GAP-11-02 | CONFLICT | High | Prepaid: "Refuel Transactions" و"Provider Transactions" قد تمثلان نفس العملية → خطر Double Counting في الرصيد | الرصيد Confirmed = من كشف المزود فقط؛ Estimated = Confirmed − تفويلات التطبيق غير المطابقة بعد آخر كشف | ✅ Approve |
| GAP-11-03 | REQ | Medium | Card Lifecycle (Active / Blocked / Lost / Expired / Cancelled) وما يحدث للتفويلات بعد الإيقاف | إضافة Lifecycle؛ تفويلة على كارت غير Active → Conflict | ✅ Approve |
| GAP-11-04 | RULE | **Critical** | Matching Tolerances غير معرّفة | Match لو: Card Ref متطابق + Amount ± 1% (أو قيمة ثابتة) + Time ± 2h + Liters ± 2%؛ تطابق جزئي → Conflict/Under Review؛ أكثر من مرشح → Under Review | ✅ Approve |
| GAP-11-05 | REQ | High | صيغة كشف المزود وطريقة الاستيراد غير محددة | Import Template لكل Provider + Mapping محفوظ؛ Idempotency بـProvider Transaction Ref | ✅ Approve |
| GAP-11-06 | RULE | High | عملية في كشف المزود بدون تفويلة في التطبيق (Unmatched Provider Txn) — هل تُحتسب Expense؟ | تُسجّل كـFuel Expense بمصدر Provider مع Data Quality = Partial (لا توجد قراءة عداد) + Alert للسائق/المدير | ✅ Approve |
| GAP-11-07 | REQ | Low | PIN/أمان الكارت خارج النطاق — يجب التصريح بذلك | إضافة لـOut of Scope: تخزين PIN أو بيانات الكارت الحساسة | ✅ Approve |

### §12 Maintenance

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-12-01 | RULE | High | Combined Rule: "أيهما أسبق" غير مكتوب | Combined = Due عند الوصول لأي من الحدّين أولًا (Whichever Comes First) | ✅ Approve |
| GAP-12-02 | REQ | **Critical** | بلاغ السائق (Maintenance Report) غير مربوط بالصيانة | **Defect Report → Work Order → Maintenance Visit**: Defect (Severity, Photo, Vehicle Drivable?) → Fleet Manager يحوّله لـWork Order أو يرفضه → Visit يقفل الـWork Order | ✅ Approve |
| GAP-12-03 | RULE | High | Upcoming threshold غير معرّف | Upcoming قبل X km أو Y يوم (Configurable، Default 500 km / 14 يوم) | ✅ Approve |
| GAP-12-04 | RULE | High | هل المركبة تحت الصيانة تصبح Unavailable تلقائيًا؟ هل Overdue يسبب Restriction؟ | Work Order مفتوح مع "Vehicle Not Drivable" → Availability = Under Maintenance؛ Overdue بنود محددة (مثلاً الفرامل) يمكن ربطها بـRisk R3/R4 | ✅ Approve |
| GAP-12-05 | REQ | Medium | Downtime غير محسوب | Downtime = من Vehicle Off-Road حتى Return to Service؛ يدخل في Availability KPI | ✅ Approve |
| GAP-12-06 | REQ | Medium | Warranty / Parts / Labor غير موجود | Cost Breakdown بنوع (Parts / Labor / Other) اختياري؛ Warranty Flag (Could) | ✅ Approve |
| GAP-12-07 | RULE | Medium | بعد تنفيذ بند صيانة، الـBaseline الجديد = قراءة العداد في الزيارة — ماذا لو القراءة Conflict؟ | Baseline يُعلَّم Unverified ويظهر Forecast كـEstimated | ✅ Approve |
| GAP-12-08 | REQ | Low | Tires كبند مذكور بدون تتبع (موضع، عمق، تغيير) | خارج النطاق الأول؛ Tires كبند صيانة عادي فقط | ✅ Approve |

### §13 Documents

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-13-01 | RULE | High | Alert lead time قبل الانتهاء غير معرّف | Configurable per Document Type (Default 30/14/7 أيام) | ✅ Approve |
| GAP-13-02 | RULE | High | هل مستند Pending Verification يُعتبر ساريًا للأهلية؟ | Configurable per Type: Verified فقط / أو Pending يعطي Allowed with Warning | ✅ Approve |
| GAP-13-03 | CONFLICT | Medium | "Expired" حالة في Lifecycle لكنها مشتقة من التاريخ، و"Rejected" قد يكون منتهيًا أيضًا | فصل **Verification Status** (Draft/Pending/Verified/Rejected/Superseded) عن **Validity** المحسوبة (Valid/Expiring/Expired/No Expiry) | ✅ Approve |
| GAP-13-04 | REQ | Medium | قيود الملفات (أنواع، حجم، عدد الصفحات) | PDF/JPG/PNG؛ حد افتراضي 10MB؛ ضغط الصور من الموبايل | ✅ Approve |
| GAP-13-05 | REQ | Medium | مستندات بدون تاريخ انتهاء | No Expiry flag لكل Type | ✅ Approve |
| GAP-13-06 | RULE | Low | Watermark/تتبع التحميل للمستندات الحساسة | Audit لكل Download (Must)؛ Watermark (Could) | ✅ Approve |

### §14 Operational Readiness

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-14-01 | RULE | High | "نقص البيانات لا يساوي Restriction" يتعارض مع حالة R4 لو المستند الإلزامي قانونيًا غير موجود أصلًا | الصياغة: نقص البيانات ≠ مخالفة مثبتة، **لكن** القاعدة R4 قد تُعرّف "غياب الدليل" نفسه كسبب Restriction (Configurable per Rule) | ✅ Approve |
| GAP-14-02 | REQ | High | لا يوجد Rule Catalog: الشرط → التصنيف → النتيجة | جدول Rule Catalog مقترح (ملحق C) مع أمثلة Default | ✅ Approve |
| GAP-14-03 | RULE | High | Override لـR2/R3: من يملكه، لأي مدة، وبأي توثيق؟ | Override بصلاحية + Reason + Expiry إلزامي + Audit؛ R4 لا Override | ✅ Approve |
| GAP-14-04 | AMBIG | Medium | أين يُطبق القرار؟ (Start Session؟ Fuel Entry؟ Trip؟ Assignment؟) | Enforcement Points: Assignment Create, Session Start, Trip Start, Handover. Fuel Entry = Warning فقط (عدم منع تسجيل واقعة حدثت) | ✅ Approve |

### §15 Driver Sessions

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-15-01 | RULE | High | Session لم تُغلق (نسي السائق) | Auto-flag بعد X ساعات (Default 14h) → Alert؛ الإغلاق الإداري بقراءة عداد ودليل، Data Quality = Estimated | ✅ Approve |
| GAP-15-02 | RULE | High | Used Day / Driven Day: تعريف اليوم (Timezone؟ Session تتخطى منتصف الليل تُحسب يومين؟) | Day حسب Timezone الفرع؛ Session عبر منتصف الليل تُحسب Used Day لكل يوم تلمسه؛ Driven Day = يوم فيه مسافة > 0 من قراءات Valid | ✅ Approve |
| GAP-15-03 | RULE | Medium | Opening Odometer ≠ Closing Odometer للجلسة السابقة (Gap) | فرق > Tolerance → Unaccounted Distance Flag | ✅ Approve |
| GAP-15-04 | AMBIG | Medium | "Missing Sessions" alert: كيف يُكتشف؟ | تفويلة/حركة عداد على مركبة بدون Session مفتوحة في وقتها → Missing Session | ✅ Approve |

### §16 Trips

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-16-01 | REQ | High | Trip Lifecycle غير معرّف | Draft → Pending Approval → Approved/Rejected → In Progress → Completed / Cancelled | ✅ Approve |
| GAP-16-02 | RULE | High | Prior Approval مطلوب لكن المدير غير متاح أو السائق Offline | لا Start لرحلة تتطلب موافقة بدون الموافقة؛ Emergency Trip (Configurable) يبدأ مع Post-Approval | ✅ Approve |
| GAP-16-03 | REQ | Medium | GPS Consent/Privacy: موافقة السائق وما يحدث عند رفض الإذن | تسجيل "Location Unavailable – Permission Denied" بدل منع العملية (ما لم تفرض الشركة خلاف ذلك) | ✅ Approve |
| GAP-16-04 | RULE | Medium | Trip Coverage formula غير معرّفة | Coverage % = Σ Valid Trip Distance ÷ Valid Recorded Distance للفترة؛ يُعرض مع Data Quality | ✅ Approve |
| GAP-16-05 | SCOPE | Medium | Multi-stop / Round trip / رحلات متعددة الأيام | Initial: رحلة بنقطة بداية ونهاية فقط؛ Multi-stop خارج النطاق | ✅ Approve |

### §17 Leave & Availability

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-17-01 | RULE | High | إجازة معتمدة لسائق عنده Assignment → ماذا يحدث؟ | Alert للـFleet Manager لتعيين Substitute؛ منع Session Start للسائق خلال الإجازة (R3) | ✅ Approve |
| GAP-17-02 | REQ | Medium | Leave Lifecycle (Pending/Approved/Rejected/Cancelled) وإلغاء إجازة بعد بدئها | إضافة Lifecycle + Cancel/Shorten بصلاحية | ✅ Approve |
| GAP-17-03 | REQ | Medium | Vehicle Availability % و Driver Availability % غير معرّفة رياضيًا | Availability % = Available Hours ÷ Scheduled Hours (حسب Working Schedule) | ✅ Approve |
| GAP-17-04 | AMBIG | Low | مصدر الإجازات لو الشركة عندها HR System | Import/Manual فقط في الإصدار الأول | ✅ Approve |

### §18 Cost Management

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-18-01 | REQ | High | Cost Entry Workflow (من يسجل، المرفقات، الاعتماد) غير موجود للتكاليف غير الوقود والصيانة (تأمين، ترخيص، إيجار، غرامات) | Cost Record: Category, Vehicle/Branch, Vendor, Amount, Tax, Currency, Expense Date, Payment Date, Coverage Start/End, Attachment, Status | ✅ Approve |
| GAP-18-02 | RULE | **Critical** | VAT/Tax غير معرّف | حفظ Net + Tax + Gross؛ التقارير بـ**Net** افتراضيًا (Configurable) مع إمكانية Gross | ✅ Approve |
| GAP-18-03 | REQ | High | Cost Centers / Departments / Projects غير موجودة؛ التوزيع على مستوى المركبة فقط | Cost Center على المركبة (Effective-dated)؛ التكاليف المشتركة (غير المرتبطة بمركبة) تُوزّع على مستوى الفرع — OD-10 | ✅ Approve |
| GAP-18-04 | RULE | Medium | Daily Proration: أشهر غير متساوية، سنة كبيسة، إلغاء تأمين واسترداد جزئي (Refund) | Daily Rate = Amount ÷ Coverage Days (شامل)؛ Refund = Negative Cost مرتبط بالأصل يعيد التوزيع | ✅ Approve |
| GAP-18-05 | RULE | Medium | تكلفة لمركبة بعد Disposal / قبل Operational Start | مسموح كـRecorded؛ Allocation تتوقف عند Disposal Date | ✅ Approve |
| GAP-18-06 | REQ | Medium | Depreciation غير مذكور (مطلوب لـTCO) | Out of Scope صراحة في الإصدار الأول (مرتبط بـ"ليس Full TCO") | ✅ Approve |

### §19 Multi-Currency

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-19-01 | SCOPE | High | Multi-Currency مطلوب من البداية رغم دولة واحدة في الـPilot | Pilot: عملة واحدة مع حفظ Original Currency في كل سجل (Schema-ready)؛ FX Conversion = Commercial | ✅ Approve |
| GAP-19-02 | RULE | High | Missing Rate Handling | التقرير المجمّع يعرض المبالغ غير المحوّلة منفصلة + Data Quality = Partial؛ لا تحويل بسعر مُخمّن | ✏️ Modify: سعر آخر يوم عمل سابق (≤7 أيام) مع علامة Estimated، بعدها غير محوّل |

### §20 Alerts & SLA

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-20-01 | REQ | High | Alert Catalog: لكل نوع (Trigger، Severity، Owner الافتراضي، SLA، Auto-Resolve Condition) غير موجود | جدول Alert Catalog (ملحق D) | ✅ Approve |
| GAP-20-02 | RULE | High | Auto-resolution: هل التنبيه يُغلق تلقائيًا لما السبب يختفي (تجديد المستند)؟ | Auto-Resolved عند زوال السبب مع Audit؛ Closed يدويًا بعد المراجعة (Configurable) | ✅ Approve |
| GAP-20-03 | RULE | Medium | Primary Owner غائب (إجازة/معطّل) | Fallback إلى Escalation Owner ثم Company Admin | ✅ Approve |
| GAP-20-04 | REQ | Medium | تفضيلات الإشعارات للمستخدم (Quiet Hours، القنوات، اللغة) | User Notification Preferences — عدا Critical Safety لا يمكن كتمها | ✅ Approve |
| GAP-20-05 | AMBIG | Low | الفرق بين Resolved وClosed | Resolved = السبب عولج؛ Closed = تم التحقق/الأرشفة | ✅ Approve |

### §21 Offline

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-21-01 | RULE | **Critical** | Event Timestamp من ساعة الجهاز قابل للتلاعب أو الخطأ | تسجيل Device Time + Server Receive Time + Device Clock Offset عند آخر اتصال + Monotonic Counter لكل جهاز؛ انحراف > X دقيقة → Flag | ✅ Approve |
| GAP-21-02 | REQ | High | حدود الجهاز: عدد الأحداث المعلقة، حجم الصور، مساحة التخزين | Default مقترح: ضغط الصور ≤ 500KB، تحذير عند 80% من مساحة مخصصة، الأحداث النصية تُرسل قبل الصور | ✅ Approve |
| GAP-21-03 | RULE | High | فقد/تغيير الجهاز وعليه أحداث غير مُرسلة | تحذير قبل Logout مع وجود Pending؛ Remote Wipe للـCache عند تعطيل الحساب؛ الأحداث غير المرسلة تُعتبر مفقودة وتُوثّق | ✅ Approve |
| GAP-21-04 | RULE | High | Sync ordering: أحداث متعددة من جهاز واحد لنفس المركبة | المعالجة حسب Device Sequence ثم Event Time؛ حدث يعتمد على آخر لم يصل → Pending Dependency | ✅ Approve |
| GAP-21-05 | REQ | Medium | ما البيانات المتاحة Read-only في الـOffline Cache؟ (المستندات، آخر عداد، الصيانة المستحقة) | تحديد Offline Data Set للسائق + أقصى عمر (يرتبط OD-04) | ✅ Approve |
| GAP-21-06 | AMBIG | Medium | Conflict Types غير معرّفة | Duplicate / Overlapping Session / Odometer Conflict / Assignment Expired / Eligibility Changed / Card Inactive | ✅ Approve |

### §22 Data Quality & Recalculation

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-22-01 | RULE | High | معايير كل Data Quality Status غير معرّفة | Reliable = كل المدخلات Valid؛ Estimated = يحتوي قيمة مشتقة/إدارية؛ Partial = تغطية < 100% وفوق حد أدنى؛ Unavailable = تحت الحد أو بدون مدخلات | ✅ Approve |
| GAP-22-02 | RULE | High | Period Locking: هل الشهر المغلق ماليًا يمكن تعديله؟ | Period Close بصلاحية Finance/Admin؛ التعديل بعد الإغلاق = Adjustment في الفترة المفتوحة أو Reopen بموافقة | ✅ Approve |
| GAP-22-03 | REQ | Medium | Recalculation: متزامن أم Background؟ وما يظهر للمستخدم أثناءها | Background Job + مؤشر "Recalculating" على الـKPIs المتأثرة | ✅ Approve |
| GAP-22-04 | RULE | Medium | من يعتمد الـCorrections؟ | Correction على سجل مالي أو عداد مؤكد → Maker/Checker؛ غيرها حسب الإعداد | ✅ Approve |

### §23 Dashboards & KPIs

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-23-01 | REQ | High | KPIs ناقصة: Vehicle Utilization %، Availability %، Downtime، Maintenance Compliance %، Document Compliance %، Fuel Budget Variance، Cost per Vehicle | إضافتها للـKPI Dictionary مع Denominators | ✅ Approve |
| GAP-23-02 | REQ | High | قائمة Standard Reports غير موجودة | Fuel Report، Fuel Card Statement & Reconciliation، Maintenance History & Due، Document Expiry، Cost by Vehicle/Branch/Category، Assignment History، Odometer Exceptions، Audit Log Report | ✅ Approve |
| GAP-23-03 | REQ | Medium | Filters/Drill-down/Scheduled Reports | Filters (Period, Branch, Vehicle Type)، Drill-down للسجلات المصدر، Scheduled Email (Commercial) | ✅ Approve |
| GAP-23-04 | AMBIG | Medium | Driver Dashboard على الموبايل غير مذكور | Driver Home: المركبة الحالية، حالة الأهلية، المستندات، Pending Sync، آخر العمليات | ✅ Approve |

### §24 Import & Onboarding

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-24-01 | REQ | High | Import Templates لكل كيان وحدود الحجم | Templates رسمية لكل كيان + Max Rows/Batch | ✅ Approve |
| GAP-24-02 | RULE | High | Partial Import: هل يُستورد الصحيح ويُرفض الخاطئ أم الكل أو لا شيء؟ | Configurable per Batch؛ Default = All-or-Nothing للمالي، Partial للـMaster Data | ✅ Approve |
| GAP-24-03 | RULE | Medium | Rollback لـImport Batch | Rollback متاح قبل استخدام السجلات في عمليات لاحقة؛ بعده Correction فقط | ✅ Approve |

### §25 Data Model

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-25-01 | REQ | High | Entities ناقصة: Vendor، Work Order، Defect Report، Lease Contract، Incident/Accident، Fine، Meter Replacement، Fuel Budget، Cost Center، Device، Period Close، Override | إضافتها | ✅ Approve |
| GAP-25-02 | REQ | Medium | لا يوجد ERD مفاهيمي أو Cardinalities | ERD مفاهيمي في v0.2 | ✅ Approve |

### §26 NFR

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-26-01 | REQ | High | Mobile Platforms وأدنى إصدارات + المتصفحات المدعومة | Android + iOS (أدنى إصدار يُحدد بعد OD-02)؛ آخر نسختين من Chrome/Edge/Safari/Firefox | ✅ Approve |
| GAP-26-02 | REQ | High | Session/Token: مدة الجلسة، Lockout بعد محاولات فاشلة، Password Policy | إضافة قيم Default قابلة للتعديل ضمن Platform Guardrails | ✅ Approve |
| GAP-26-03 | REQ | Medium | Audit Log retention وعدم القابلية للتعديل | Audit Append-only؛ Retention ≥ أطول Retention مالي | ✅ Approve |
| GAP-26-04 | REQ | Medium | Availability/Uptime target غير موجود | ربط بـOD-12/OD-13 | ✅ Approve |
| GAP-26-05 | REQ | Medium | Penetration Test قبل الإنتاج | إضافة لـG3 | ✅ Approve |

### §27 Privacy

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-27-01 | REQ | High | Data Subject Rights (طلب سائق لبياناته/حذفها) | Export لبيانات السائق + Anonymization بعد انتهاء الـRetention مع الحفاظ على السجلات المالية | ✅ Approve |
| GAP-27-02 | REQ | Medium | Consent لجمع الموقع والصور | شاشة Consent داخل التطبيق + سجل الموافقة | ✅ Approve |
| GAP-27-03 | REQ | Medium | Sub-processors (Push, Email, Storage) | قائمة Sub-processors ضمن مراجعة Data Residency | ✅ Approve |

### §28–29 Pilot & Acceptance

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-28-01 | CONFLICT | **Critical** | G5 "Full Commercial Scope Verified" يتعارض مع منطق Controlled Pilot لعميل واحد | G5 = Pilot Scope Verified؛ Commercial Scope له Release Gate منفصل | ✅ Approve |
| GAP-28-02 | REQ | High | مدة الـPilot وحجمه (عدد المركبات/السائقين/الفروع) غير مذكور | ربط بـOD-02 + اقتراح Pilot بفرع واحد أو اثنين | ✅ Approve |
| GAP-28-03 | REQ | High | تعريف Critical Defect وSeverity Levels | Sev1–Sev4 مع أمثلة؛ No-Go = أي Sev1 مفتوح | ✅ Approve |
| GAP-28-04 | REQ | Medium | Pilot Exit/Rollback Plan لو Go/No-Go = No-Go | إضافة Exit Plan + Data Export للعميل | ✅ Approve |
| GAP-29-01 | AMBIG | High | Acceptance Criteria مكتوبة كأهداف ("صحة Full-to-Full") وليست اختبارات | تحويلها لـTest Scenarios بـWorked Examples (ملحق E) | ✅ Approve |

### §30–35 Risks, Release, Open Decisions, Traceability

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-30-01 | REQ | Medium | مخاطر ناقصة: اعتماد على مزود Push/SMS، تلاعب السائق بالبيانات (Fraud)، ضعف جودة الكاميرا/الإيصالات، تغيّر متطلبات العميل الأول (Customer Lock-in) | إضافتها مع Mitigation | ✅ Approve |
| GAP-31-01 | CONFLICT | Medium | Release Phases تضع Offline Sync في C وAlerts في D، بينما الـPilot يحتاجها؛ وFuel Cards كاملة في D | إعادة ترتيب المراحل حسب Pilot MVP (GAP-02-01) | ✅ Approve |
| GAP-32-01 | REQ | High | قرارات مفتوحة جديدة ناتجة عن المراجعة | إضافة OD-19 → OD-28 (القسم 4 أدناه) | ✅ Approve |
| GAP-33-01 | REQ | High | الـIDs مقترحة لكن المتطلبات نفسها غير مرقمة | ترقيم كل متطلب في v0.2 (مثال `FUEL-012`) + MoSCoW + Pilot/Commercial | ✅ Approve |
| GAP-33-02 | REQ | Low | Prefixes ناقصة للموديولات الجديدة | VND (Vendors)، WO (Work Orders)، INC (Incidents & Fines)، INS (Inspection)، RPT (Reports)، NTF (Notifications)، IMP (Import) | ✅ Approve |

---

## 3. Cross-Cutting Findings (تعارضات بين الأقسام)

| ID | Type | Sev | Finding | Proposal | Decision |
|---|---|---|---|---|---|
| GAP-X-01 | CONFLICT | **Critical** | Session وTrip وAssignment وHandover كلها تسجل "من يقود المركبة الآن" بدون قاعدة مصدر الحقيقة | **Hierarchy:** Assignment = من يحق له. Session = من يستخدم فعليًا (لو مفعّل). Trip = داخل Session دائمًا (لو الاتنين مفعّلين)؛ Trip Start يفتح Session تلقائيًا لو غير مفتوحة. Handover يغلق Session ويفتح أخرى | ✅ Approve |
| GAP-X-02 | CONFLICT | High | نفس قراءة العداد تُسجل في Fuel Entry وSession Start في نفس اللحظة → نقطتان في الـTimeline | قراءتان لهما نفس القيمة ±Tolerance خلال دقائق = Corroborating (تقوّي الموثوقية) وليس تكرار | ✅ Approve |
| GAP-X-03 | CONFLICT | High | "Offline Fuel Entry مسموح" + "Fuel Card Validation" + الكارت قد يكون موقوفًا | التفويلة تُقبل Offline وتُعلّم Pending Card Validation عند المزامنة | ✅ Approve |
| GAP-X-04 | RULE | High | لا يوجد مبدأ موحد للحذف | **No Hard Delete** للسجلات التشغيلية والمالية؛ Void/Cancel مع سبب. Hard Delete فقط لـDrafts غير المرسلة ولـRetention Purge | ✅ Approve |
| GAP-X-05 | RULE | Medium | Timezone للتقارير عند تعدد الفروع/الدول | السجل يُحفظ UTC + Local Timezone؛ التقارير بـTimezone الفرع، والمجمّع بـTimezone الشركة | ✅ Approve |
| GAP-X-06 | CONFLICT | Medium | Fuel Efficiency "مرتبط بالمركبة" لكن تقييم السائق قد يُطلب لاحقًا | الإصدار الأول: Vehicle-level فقط؛ Driver-level KPIs = Future مع تحذير من الإسناد غير العادل | ✅ Approve |
| GAP-X-07 | RULE | Medium | Fraud Indicators غير مذكورة (إيصالات مكررة، تفويل يتجاوز السعة، تفويل في يوم إجازة) | تجميعها كـAnomaly Flags للمراجعة، لا كاتهام — Should | ✅ Approve |

---

## 4. Open Decisions جديدة مقترحة

| ID | Decision | Priority | Related |
|---|---|---|---|
| OD-19 | Driver Authentication Method & Shared Devices | Critical before mobile dev | GAP-03-06 |
| OD-20 | Pilot MVP Scope Approval | Critical | GAP-02-01 |
| OD-21 | Default Validation Thresholds (Odometer, Fuel, Duplicate, Tank Tolerance) | Critical | GAP-09-02, GAP-10-02/04 |
| OD-22 | Reconciliation Matching Tolerances | Critical before Fuel Cards | GAP-11-04 |
| OD-23 | Tax/VAT Treatment in Reporting (Net vs Gross) | Critical before Cost | GAP-18-02 |
| OD-24 | Session/Trip/Assignment Hierarchy | Critical | GAP-X-01 |
| OD-25 | Break-Glass Support Access Policy | High | GAP-03-02 |
| OD-26 | Period Close & Post-Close Corrections | High | GAP-22-02 |
| OD-27 | Cross-Tenant User Identity | High | GAP-03-08 |
| OD-28 | Defect Severity & Critical Defect Definition (Pilot) | High | GAP-28-03 |

---

## ملحق A — RBAC Matrix (مسودة للاعتماد)

**Legend:** ✅ Full · 🔵 Assigned Branches only · 👤 Own records only · 👁 View only · ✔️ Approve/Verify · — No access

| Resource / Action | Platform Admin | Company Admin | Fleet Manager | Finance Reviewer | Driver | Viewer |
|---|---|---|---|---|---|---|
| Tenants / Country Templates | ✅ | — | — | — | — | — |
| Tenant operational data | — (Break-Glass فقط) | ✅ | 🔵 | 👁 | 👤 | 👁 |
| Company settings & policies | — | ✅ | — | — | — | — |
| Users & roles | Admin invite فقط | ✅ | — | — | — | — |
| Branches | — | ✅ | 👁 🔵 | 👁 | — | 👁 |
| Vehicles — create/edit | — | ✅ | 🔵 | 👁 | 👁 (المخصصة) | 👁 |
| Vehicle transfer/dispose | — | ✅ | 🔵 (نقل فقط) | — | — | — |
| Drivers — create/edit | — | ✅ | 🔵 | — | 👤 (بيانات الاتصال) | 👁 |
| Assignments | — | ✅ | 🔵 | — | 👁 👤 | 👁 |
| Handover | — | ✅ | 🔵 ✔️ | — | 👤 (إنشاء) | — |
| Fuel entry — create | — | ✅ | 🔵 | — | 👤 | — |
| Fuel entry — review/void | — | ✅ | 🔵 ✔️ | ✔️ | — | — |
| Fuel cards & statements import | — | ✅ | 🔵 👁 | ✅ | — | — |
| Reconciliation resolve | — | ✅ | 🔵 | ✔️ | — | — |
| Defect report | — | ✅ | 🔵 | — | 👤 (إنشاء) | — |
| Work orders / Maintenance visits | — | ✅ | 🔵 | 👁 (التكلفة) | — | 👁 |
| Documents — upload | — | ✅ | 🔵 | — | 👤 (مستنداته) | — |
| Documents — verify | — | ✅ ✔️ | 🔵 ✔️ | — | — | — |
| Documents — view/download (vehicle) | — | ✅ | 🔵 | 👁 | 👁 حسب السياسة | 👁 |
| Readiness override (R2/R3) | — | ✅ | 🔵 حسب الإعداد | — | — | — |
| Sessions / Trips | — | ✅ | 🔵 ✔️ | — | 👤 | 👁 |
| Leave requests | — | ✅ | 🔵 ✔️ | — | 👤 | — |
| Costs — create/edit | — | ✅ | 🔵 | ✅ | — | — |
| Period close | — | ✅ | — | ✅ | — | — |
| Sync conflicts resolve | — | ✅ | 🔵 | — (المالية ✔️) | — | — |
| Corrections approve | — | ✅ | 🔵 (غير المالية) | ✔️ (المالية) | — | — |
| Dashboards & reports | Platform health | ✅ | 🔵 | ✅ (مالي) | Driver home | 👁 |
| Audit log | Platform audit | ✅ | 🔵 👁 | 👁 (مالي) | — | — |
| Import | — | ✅ | 🔵 (Master data) | ✅ (مالي) | — | — |

**قواعد ملزمة:** Maker ≠ Checker · كل ✔️ يُسجل في Audit · كل الفحص Server-side.

---

## ملحق B — State Machines (مسودة)

**Vehicle Lifecycle:** Draft → Active ⇄ Inactive → Disposed (terminal). Availability منفصلة ومحسوبة.

**Document Verification:** Draft → Pending Verification → Verified | Rejected; Verified → Superseded (عند رفع نسخة أحدث). Rejected → (رفع جديد) Pending. Validity محسوبة من التاريخ.

**Defect → Work Order:** Defect: Reported → Triaged → Converted | Rejected | Duplicate. Work Order: Open → Scheduled → In Progress → Completed → Closed; Cancelled من أي حالة قبل Completed.

**Fuel Entry:** Draft (device) → Submitted → [Under Review] → Accepted; Accepted → Voided (مع سبب).

**Reconciliation Item:** Unmatched → Matched | Conflict → Under Review → Resolved.

**Trip:** Draft → Pending Approval → Approved | Rejected → In Progress → Completed; Cancelled قبل In Progress.

**Leave:** Pending → Approved | Rejected; Approved → Cancelled.

**Alert:** Open → Acknowledged → In Progress → Resolved → Closed؛ Auto-Resolved عند زوال السبب. Escalated = Flag.

**Tenant:** Provisioning → Active → Suspended → Terminated.

**Country:** Draft → Configuration Ready → Compliance Review → UAT Approved → Active ⇄ Suspended.

---

## ملحق C — Readiness Rule Catalog (أمثلة Default للاعتماد)

| Rule | Dimension | Risk | Outcome |
|---|---|---|---|
| رخصة السائق منتهية | Driver | R4 | Restricted |
| فئة الرخصة لا تطابق المركبة | Driver/Vehicle | R4 | Restricted |
| تأمين المركبة الإلزامي منتهي | Vehicle | R4 | Restricted |
| استمارة/ترخيص المركبة منتهية | Vehicle | R4 | Restricted |
| مستند إلزامي Pending Verification | Driver/Vehicle | R2 | Allowed with Warning |
| صيانة وقائية Overdue (بند عادي) | Vehicle | R2 | Allowed with Warning |
| صيانة Overdue لبند سلامة (فرامل) | Vehicle | R3 | Restricted (Override مسموح) |
| Work Order مفتوح "Not Drivable" | Vehicle | R4 | Restricted |
| السائق في إجازة معتمدة | Availability | R3 | Restricted |
| لا يوجد Assignment سارٍ | Authorization | R3 | Restricted |
| مستند ينتهي خلال 14 يوم | Driver/Vehicle | R1 | Allowed (Info) |

> القيم القانونية الفعلية تُعتمد بعد OD-01/OD-05.

---

## ملحق D — Alert Catalog (مقتطف)

| Alert | Trigger | Severity | Owner | Auto-Resolve |
|---|---|---|---|---|
| Document Expiring | Expiry − lead time | Low→Medium | Fleet Manager (branch) | عند رفع نسخة Verified |
| Document Expired | Expiry Date passed | High | Fleet Manager | عند Verified جديد |
| Maintenance Upcoming/Overdue | Forecast threshold | Medium/High | Fleet Manager | عند Visit مكتملة |
| Odometer Conflict | Validation rule | Medium | Fleet Manager | عند Correction/Accept |
| Fuel Budget 80%/100% | Budget threshold | Medium/High | Fleet Manager + Finance | بداية فترة جديدة |
| Card Low Balance / Over-Limit | Balance threshold | Medium/High | Finance | عند Top-up/Settlement |
| Unmatched Provider Transaction | Reconciliation | Medium | Finance | عند Resolve |
| Session Not Closed | > X hours open | Medium | Fleet Manager | عند الإغلاق |
| Sync Conflict | Sync engine | High | Fleet Manager | عند Resolve |
| Restriction Raised | Readiness R3/R4 | High/Critical | Fleet Manager + Escalation | عند زوال السبب |

---

## ملحق E — Worked Examples (أساس Acceptance Tests)

### E1 — Full-to-Full
| # | Odometer | Liters | Full? |
|---|---|---|---|
| 1 | 10,000 | 50 | Full |
| 2 | 10,300 | 20 | Partial |
| 3 | 10,600 | 40 | Full |

Cycle = (2) + (3) = 60 L ؛ Distance = 10,600 − 10,000 = 600 km → **10.0 L/100 km**. التفويلة (1) لا تدخل (هي بداية الدورة). لو التفويلة (2) Conflict → الدورة **Partial** ولا تُستخدم كـReliable.

### E2 — Daily Proration
تأمين سنوي 3,650 لفترة 1 Jan–31 Dec (365 يوم) → 10/يوم. تقرير فبراير (28 يوم) Allocated = 280، وRecorded في يناير (تاريخ المصروف) = 3,650. مجموع Allocated للسنة = 3,650 بالضبط (لا Expense إضافي).

### E3 — Cost/km مع بيانات ناقصة
فترة: تكلفة 5,000، المسافة الموثوقة 0 (كل القراءات Conflict) → Cost/km = **Unavailable** (وليس 0 أو ∞).

### E4 — Prepaid Card
Confirmed Opening 1,000؛ Top-up 500 (ليست Expense)؛ Provider Txn 300 مطابقة لتفويلة → Fuel Expense = 300 مرة واحدة؛ Confirmed Balance = 1,200.

### E5 — Duplicate Sync
نفس Event ID يصل 3 مرات بسبب Retry → سجل واحد، والردّان الآخران يرجعان نفس النتيجة (Idempotent).

---

## 5. الخطوات التالية

1. **مراجعة واعتماد** هذا المستند: ملء عمود Decision لكل GAP (أولوية: Critical ثم High).
2. حسم Open Decisions الحرجة: OD-17، OD-19 → OD-24.
3. إصدار **PRD v0.2** يدمج القرارات المعتمدة فقط، بـRequirement IDs وMoSCoW وPilot/Commercial.
4. تحويل v0.2 إلى **Epics → User Stories → Acceptance Criteria (Given/When/Then)** مع Traceability لكل `REQ-ID` و`GAP-ID`.

**مقترح ترتيب المراجعة (جلسات):**
- جلسة 1: Scope + RBAC + Cross-Cutting (GAP-02, 03, X, 28-01)
- جلسة 2: Vehicles, Drivers, Assignment, Odometer, Readiness (06–09, 14)
- جلسة 3: Fuel, Cards, Maintenance, Costs (10–12, 18–19)
- جلسة 4: Documents, Sessions, Trips, Leave, Alerts, Offline (13, 15–17, 20–22)
- جلسة 5: NFR, Privacy, Pilot, Release (23–33)

---

## 6. Decision Log — قرارات معتمدة بالتفويض

**التاريخ:** 11 Nov 2026 · **الأساس:** فوّض صاحب المنتج اتخاذ القرارات المناسبة وفق المعايير القياسية. كل القرارات قابلة للمراجعة والتعديل من صاحب المنتج.

- **147 Finding = ✅ Approve** كما في المقترح · **2 = ✏️ Modify** (GAP-03-06، GAP-19-02) · **1 = ⏸ Defer** (GAP-05-05).
- القيم الافتراضية والمعايير المرجعية المعتمدة موثقة في `PRD_v0.2.md` §3 (Standards & Defaults).

| OD | Decision | Basis |
|---|---|---|
| OD-03 | Parallel Run (2–4 أسابيع) ثم Cutover؛ النظام القديم System of Record أثناء التشغيل المزدوج | ممارسة قياسية لتقليل مخاطر الانتقال |
| OD-04 | Offline Authorization: Default 72h، Platform Maximum 168h | OWASP MASVS — تقييد عمر الاعتماد المحلي |
| OD-08 | RPO ≤ 15 دقيقة (PITR)، RTO ≤ 4 ساعات، Restore Test ربع سنوي | ممارسة SaaS قياسية |
| OD-09 | سعر يوم المصروف؛ المصدر: السعر الرسمي للبنك المركزي لدولة الشركة مع إدخال يدوي احتياطي | IAS 21 (سعر تاريخ المعاملة) |
| OD-10 | Daily Proration؛ الباقي من التقريب في آخر فترة؛ Refund = تكلفة سالبة مرتبطة بالأصل | Accrual basis |
| OD-11 | Pilot Thresholds — انظر `PRD_v0.2.md` §31 | — |
| OD-12 | Sev1: 1h/4h (24×7) · Sev2: 4h/1 يوم عمل · Sev3: 1/5 أيام عمل · Sev4: الإصدار التالي | ITIL |
| OD-13 | Availability 99.5%؛ p95 قراءة < 500ms، كتابة < 1s — تُراجع بعد OD-02 | — |
| OD-15 | اعتماد تفعيل الدولة: Product Owner + Compliance + UAT Sign-off | — |
| OD-17 | RBAC Matrix (ملحق A) معتمدة كـBaseline | Least Privilege, SoD |
| OD-18 | KPI Dictionary — `PRD_v0.2.md` §26 | — |
| OD-19 | Driver: Phone + OTP ثم Device-bound Token + PIN/Biometric | NIST SP 800-63B |
| OD-20 | Pilot MVP كما في GAP-02-01 | — |
| OD-21 / OD-22 | القيم الافتراضية في `PRD_v0.2.md` §3 (كلها Configurable) | — |
| OD-23 | حفظ Net + Tax + Gross؛ التقارير Net افتراضيًا | معاملة VAT القابلة للاسترداد |
| OD-24 | Assignment ⊃ Session ⊃ Trip؛ Handover يغلق ويفتح Session | — |
| OD-25 | Break-Glass: موافقة العميل، 24h حد أقصى، Read-only، Audit ظاهر للعميل | ISO 27001 A.9 |
| OD-26 | Period Close شهري؛ التصحيح بعد الإغلاق = Adjustment في فترة مفتوحة | ممارسة محاسبية قياسية |
| OD-27 | هوية واحدة على المنصة + Membership لكل Tenant | — |
| OD-28 | Sev1–Sev4؛ No-Go عند أي Sev1/Sev2 مفتوح | ITIL |

**تبقى مفتوحة (تحتاج قرار عمل/قانوني لا يمكن حسمه بمعيار):** OD-01 الدولة الأولى · OD-02 Fleet Profile · OD-05 القواعد القانونية · OD-06 Hosting Region · OD-07 مدد الاحتفاظ القانونية (Default مؤقت: 7 سنوات للمالي والـAudit) · OD-14 التسعير · OD-16 Tenant Migration (مستقبلي).
