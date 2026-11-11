# Product Backlog — Epics, User Stories & Acceptance Criteria
## Fleet Management SaaS

**Version:** 0.2 · **Date:** 11 Nov 2026 · **Source:** `PRD_v0.2.md`
**Scope of detail:** Pilot MVP (Rel = P) مفصّل بـAcceptance Criteria قابلة للاختبار. Commercial Wave (Rel = C) على مستوى Epics وعناوين Stories، وتُفصَّل قبل بدء مرحلتها.

## Conventions

- **Story ID:** `US-<EPIC>-<NN>` · **Trace:** أرقام المتطلبات في PRD v0.2.
- **AC format:** Given / When / Then. القيم `D-*` من PRD §3.2.
- **Definition of Done (لكل Story):** AC تمر آليًا حيث أمكن · Authorization Server-side مُختبر (سلبي وإيجابي) · Audit Event مسجل للعمليات الحساسة · يعمل AR (RTL) وEN · لا Hard Delete (GEN-002) · سلوك Offline مطابق للمذكور.

## Epic Map

| Epic | Title | Rel | Stories |
|---|---|---|---|
| E01 | Tenancy & Platform Admin | P | 4 |
| E02 | Authentication & RBAC | P | 7 |
| E03 | Company, Branches & Country Config | P | 3 |
| E04 | Vendors | P | 1 |
| E05 | Vehicles | P | 5 |
| E06 | Drivers | P | 3 |
| E07 | Assignments & Handover | P | 4 |
| E08 | Odometer | P | 6 |
| E09 | Fuel | P | 8 |
| E10 | Maintenance & Work Orders | P | 8 |
| E11 | Documents | P | 5 |
| E12 | Operational Readiness | P | 4 |
| E13 | Alerts & Notifications | P | 4 |
| E14 | Offline & Sync | P | 7 |
| E15 | Costs (Recorded) | P | 3 |
| E16 | Corrections, Audit & Recalculation | P | 4 |
| E17 | Import & Onboarding | P | 4 |
| E18 | Dashboards, KPIs & Reports | P | 5 |
| E19 | NFR & Operations | P | 4 |
| E20–E28 | Commercial Wave | C | عناوين فقط |

---

# E01 — Tenancy & Platform Admin

**US-E01-01 — Provision Tenant** · Trace: TEN-001, TEN-007
As a Platform Admin, I want to create a tenant so that a new company can start with an isolated environment.
- Given بيانات شركة صحيحة وCountry Template بحالة Active, When أنشئ Tenant, Then تُنشأ Database وStorage معزولان وDefault Roles ودعوة Company Admin خلال < 30 دقيقة ويسجَّل Platform Audit.
- Given فشل أي خطوة, When ينتهي Provisioning, Then الحالة = Failed مع سبب، ولا يبقى Tenant نصف مُنشأ قابل للدخول.

**US-E01-02 — Tenant Isolation** · Trace: TEN-002, TEN-003, SEC-012
- Given مستخدم موثّق في Tenant A, When يطلب أي Resource ID أو ملف يخص Tenant B, Then الرد 404/403 ولا يُسرَّب أي محتوى، ويسجَّل Security Event.
- Given طلب يحمل Tenant ID مختلفًا عن هوية المستخدم, When يُعالج, Then يُتجاهل المُدخل ويُستخدم Tenant الهوية فقط.

**US-E01-03 — Suspend / Reactivate Tenant** · Trace: TEN-004
- Given Tenant = Suspended, When يحاول مستخدم كتابة أي سجل, Then يُرفض برسالة واضحة والقراءة تعمل.
- Given سائق لديه أحداث Offline معلقة والـTenant Suspended, When يزامن, Then تُحفظ الأحداث في Quarantine ولا تُفقد.

**US-E01-04 — Managed Schema Migration** · Trace: TEN-006
- Given إصدار Schema جديد, When تُشغَّل الترقية, Then يظهر تقرير حالة لكل Tenant (Success/Failed)، والفاشل يعود لإصداره السابق دون التأثير على الباقين.

# E02 — Authentication & RBAC

**US-E02-01 — Admin Login with MFA** · Trace: SEC-004, SEC-006
- Given Company Admin بكلمة مرور صحيحة, When يسجل الدخول, Then يُطلب TOTP ولا تُنشأ جلسة بدونه.
- Given 5 محاولات فاشلة, When يحاول السادسة خلال 15 دقيقة, Then الحساب مقفل ويسجَّل Audit.
- Given جلسة Web خاملة 30 دقيقة, When يرسل طلبًا, Then يُطلب تسجيل الدخول من جديد.

**US-E02-02 — Driver Login (Phone + OTP)** · Trace: SEC-005
- Given رقم هاتف مرتبط بحساب Driver فعّال, When يدخل OTP صحيحًا, Then يُربط الجهاز ويُطلب إنشاء PIN.
- Given جهاز مربوط, When يفتح التطبيق Offline, Then يدخل بالـPIN/Biometric ضمن D-OFF-WINDOW.
- Given حساب معطّل, When يتصل الجهاز, Then تُلغى الجلسة ويُمسح الـCache.

**US-E02-03 — Manage Users & Roles** · Trace: SEC-001, SEC-002
- Given Company Admin, When ينشئ مستخدمًا بدور Fleet Manager وفروع محددة, Then يرى المستخدم بيانات هذه الفروع فقط.
- Given مستخدم بدورين, When يبدّل الدور النشط, Then تتغير الصلاحيات فورًا ويسجَّل التبديل.

**US-E02-04 — Enforce RBAC Matrix** · Trace: SEC-003, GEN-009
- Given كل خلية في Matrix (PRD §5.3), When يُنفَّذ اختبار آلي للدور على الإجراء عبر الـAPI مباشرة, Then النتيجة تطابق الخلية (سماح/منع) بنسبة 100%.

**US-E02-05 — Maker ≠ Checker** · Trace: GEN-004
- Given مستخدم أنشأ سجلًا (تفويلة، مستند، Correction), When يحاول اعتماده بنفسه حتى لو يملك دور الاعتماد, Then يُرفض برسالة "لا يمكن اعتماد سجل أنشأته".

**US-E02-06 — Break-Glass Support Access** · Trace: SEC-007
- Given Platform Admin بدون Grant, When يحاول فتح بيانات Tenant, Then يُرفض.
- Given طلب وافق عليه Company Admin, When يدخل Platform Admin, Then الوصول Read-only وينتهي تلقائيًا بعد 24 ساعة، وكل ما عُرض يظهر في Audit للعميل.

**US-E02-07 — Sensitive Action Audit** · Trace: SEC-011, NFR-010
- Given أي عملية من قائمة SEC-011, When تُنفَّذ, Then يُنشأ Audit Event (Who، When، What، Before/After) ولا يمكن تعديله أو حذفه من أي دور.

# E03 — Company, Branches & Country Config

**US-E03-01 — Company & Branch Setup** · Trace: CTR-002
- Given Company Admin, When ينشئ فرعًا بـTimezone وWorking Schedule, Then تُستخدم في حسابات اليوم والتقارير لذلك الفرع (GEN-010).

**US-E03-02 — Apply Country Template** · Trace: CTR-001, GEN-008
- Given Country Template يحدد مستندًا إلزاميًا R4, When تحاول الشركة جعله اختياريًا, Then يُرفض؛ ويُسمح لها بإضافة مستندات إلزامية إضافية.

**US-E03-03 — Effective-dated Policy** · Trace: GEN-007
- Given تغيير عتبة Policy بـEffective From = اليوم, When تُعرض سجلات سابقة, Then لا يتغير تقييمها التاريخي.

# E04 — Vendors

**US-E04-01 — Manage Vendors** · Trace: VND-001..003
- Given Vendor مستخدم في زيارات صيانة, When يُعطَّل, Then لا يظهر في القوائم الجديدة ويبقى ظاهرًا في السجلات التاريخية.

# E05 — Vehicles

**US-E05-01 — Create Vehicle** · Trace: VEH-001, VEH-002
- Given Fleet Manager على فرعه, When يحفظ مركبة بدون Tank Capacity أو Required License Category, Then يُرفض مع تحديد الحقول.
- Given Registration Number موجود لمركبة غير Disposed, When يحفظ, Then يُرفض بتحديد المركبة المتعارضة.

**US-E05-02 — Lifecycle & Availability** · Trace: VEH-003, VEH-004
- Given مركبة Active عليها Work Order "Not Drivable", When تُعرض, Then Lifecycle = Active وAvailability = Under Maintenance.
- Given مركبة Inactive, When يُحاول إنشاء Assignment, Then يُرفض.

**US-E05-03 — Branch Transfer** · Trace: VEH-005
- Given مركبة لها مصروفات في الفرع A, When تُنقل للفرع B بتاريخ T, Then تقارير A قبل T لا تتغير، والعمليات بعد T تُنسب لـB، ويظهر تحذير بالـAssignments المتأثرة.

**US-E05-04 — Dispose Vehicle** · Trace: VEH-006
- Given مركبة Disposed بتاريخ D, When يُسجَّل حدث بـEvent Time > D, Then يُرفض؛ وحدث Offline بهذا الوصف يذهب لـConflict Review.

**US-E05-05 — Vehicle 360** · Trace: VEH-008
- Given مركبة, When تُفتح صفحتها, Then تعرض أقسام PRD §26.3 (Pilot) مع Data Quality لكل KPI، وDrill-down لكل سجل مصدر.

# E06 — Drivers

**US-E06-01 — Create Driver & Link Account** · Trace: DRV-001, DRV-002
- Given Driver Record, When يُعطَّل User Account المرتبط, Then يبقى التاريخ التشغيلي كاملًا ويُمنع الدخول.

**US-E06-02 — Employment Status** · Trace: DRV-003
- Given Driver = Suspended, When يُقيَّم Readiness, Then النتيجة Restricted بسبب واضح.

**US-E06-03 — Eligibility Re-evaluation** · Trace: DRV-004, DRV-005
- Given رخصة تنتهي اليوم, When يعمل الـJob اليومي, Then تتغير الأهلية ويُنشأ Alert واحد فقط.

# E07 — Assignments & Handover

**US-E07-01 — Create Assignment** · Trace: ASN-001..005, DRV-006
- Given مركبة لها Primary Driver في الفترة, When يُضاف Primary آخر بفترة متداخلة, Then يُرفض مع عرض التعارض.
- Given سائق برخصة لا تطابق Required License Category, When يُنشأ Assignment, Then يُرفض (R4) بدون خيار Override.
- Given Secondary Driver مؤهل, When يُضاف لنفس الفترة, Then يُقبل.

**US-E07-02 — End / Backdate Assignment** · Trace: ASN-006
- Given صلاحية Backdate, When يُعدَّل تاريخ البداية للخلف, Then تُعاد نسبة التفويلات في الفترة وتُطلق Recalculation ويسجَّل Audit.

**US-E07-03 — Handover** · Trace: ASN-007
- Given سائقان مخوّلان على نفس المركبة, When يُسجَّل Handover بقراءة عداد, Then تنتقل العهدة وتُضاف القراءة للـTimeline.
- Given مستلم غير مخوّل أو Restricted, When يُحاول Handover, Then يُرفض.

**US-E07-04 — Custody Timeline** · Trace: ASN-009
- Given مركبة, When يُعرض Custody Timeline, Then كل فترة لها مسؤول، والفجوات تظهر صراحة "No custodian recorded".

# E08 — Odometer

**US-E08-01 — Unified Timeline** · Trace: ODO-001, ODO-002, ODO-007
- Given تفويلة بقراءة عداد, When تُقبل, Then تظهر القراءة في الـTimeline بمصدرها ورابط للسجل.

**US-E08-02 — Detect Conflict** · Trace: ODO-003, ODO-004, ODO-006, GEN-012
- Given قراءة Valid = 50,000 بتاريخ 1 مارس, When تُسجَّل قراءة 49,800 بتاريخ 3 مارس, Then تُحفظ بحالة Conflict، السجل المصدر محفوظ، يُنشأ Alert، وتُستبعد من الـKPIs.
- Given حدث Offline متأخر بـEvent Time بين قراءتين وقيمته خارج النطاق بينهما, When يُزامن, Then Conflict.

**US-E08-03 — Daily Distance Warning** · Trace: ODO-005
- Given قراءتان بفارق يوم واحد و1,800 km, When تُحفظ الثانية, Then Warning (ليست Conflict) وتبقى داخل الـKPIs حتى القرار.

**US-E08-04 — Corroborating Readings** · Trace: ODO-008
- Given قراءتان بفارق ≤ 2 km خلال 10 دقائق من مصدرين, When تُعرضان, Then تُعلَّمان Corroborating ولا يُنشأ تنبيه تكرار.

**US-E08-05 — Meter Replacement** · Trace: ODO-009
- Given عداد استُبدل عند 180,000 وبدأ الجديد من 0, When يُسجَّل Meter Replacement ثم قراءة 500, Then المسافة الإجمالية تزيد 500 ولا يُنشأ Conflict.

**US-E08-06 — Correct Reading** · Trace: ODO-010, AUD-002
- Given قراءة Conflict, When يصححها Fleet Manager بسبب ويعتمدها مستخدم آخر, Then الحالة Corrected، الأصل محفوظ، وتُطلق Recalculation.

# E09 — Fuel

**US-E09-01 — Record Fuel Entry (Mobile)** · Trace: FUEL-001, FUEL-003, FUEL-009, NFR-006
- Given سائق له Assignment سارٍ, When يسجل تفويلة Cash بدون صورة إيصال, Then يُمنع Submit.
- Given بيانات كاملة, When يضغط Submit, Then تكتمل العملية في ≤ 5 خطوات وتظهر حالة Submitted أو Pending Sync.
- Given Liters = 0 أو Amount < 0, When يحفظ, Then يُرفض.

**US-E09-02 — Tank Capacity Check** · Trace: FUEL-004
- Given Tank Capacity = 60 L, When يُسجَّل 63 L, Then يُقبل (ضمن +5%).
- Given نفس المركبة, When يُسجَّل 64 L, Then Conflict + Alert والسجل محفوظ.

**US-E09-03 — Duplicate Detection** · Trace: FUEL-006
- Given تفويلة (Vehicle X، 40 L، 800) الساعة 10:00, When تُسجَّل أخرى بنفس القيم 10:20, Then تُعلَّم الثانية Possible Duplicate للمراجعة ولا تُحتسب في التكلفة حتى القرار.
- Given نفس القيم الساعة 11:00, When تُحفظ, Then لا تُعلَّم.

**US-E09-04 — Fuel Type & Price Warnings** · Trace: FUEL-005, FUEL-007
- Given مركبة Diesel, When تُسجَّل تفويلة Petrol, Then Warning.
- Given Reference Price = 10/L, When Unit Price = 13/L, Then Warning (> +20%).

**US-E09-05 — Entry Without Valid Assignment** · Trace: FUEL-008
- Given سائق انتهى Assignment له أمس, When يسجل تفويلة اليوم, Then تُقبل بحالة Under Review مع Warning ولا تُرفض.

**US-E09-06 — Review / Void** · Trace: FUEL-002, FUEL-010, GEN-002
- Given تفويلة Accepted, When يلغيها Fleet Manager, Then يُطلب سبب، الحالة Voided، تبقى ظاهرة في السجل، وتخرج من التكاليف والدورات.
- Given سائق, When يحاول تعديل تفويلة بعد المزامنة, Then يُعرض عليه Correction Request فقط.

**US-E09-07 — Full-to-Full Consumption** · Trace: FUEL-011..013
- Given (10,000 km، 50 L، Full) → (10,300، 20 L، Partial) → (10,600، 40 L، Full), When يُحسب الاستهلاك, Then = 10.0 L/100km بحالة Reliable.
- Given التفويلة الجزئية Conflict, When يُحسب, Then الدورة Partial ولا تدخل متوسط Reliable.
- Given تفويلة Full واحدة فقط, When يُعرض المؤشر, Then "Unavailable".
- Given نفس الفترة, When تُعرض Purchased Liters, Then = 110 L منفصلة عن الاستهلاك.

**US-E09-08 — Fuel Budget** · Trace: FUEL-015
- Given Budget شهري 5,000 لمركبة, When يصل الإنفاق 4,000, Then Alert 80% مرة واحدة؛ وعند 5,000 Alert 100%.

# E10 — Maintenance & Work Orders

**US-E10-01 — Templates & Overrides** · Trace: MNT-002
- Given Template لنوع المركبة (زيت كل 10,000 km), When يُضاف Override للمركبة 7,500 km, Then يُستخدم الـOverride لهذه المركبة فقط.

**US-E10-02 — Due Status (Combined)** · Trace: MNT-003, MNT-004
- Given بند: 10,000 km أو 6 أشهر، آخر تنفيذ عند 40,000 km في 1 يناير, When العداد 49,600 في 1 مارس, Then Upcoming.
- Given نفس البند, When التاريخ 2 يوليو والعداد 45,000, Then Overdue (التاريخ سبق).

**US-E10-03 — Forecast with Weak Baseline** · Trace: MNT-005
- Given لا يوجد تنفيذ سابق مسجل, When يُعرض البند, Then "Unknown Baseline" بدون Due Date.
- Given Baseline بقراءة Conflict, When يُعرض, Then Forecast = Estimated.

**US-E10-04 — Driver Defect Report** · Trace: WO-001, WO-002
- Given سائق Offline, When يسجل Defect بصورة و"Not Drivable", Then يُحفظ محليًا ويُرسل عند الاتصال، ويصل Alert للـFleet Manager.
- Given Defect, When يرفضه Fleet Manager, Then يُطلب سبب ويُبلَّغ السائق.

**US-E10-05 — Work Order Lifecycle** · Trace: WO-003, WO-006
- Given Defect Triaged, When يُحوَّل لـWork Order, Then يُربطان ويصبح Defect = Converted.
- Given Work Order بدون Visit, When يُغلق, Then يُطلب سبب إلزامي.

**US-E10-06 — Not-Drivable Restriction** · Trace: WO-004, WO-005
- Given Work Order "Not Drivable" مفتوح, When يُقيَّم Readiness للمركبة, Then Restricted (R4) بدون Override.
- Given نفس الـWO, When يُغلق, Then تزول Restriction ويُحسب Downtime من Off-Road إلى Return to Service.

**US-E10-07 — Maintenance Visit & Invoice** · Trace: MNT-001, MNT-006, MNT-007, FIN-003
- Given Visit بـInvoice Total = 1,000 وBreakdown = 400 + 500, When تُحفظ, Then يظهر Unallocated = 100، والتكلفة في التقارير = 1,000 مرة واحدة.
- Given Visit بدون Invoice Total, When تُكمَّل, Then يُرفض.

**US-E10-08 — Baseline Update** · Trace: MNT-008
- Given Visit مكتملة فيها "تغيير زيت" عند 50,000 km, When تُحفظ, Then Baseline البند = 50,000 وتاريخ الزيارة، ويُغلق تنبيه Overdue تلقائيًا.

# E11 — Documents

**US-E11-01 — Document Types** · Trace: DOC-001
- Given Type بـ"Has Expiry = No", When يُرفع مستند, Then لا يُطلب Expiry وValidity = No Expiry.

**US-E11-02 — Upload & Verify** · Trace: DOC-002, DOC-003, GEN-004
- Given ملف 12 MB أو امتداد غير مسموح, When يُرفع, Then يُرفض برسالة.
- Given مستند رفعه Fleet Manager A, When يتحقق منه Fleet Manager B, Then Verified مع By/At؛ ولو حاول A التحقق يُرفض.

**US-E11-03 — Validity vs Verification** · Trace: DOC-004
- Given مستند Verified انتهى أمس, When يُعرض, Then Verification = Verified وValidity = Expired (حالتان منفصلتان).

**US-E11-04 — Supersede** · Trace: DOC-005
- Given مستند Verified, When تُرفع نسخة جديدة وتُتحقق, Then القديمة Superseded وقابلة للعرض في التاريخ.

**US-E11-05 — Driver Access** · Trace: DOC-007, DOC-008
- Given Type بـDriver-visible = View فقط, When يفتحه السائق المخصص, Then يُعرض بدون تحميل.
- Given سائق بدون Assignment على المركبة, When يطلب المستند عبر الـAPI, Then 403.
- Given أي Download, When يتم, Then Audit Event.

# E12 — Operational Readiness

**US-E12-01 — Rule Catalog** · Trace: OPS-002, OPS-003
- Given Company Admin, When يحاول تخفيض قاعدة Country R4 إلى R2, Then يُرفض (GEN-008).

**US-E12-02 — Evaluate Readiness** · Trace: OPS-001, OPS-004, OPS-007, DOC-006
- Given سائق بمستند R2 Pending ومركبة بتأمين منتهٍ R4, When يُقيَّم عند Assignment Create, Then Restricted مع عرض كل الأسباب.
- Given قيد R2 فقط, When يُقيَّم, Then Allowed with Warning ويظهر التحذير للسائق.
- Given مركبة Restricted, When يسجل السائق تفويلة, Then تُقبل مع Warning (لا منع).

**US-E12-03 — Override** · Trace: OPS-005
- Given قيد R3, When يتجاوزه مستخدم مخوّل بسبب وExpiry, Then Allowed with Warning حتى Expiry ثم يعود القيد تلقائيًا، مع Audit.
- Given Override بدون Expiry, When يُحفظ, Then يُرفض.
- Given قيد R4, When يُحاول Override من أي دور, Then يُرفض.

**US-E12-04 — Missing Data vs Violation** · Trace: OPS-006, OPS-008
- Given مستند اختياري غير مرفوع, When يُقيَّم, Then لا Restriction.
- Given قاعدة تعرّف "غياب المستند الإلزامي = R4", When المستند غير موجود, Then Restricted بسبب "Missing mandatory evidence".
- Given Restriction بسبب مستند, When يُرفع ويُتحقق, Then تزول تلقائيًا عند إعادة التقييم.

# E13 — Alerts & Notifications

**US-E13-01 — Generate & Dedup** · Trace: ALR-001, ALR-003, DOC-009
- Given مستند منتهٍ له Alert مفتوح, When يعمل الـJob اليومي مرة أخرى, Then لا يُنشأ Alert ثانٍ.

**US-E13-02 — Lifecycle & Ownership** · Trace: ALR-002, ALR-005
- Given Alert = Acknowledged, When يُعرض, Then لا يُعتبر Resolved.
- Given Primary Owner معطّل الحساب, When يُنشأ Alert, Then يُسند للـEscalation Owner.

**US-E13-03 — Auto-Resolve** · Trace: ALR-004
- Given Alert "Document Expired", When تُتحقق نسخة جديدة سارية, Then Auto-Resolved مع Audit.

**US-E13-04 — Channels** · Trace: NTF-001, NTF-003
- Given مستخدم لغته Arabic, When يصله Push/Email, Then النص عربي ويسجَّل Delivery Status؛ فشل الإرسال يظهر في Observability.

# E14 — Offline & Sync

**US-E14-01 — Offline Authorization Window** · Trace: OFF-002, OFF-003
- Given آخر تحقق قبل 71 ساعة, When يبدأ السائق تفويلة Offline, Then مسموح.
- Given آخر تحقق قبل 73 ساعة, When يبدأ عملية جديدة, Then يُمنع برسالة "اتصل بالإنترنت"، مع بقاء إرسال المعلّق متاحًا.

**US-E14-02 — Idempotent Sync** · Trace: OFF-004, OFF-005
- Given حدث أُرسل ولم يصل الرد, When يُعاد إرساله 3 مرات, Then سجل واحد فقط في السيرفر وكل الردود ناجحة بنفس المعرّف.

**US-E14-03 — Clock Integrity** · Trace: OFF-006
- Given Device Time يسبق وقت السيرفر بساعتين عند المزامنة, When تُستلم الأحداث, Then تُعلَّم Clock Drift للمراجعة ويُحفظ Device Time وServer Time معًا.

**US-E14-04 — Ordering & Dependencies** · Trace: OFF-007
- Given حدثان من نفس الجهاز وصل الثاني قبل الأول, When يُعالجان, Then النتيجة النهائية مطابقة للترتيب بـDevice Sequence.

**US-E14-05 — Photos After Text** · Trace: OFF-008
- Given 10 تفويلات معلقة بصور على اتصال ضعيف, When تبدأ المزامنة, Then تُقبل كل السجلات النصية أولًا، والصور ≤ 500 KB تُرفع بعدها وتُستكمل عند الانقطاع.

**US-E14-06 — Conflict Review** · Trace: OFF-009, OFF-010
- Given حدث Offline متعارض (Assignment Expired), When يُزامن, Then يُحفظ الأصل ويظهر في Conflict Queue للـFleet Manager.
- Given Conflict, When يُحسم (Accept/Reject/Correct) بسبب, Then يُوثَّق القرار وتُطلق Recalculation؛ لا يُحسم أي تعارض تلقائيًا بـLast-Write-Wins.

**US-E14-07 — Offline UX & Cache Security** · Trace: OFF-001, OFF-011..013
- Given أحداث معلقة, When يطلب السائق Logout, Then تحذير بعددها قبل التأكيد.
- Given التطبيق Offline, When تُفتح الشاشة الرئيسية, Then يظهر مؤشر Offline وعدد Pending وحالة كل حدث، وبيانات Offline Read Set.

# E15 — Costs (Recorded)

**US-E15-01 — Record Cost** · Trace: FIN-001, FIN-002, FIN-005, FX-001
- Given تكلفة تأمين Net 1,000 + Tax 140, When تُحفظ, Then تُخزَّن Net/Tax/Gross والعملة الأصلية، وتظهر في التقارير = 1,000 (Net).

**US-E15-02 — Single Expense Identity** · Trace: FIN-003, GEN-006
- Given تفويلة Accepted بـ800, When يُعرض تقرير التكاليف, Then يظهر مصروف وقود واحد = 800 مرتبط بالتفويلة؛ ولا يمكن إدخال Cost يدوي مكرر لنفس المصدر.

**US-E15-03 — Recorded Cost/km** · Trace: FIN-004, FIN-009
- Given تكلفة الفترة 5,000 وValid Distance 2,500 km, When يُحسب, Then 2.00/km Reliable.
- Given Valid Distance = 0 أو كل القراءات Conflict, When يُعرض, Then "Unavailable" (لا 0 ولا ∞).

# E16 — Corrections, Audit & Recalculation

**US-E16-01 — Correction Record** · Trace: AUD-001, GEN-003
- Given سجل Accepted, When يُعدَّل أي حقل, Then يُنشأ Correction (Previous، New، Reason، By، At) والقيمة الأصلية تبقى قابلة للعرض.

**US-E16-02 — Approval for Financial/Odometer** · Trace: AUD-002
- Given Correction على مبلغ تفويلة, When يطلبها Fleet Manager, Then لا تُطبَّق حتى يعتمدها Finance/Admin آخر.

**US-E16-03 — Recalculation** · Trace: AUD-003
- Given Correction معتمدة تؤثر على مارس, When تُطبَّق, Then تظهر KPIs مارس بمؤشر "Recalculating" ثم بالقيم الجديدة، مع سجل يوضح سبب التغيير.

**US-E16-04 — Data Quality on KPIs** · Trace: KPI-001, GEN-011, GEN-005
- Given KPI مبني على فترة بها قراءة Conflict, When يُعرض, Then القيمة مع علامة Partial وTooltip بالسبب.
- Given لا بيانات للفترة, When يُعرض, Then "Unavailable" وليس 0.

# E17 — Import & Onboarding

**US-E17-01 — Import Workflow** · Trace: IMP-001, IMP-002
- Given ملف مركبات فيه 3 صفوف خاطئة من 100, When يصل لـPreview, Then تُعرض الأخطاء بالصف والعمود قبل أي حفظ.

**US-E17-02 — Import Modes** · Trace: IMP-003
- Given ملف مالي به صف خاطئ, When يُعتمد, Then لا يُستورد أي صف (All-or-Nothing).
- Given ملف Master Data, When يُعتمد بوضع Partial, Then تُستورد الصفوف الصحيحة ويُصدَّر ملف بالمرفوضة.

**US-E17-03 — Opening Balances** · Trace: IMP-004
- Given Opening Odometer لمركبة, When يُستورد, Then يظهر كأول قراءة بمصدر Opening Balance ولا يُنشئ أي مصروف.

**US-E17-04 — Backdated & Rollback** · Trace: IMP-005, IMP-006
- Given نفس الملف يُرفع مرتين, When يُعالج الثاني, Then تُكتشف التكرارات ولا تُنشأ سجلات ثانية.
- Given Batch لم تُستخدم سجلاته, When يُطلب Rollback, Then تُلغى سجلاته كلها مع Audit.

# E18 — Dashboards, KPIs & Reports

**US-E18-01 — Executive Dashboard** · Trace: PRD §26.2
- Given Company Admin, When يفتح الـDashboard, Then تظهر مؤشرات Pilot مع Data Quality، وتحميل < 3 ثوانٍ (NFR-003).

**US-E18-02 — Fleet Manager Dashboard** · Trace: PRD §26.2
- Given Fleet Manager على فرعين, When يفتحه, Then الأرقام تخص فرعيه فقط وتطابق تفاصيل الـDrill-down.

**US-E18-03 — Driver Home** · Trace: PRD §26.2
- Given سائق, When يفتح التطبيق, Then يرى مركبته، حالة الأهلية وأسباب أي تحذير، Pending Sync، آخر 5 عمليات.

**US-E18-04 — KPI Dictionary Conformance** · Trace: PRD §26.1
- Given بيانات الاختبار المرجعية (Gap Analysis ملحق E), When تُحسب KPIs الـPilot, Then النتائج تطابق القيم المتوقعة بالضبط.

**US-E18-05 — Standard Reports & Export** · Trace: RPT-001..007, RPT-010
- Given تقرير بفلاتر (Period، Branch), When يُصدَّر Excel/CSV, Then الإجماليات تطابق الشاشة، ويُسجَّل Export في Audit، ولا يحتوي بيانات خارج صلاحية المستخدم.

# E19 — NFR & Operations

**US-E19-01 — Backup & Restore** · Trace: NFR-004, TEN-005
- Given Tenant, When يُنفَّذ Restore Test لنقطة زمنية, Then تُستعاد البيانات والملفات متسقة ضمن RPO ≤ 15 دقيقة وRTO ≤ 4 ساعات.

**US-E19-02 — Observability** · Trace: NFR-002, NFR-008, NFR-009
- Given فشل Sync أو Notification أو Import, When يحدث, Then يظهر في Monitoring بـTenant وسبب خلال 5 دقائق.

**US-E19-03 — Security Baseline** · Trace: NFR-001, SEC-012, NFR-005
- Given بيئة ما قبل الإنتاج, When يُنفَّذ Penetration Test, Then لا توجد ثغرات Critical/High مفتوحة.

**US-E19-04 — Consent** · Trace: PRV-001, PRV-002
- Given سائق لأول مرة, When يُطلب إذن الكاميرا/الموقع, Then تظهر شاشة توضيح ويسجَّل قراره؛ الرفض لا يمنع العمليات غير المعتمدة على الإذن.

---

# Commercial Wave — Epics (تُفصَّل قبل مرحلتها)

| Epic | Title | Trace | Stories (عناوين) |
|---|---|---|---|
| E20 | Fuel Cards & Reconciliation | CARD-001..010 | Card Master & Lifecycle · Prepaid Confirmed/Estimated Balance · Postpaid Limit & Settlement · Statement Import (Idempotent) · Auto-Match بالهوامش · Review Queue · Unmatched Provider Txn كمصروف وحيد · Offline Card Validation |
| E21 | Driver Sessions | SES-001..008 | Start/End · منع التداخل · Session Not Closed · Used/Driven Days · Unaccounted Distance · Missing Session · Handover يغلق/يفتح |
| E22 | Trips | TRP-001..006 | Create & Approve · Emergency Trip · GPS Start/End + Consent · Trip داخل Session · Trip Coverage |
| E23 | Leave & Availability | LEV-001..004 | Request & Approve · Substitute Alert · Availability % · Leave Balance |
| E24 | Cost Allocation & Period Close | FIN-006..011, AUD-004 | Daily Proration · Refund · Allocation عند Disposal · Allocated Cost/km · Period Close & Adjustments · Report Snapshots |
| E25 | Multi-Currency FX | FX-002..004 | Rates Management · Conversion بتاريخ المصروف · Missing Rate · Consolidated Report |
| E26 | Accidents & Fines | INC-001..004 | Accident Record · ربط بـWork Order والتكلفة · Fine + اقتراح السائق من Custody · Fine كمصروف وحيد |
| E27 | Inspection Checklist | INS-001..002 | Templates · تنفيذ Offline · Fail → Defect |
| E28 | Commercial Platform | TEN-008..009, CTR-003..004, SEC-008..010, ALR-006..007, NTF-002, VEH-007, ODO-011, FUEL-014, RPT-008..009, NFR-007, PRV-003..004 | Subscriptions & Limits · Tenant Termination · Country Activation Workflow · French · Cross-Tenant Identity · Custom Roles · Shared Device · SLA Calendar & Escalation · Notification Preferences · Lease Contracts · Engine Hours · Consumption Anomaly · PDF/Scheduled Reports · WCAG · Driver Data Export |

---

# Traceability Summary

- كل Story في Pilot لها Trace لمتطلب واحد على الأقل في PRD v0.2.
- متطلبات Rel = P بدون Story مستقلة لأنها مبادئ عامة تُختبر ضمن Definition of Done: GEN-001, GEN-002, GEN-009, GEN-010, CTR-004 (AR/EN).
- القرارات المفتوحة التي قد تغيّر Stories: OD-01/OD-05 (E12 Rule Catalog، E03) · OD-02 (NFR-003، حجم الـPilot) · OD-06 (E01، E19) · OD-07 (Retention).
- Acceptance Criteria إضافية للمتطلبات المضافة للـTrace:
  - **DRV-006:** Given سائق Home Branch = A, When يخصصه Fleet Manager لا يملك صلاحية على فرع المركبة B, Then يُرفض.
  - **ODO-007:** Given آخر قراءة زمنيًا Conflict, When يُعرض Current Odometer, Then = آخر قراءة Valid قبلها.
  - **DOC-009:** Given مستند ينتهي بعد 30 يومًا, When يعمل الـJob اليومي, Then يُنشأ تنبيه Expiring، ويُصعَّد مستواه عند 14 و7 أيام دون إنشاء تنبيه مكرر.
  - **NFR-005:** اختبار القبول يُنفَّذ على Android 8.0 وiOS 15 وآخر نسختين من المتصفحات الأربعة.
