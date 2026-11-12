# Product Requirements Document (PRD)
## Fleet Management SaaS Platform

**Document Version:** 0.1 — Discovery Draft  
**Document Date:** 11 November 2026  
**Product Name:** Fleet Management SaaS (Working Name)  
**Document Status:** Draft — Pending Business & Technical Sign-off  
**Initial Deployment:** One Company / One Country  
**Target Architecture:** Multi-Tenant / Multi-Country SaaS  
**Release Strategy:** First Real Customer + Controlled Pilot → Full Commercial Release

> **ملاحظة:** هذه النسخة الأصلية v0.1 محفوظة كمرجع كما وردت. النسخة المحسّنة في `PRD_v0.2.md`، وتقرير المراجعة في `PRD_Review_v0.1.md`.

---

# 1. Executive Summary

## 1.1 Product Vision

تطوير منصة Fleet Management لإدارة وتشغيل ومراقبة أساطيل المركبات، من خلال Web Dashboard وتطبيق Mobile موحد، بما يسمح للشركات بإدارة المركبات والسائقين والوقود والصيانة والتكاليف والمستندات والرحلات والجلسات التشغيلية والتنبيهات.

يجب أن توفر المنصة بيانات تشغيلية ومالية قابلة للتتبع والتحقق، وتحول التسجيلات اليومية إلى معلومات تساعد إدارة الأسطول على اتخاذ قرارات مرتبطة بالتكلفة والكفاءة والجاهزية التشغيلية.

سيبدأ المنتج بشركة واحدة في دولة واحدة، لكن هيكله الأساسي سيدعم إنشاء شركات مستقلة وإعداد دول إضافية مستقبلًا.

## 1.2 Business Problem

1. توزيع البيانات بين Excel والملفات الورقية والرسائل.
2. صعوبة التحقق من مصروفات الوقود ومطابقتها مع كروت الوقود.
3. غياب سجل صيانة موحد مرتبط بكل مركبة.
4. عدم وضوح التكلفة التشغيلية الحقيقية لكل مركبة.
5. ضعف متابعة صلاحية المستندات والرخص.
6. عدم وجود سجل موثوق لاستخدام المركبات وتسليمها بين السائقين.
7. صعوبة تتبع العمليات المسجلة أثناء انقطاع الإنترنت.
8. عدم وضوح جودة البيانات المستخدمة في التقارير.
9. صعوبة التوسع لأكثر من شركة أو دولة بدون إعادة بناء النظام.

## 1.3 Product Objectives

| Objective | Expected Outcome |
|---|---|
| Centralized Operations | مصدر موحد لبيانات الأسطول |
| Cost Visibility | تقارير تكلفة على مستوى المركبة والفرع والشركة |
| Maintenance Control | متابعة الصيانة المستحقة والمتأخرة |
| Fuel Control | تحليل الوقود والكروت والميزانيات |
| Operational Accountability | سجل استخدام المركبات والسائقين |
| Compliance Support | متابعة المستندات والأهلية التشغيلية |
| Offline Reliability | تسجيل العمليات واستعادتها بعد عودة الإنترنت |
| Decision Support | KPIs مع توضيح جودة وتغطية البيانات |
| SaaS Expansion | إضافة شركات ودول بدون إعادة تصميم الـCore |

## 1.4 Success Criteria

يُعتبر المنتج ناجحًا عندما يستطيع العميل تسجيل ومراجعة عملياته الأساسية، وتكون الحسابات المالية والتشغيلية قابلة للتحقق من الأدلة والسجلات الأصلية، مع الحفاظ على أمن البيانات وإمكانية الاسترجاع.

المستهدفات الرقمية لكل KPI تُحدد في Pilot Acceptance Baseline، ولا توجد قيم رقمية معتمدة حاليًا.

---

# 2. Product Scope

## 2.1 In Scope — Full Commercial Release

| Module | Main Capabilities |
|---|---|
| Company Administration | إعداد الشركات والفروع والمستخدمين |
| Vehicles | بيانات المركبات وحالاتها ومستنداتها |
| Drivers | بيانات السائقين والرخص والأهلية |
| Assignments | ربط السائقين بالمركبات وتاريخ التخصيص |
| Odometer | سجل موحد لقراءات العدادات |
| Fuel Management | تسجيل التفويلات وتحليل الاستهلاك |
| Fuel Cards | أرصدة وحدود ومطابقة العمليات |
| Maintenance | الصيانة الوقائية والتصحيحية والتوقعات |
| Documents | المستندات والصلاحيات والتحقق والانتهاء |
| Driver Sessions | بدء وإنهاء استخدام المركبة |
| Trip Management | إنشاء الرحلات واعتمادها وتتبع بدايتها ونهايتها |
| Leave & Availability | الإجازات والتوافر التشغيلي |
| Cost Management | تسجيل المصروفات وتوزيع التكاليف |
| Dashboards & KPIs | التحليل والتقارير ودقة البيانات |
| Alerts & SLA | التنبيهات والتذكيرات والتصعيد |
| Offline Operations | التسجيل المحلي والمزامنة |
| Import & Export | استيراد وتصدير البيانات |
| Audit & Corrections | سجل التعديلات وإعادة الحساب |
| SaaS Administration | الشركات والاشتراكات وإعداد الدول |

يمكن تعطيل الـOptional Modules للشركات التي لا تستخدمها، بدون إزالة الوظائف من نطاق المنتج التجاري.

## 2.2 Out of Scope — Initial Commercial Release

- Continuous GPS Route Tracking.
- Real-Time Vehicle Telematics.
- Advanced Dispatch Optimization.
- Trip Expenses Module.
- Payroll Management.
- Full ERP Accounting Ledger.
- Automatic Integration مع جميع Fuel Providers.
- AI/ML Predictive Maintenance.
- Advanced Multi-Level Workflow Engine.
- Hardware GPS/OBD Integration.

**Clarification:** يمكن إضافتها كـFuture Enhancements، وليست التزامات ضمن أول إصدار.

---

# 3. Target Users & Roles

## 3.1 User Roles

### Platform Administrator
- إنشاء وإدارة الـTenants.
- إدارة Country Templates.
- التحكم في إعدادات المنصة العامة.
- متابعة صحة الخدمات والاشتراكات.
- تنفيذ إجراءات دعم محدودة ومصرح بها.
- عدم الوصول الافتراضي غير المقيد لبيانات العملاء التشغيلية.

### Company Administrator
- إدارة بيانات الشركة وفروعها.
- إنشاء المستخدمين وتوزيع الصلاحيات.
- ضبط الميزانيات والسياسات التشغيلية.
- إدارة Configuration المسموح بها.
- مراجعة المستندات والاعتمادات المصرح بها.
- الاطلاع على التقارير على مستوى الشركة.

### Fleet Manager
- إدارة المركبات والسائقين في الفروع المخصصة له.
- مراجعة التفويلات والصيانة والمستندات.
- إدارة التخصيصات والرحلات والجلسات.
- معالجة التنبيهات والتعارضات ضمن الصلاحيات.
- تنفيذ التحقق أو الاعتماد وفق Permission Matrix.

يمكن إسناد أكثر من فرع لنفس Fleet Manager.

### Driver
- الوصول إلى بياناته المسموحة.
- عرض المركبة المخصصة له ومستنداتها المختارة.
- تسجيل الوقود وقراءات العداد.
- بدء وإنهاء Sessions.
- إنشاء وتحديث الرحلات عند تفعيلها.
- تسجيل بلاغات الصيانة.
- تقديم طلبات الإجازات.
- رفع الصور والإيصالات.
- العمل Offline وفق صلاحية معتمدة.

## 3.2 RBAC

يجب دعم:

- Multiple Roles per User.
- Role Switcher داخل تطبيق Mobile واحد.
- Tenant-Level Permissions.
- Branch-Level Permissions.
- Action-Level Authorization.
- Server-Side Authorization.
- Audit Logging للعمليات الحساسة.

**Proposed Rule:** الصلاحيات تُحدد حسب User + Active Role + Tenant + Assigned Branches + Action + Resource.

لا يجوز اعتبار إخفاء زر في الواجهة وسيلة كافية لمنع تنفيذ الإجراء.

---

# 4. SaaS Architecture Requirements

## 4.1 Multi-Tenancy

**Confirmed Decision: Database per Tenant.**

كل Company لها Database مستقلة.

يمكن مشاركة Application Services وAPI Infrastructure بين الشركات، مع الحفاظ على العزل الأمني.

### Functional Requirements

- إنشاء Tenant جديد من خلال Platform Administration.
- ربط كل Tenant بقاعدة بيانات محددة.
- ربط كل Tenant بـHome Region.
- Tenant Routing آمن.
- Tenant-Specific Backup.
- Tenant-Specific Monitoring.
- عزل Documents وPhotos.
- منع الوصول غير المصرح به بين الشركات.

## 4.2 Initial Deployment

- One Real Customer.
- One Active Country.
- One Tenant Database.
- Single Hosting Region.
- Shared Application Architecture.
- Mobile App + Web Dashboard.

## 4.3 Future Expansion

- Multiple Tenants.
- Multiple Countries.
- Multiple Branches.
- Multiple Hosting Regions.
- Tenant Migration.
- Country-Specific Configuration.
- Cross-Country Reporting.

**Proposed / Not Committed:** لا يلزم تنفيذ Automated Tenant Region Migration بالكامل في أول Deployment، لكن يجب تجنب القرارات التي تجعل النقل المستقبلي مستحيلًا أو مكلفًا بصورة غير ضرورية.

---

# 5. Country Configuration Management

## 5.1 Configuration Model

**Confirmed: Platform Templates + Company Configuration.**

### Platform Layer
- Supported Languages.
- Security Guardrails.
- Global Document Framework.
- Country Template Management.
- Tenant Activation Controls.

### Country Layer
- Country Code.
- Currency.
- Timezone.
- Fuel Types.
- Driving License Categories.
- Mandatory Vehicle Documents.
- Operational Eligibility Policies.
- Working Calendar.
- Compliance Restrictions.
- Data Retention Requirements.

### Company Layer
- Branch Settings.
- Fuel Budgets.
- Maintenance Policies.
- Alert Recipients.
- SLA Timing.
- Optional Modules.
- Operating Schedules.
- Company Reporting Currency.

## 5.2 Country Activation Lifecycle

**Proposed Statuses:**

Draft → Configuration Ready → Compliance Review → UAT Approved → Active.

مع إمكانية Suspended عند الحاجة.

لا يجوز اعتبار دولة جاهزة تشغيليًا لمجرد وجود إعدادات العملة واللغة.

## 5.3 Internationalization

- Arabic RTL.
- English LTR.
- French LTR.
- User-Level Language Preference.
- Local Date/Number Formatting.
- Currency-Specific Display.
- Translated Notifications.
- Translated Standard Document Labels.

---

# 6. Vehicle Management

## 6.1 Vehicle Master Data

كل مركبة تحتفظ بهوية ثابتة وتاريخ تغييراتها.

### Core Fields

- Vehicle ID.
- Internal Fleet Number.
- Registration Number.
- Country of Registration.
- Vehicle Type.
- Make / Model / Year.
- Fuel Type.
- Ownership Type.
- Branch.
- Acquisition / Operational Start Date.
- Vehicle Status.
- Current Odometer.
- Assigned Driver.
- Related Documents.

## 6.2 Vehicle Lifecycle

**Proposed States:**

Draft → Active → Temporarily Unavailable → Retired / Sold.

يجب الفصل بين Vehicle Lifecycle Status وبين Operational Readiness.

مركبة Active قد تكون Restricted أو غير متاحة مؤقتًا.

## 6.3 Branch Transfers

- حفظ تاريخ الفرع السابق.
- تسجيل تاريخ النقل.
- تحديث الفرع الحالي.
- الحفاظ على تاريخ المصروفات والعمليات.
- عدم إعادة نسبة العمليات التاريخية تلقائيًا للفرع الجديد.

---

# 7. Driver Management

## 7.1 Driver Master

- Driver ID.
- Employee/Personnel Reference.
- Name.
- Contact Details.
- Operating Country.
- Assigned Branch.
- Driving License Information.
- License Categories.
- License Expiry.
- Current Availability.
- Related Documents.
- Account Status.

## 7.2 Driver Eligibility

- وجود وسريان المستندات الإلزامية.
- توافق فئة الرخصة مع المركبة.
- القيود القانونية المعتمدة.
- القيود التشغيلية المعتمدة.

لا يجوز الخلط بين نقص البيانات وبين وجود مخالفة مثبتة.

## 7.3 Driver Account vs Driver Record

Driver Master Record منفصل عن User Account.

يمكن الاحتفاظ بالتاريخ التشغيلي للسائق وفق سياسة الاحتفاظ المعتمدة، حتى بعد تعطيل الحساب وسحب الصلاحيات.

---

# 8. Vehicle-Driver Assignment

## 8.1 Main Requirements

- ربط سائق بمركبة.
- تحديد بداية ونهاية التخصيص.
- دعم السائق البديل.
- دعم Temporary Handover.
- حفظ التاريخ الكامل للتخصيص.
- منع التخصيصات المتعارضة وفق قواعد التشغيل.
- إدارة التخصيص من Fleet Manager مخوّل.

## 8.2 Temporary Handover

- From Driver.
- To Driver.
- Vehicle.
- Handover Timestamp.
- Odometer.
- Photo.
- Notes.
- Verification Status.

يجب أن يكون للمركبة سجل تاريخي واضح يوضح من كان مسؤولًا عنها خلال كل فترة.

---

# 9. Odometer Management

## 9.1 Unified Odometer Timeline

يجب وجود مصدر موحد لقراءات العداد، حتى لو جُمعت القراءة من عمليات مختلفة.

### Sources

- Opening Balance.
- Fuel Entry.
- Driver Session.
- Trip Start/End.
- Maintenance Service.
- Manual Update.

## 9.2 Data Fields

- Vehicle ID.
- Reading.
- Event Timestamp.
- Recorded Timestamp.
- Source Type.
- Source Record ID.
- Photo if available.
- Created By.
- Validation Status.

## 9.3 Validation Rules

- عدم قبول قراءات مستحيلة أو متعارضة بصورة صامتة.
- رصد القراءات الأقل من قراءة أحدث وفق التسلسل الزمني.
- السماح بعملية Correction مصرح بها.
- التعامل مع عداد مستبدل أو ملتف وفق إجراء موثق.
- فصل وقت الواقعة عن وقت المزامنة.
- توضيح موثوقية المسافة المحسوبة.

لا يجوز إعادة ضبط سجل العداد التاريخي عند تصحيح قراءة.

---

# 10. Fuel Management

## 10.1 Fuel Entry

- Vehicle.
- Driver.
- Fuel Date/Time.
- Odometer.
- Liters.
- Total Amount.
- Currency.
- Fuel Type.
- Full / Partial Tank.
- Cash / Fuel Card.
- Receipt Photo.
- Location if available.
- Notes.

## 10.2 Fuel Validation

- Valid Vehicle Assignment.
- Required Fields.
- Positive Liters and Amount.
- Logical Odometer.
- Duplicate Detection.
- Fuel Card Validation عند استخدام Card.
- Event Time / Sync Time Tracking.

## 10.3 Fuel Consumption

**Confirmed Calculation Method: Full-to-Full.**

يُحسب الاستهلاك باستخدام دورتين موثوقتين من Full Tank، مع تضمين التفويلات الجزئية الواقعة بينهما.

Fuel Consumption (L/100 km) = Liters Used in Valid Full-to-Full Cycle ÷ Distance Between Full-Tank Readings × 100

يجب التحقق من أن حساب اللترات يشمل كل التفويلات الصحيحة في الدورة، بدون تكرار أو إدراج وقود خارج حدودها.

### Rules

- الاستهلاك مرتبط بالمركبة.
- التفويلات الجزئية لا تنتج Full-to-Full Cycle منفردة.
- عند غياب دورة صالحة، تعرض Fuel Efficiency = Unavailable.
- Purchased Liters منفصلة عن Calculated Consumption.
- البيانات المتعارضة تخفض موثوقية المؤشر أو تمنع الحساب.

---

# 11. Fuel Card Management

## 11.1 Card Types
- Prepaid.
- Postpaid / Credit.

## 11.2 Assignment Model
تحدد الشركة هل الكارت مرتبط بمركبة أم بسائق، وفق إعداد معتمد.

## 11.3 Card Master
- Card ID.
- Provider.
- Card Reference.
- Card Type.
- Assigned Entity.
- Currency.
- Status.
- Confirmed Balance / Credit Limit.
- Spending Budget.
- Validity Period.

## 11.4 Prepaid Card
- Opening Confirmed Balance.
- Top-Ups.
- Provider Transactions.
- Refuel Transactions.
- Confirmed/Estimated Balance.

**Rule:** Top-Up ليست Fuel Expense جديدة.

## 11.5 Postpaid Card
- Credit Limit.
- Credit Utilization.
- Provider Charges.
- Settlements.
- Remaining Available Credit.
- Over-Limit Alerts.

## 11.6 Reconciliation

يجب مطابقة عمليات التطبيق مع بيانات مزود الوقود باستخدام: Card Reference، Transaction Reference، Timestamp، Amount، Liters، Vehicle / Driver، Matching Status.

### Reconciliation States — Proposed
Matched / Unmatched / Conflict / Under Review / Resolved.

يجب ألا يؤدي استيراد كشف مزود الوقود إلى تكرار مصروف تفويلة موجود بالفعل.

---

# 12. Maintenance Management

## 12.1 Maintenance Types
- Preventive Maintenance.
- Corrective Maintenance.
- Accident-Related Maintenance.

## 12.2 Preventive Maintenance
يجب دعم Maintenance Templates حسب Vehicle Type/Model، مع Overrides خاصة بمركبة معينة.

Maintenance Items: Engine Oil، Filters، Brakes، Tires، Batteries، Other Configurable Items.

## 12.3 Maintenance Intervals
- Distance Based.
- Date Based.
- Combined Rule.

يجب دعم Due / Upcoming / Overdue.

## 12.4 Maintenance Visit
الزيارة الواحدة قد تتضمن عدة Maintenance Items.

Data: Vehicle، Service Date، Odometer، Workshop / Provider، Maintenance Type، Items Performed، Invoice Total، Optional Cost Breakdown، Receipt/Invoice، Notes، Completion Status.

## 12.5 Maintenance Financial Integrity
Invoice Total مطلوبة.

يمكن توزيع القيمة على Maintenance Items لأغراض التحليل، لكن لا يجوز احتساب Invoice Total وItem Costs مرتين.

## 12.6 Maintenance Forecast
يُحسب موعد الصيانة القادمة من آخر Baseline موثوق، مع استخدام معدل حركة حديث عند توفر بيانات كافية.

إذا كانت بيانات الصيانة السابقة ناقصة، يعرض النظام Unknown/Insufficient Baseline بدل إنشاء Due Date غير موثوق.

---

# 13. Document Management

## 13.1 Document Types
- Predefined Types.
- Custom Company Types.

## 13.2 Document Properties
Document ID، Related Vehicle / Driver، Document Type، Number، Issue Date، Expiry Date، Country، Attachment، Verification Status، Verification By/At، Version، Notes.

## 13.3 Verification
يمكن لـCompany Admin وAuthorized Fleet Manager تنفيذ التحقق ضمن صلاحياتهم.

## 13.4 Driver Access
السائق يرى Selected Vehicle Documents المرتبطة بتخصيصه الحالي، بحسب السياسة.

View وDownload Permissions منفصلتان.

## 13.5 Document Lifecycle
Draft / Pending Verification / Verified / Rejected / Expired / Superseded.

عند استبدال مستند، يتم الاحتفاظ بإصدار سابق وفق السياسة، بدل الكتابة فوقه بدون تاريخ.

---

# 14. Operational Readiness

## 14.1 Confirmed Decision
**Configurable by Risk.**

## 14.2 Eligibility Dimensions
1. Vehicle Eligibility.
2. Driver Eligibility.
3. Operational Availability.
4. Assignment Authorization.

## 14.3 Operational Decision Outcomes
- Allowed.
- Allowed with Warning.
- Restricted.

## 14.4 Proposed Risk Categories

| Category | Meaning |
|---|---|
| R1 | Informational |
| R2 | Administrative |
| R3 | Operational |
| R4 | Legal / Safety |

## 14.5 Mandatory Rules
- القاعدة الأكثر تقييدًا والواجبة التطبيق تحدد القرار النهائي.
- لا يمكن تجاوز Legal/Safety Restriction إلزامي.
- نقص البيانات لا يساوي Restriction تلقائيًا.
- انتهاء Assignment يمنع استخدام صلاحيتها السابقة في بدء تشغيل جديد.
- إزالة Restriction تتطلب حل السبب وإعادة تقييم الحالة.
- تسجل تغييرات السياسة والنتائج في Audit Trail.

**Open:** التفاصيل القانونية للدولة الأولى عند تحديدها.

---

# 15. Driver Sessions

## 15.1 Module Activation
Optional per Company. إذا تم تفعيل Session Management وفق سياسة الشركة، يصبح Check-In وCheck-Out جزءًا من Workflow التشغيل المطبق.

## 15.2 Start Session
Driver، Vehicle، Start Timestamp، Opening Odometer، Optional Photo، Location if permitted، Authorization Status.

## 15.3 End Session
Closing Timestamp، Closing Odometer، Optional Photo، Notes، Sync Status.

## 15.4 Rules
- دعم Sessions التي تتخطى منتصف الليل.
- منع Sessions متعارضة أو إحالتها للمراجعة.
- حفظ Offline Events.
- احتساب Used Days وDriven Days بصورة منفصلة.
- عدم تفسير غياب Session على أنه Idle Time مؤكد.
- تسجيل Handover حسب السياسة.

---

# 16. Trip Management

## 16.1 Module Activation
Optional per Company.

## 16.2 Trip Creation
Admin أو Driver حسب الصلاحية.

## 16.3 Trip Data
Vehicle، Driver، Trip Date، Purpose، Destination، Approval Status، Start/End Odometer، Start/End GPS، Trip Status، Notes.

## 16.4 Trip Approval
Configurable: Prior Approval Required / No Prior Approval Required.

يمكن جعل Purpose وDestination مطلوبين أو اختياريين وفق إعدادات الشركة.

## 16.5 GPS Scope
يسجل النظام GPS عند بداية ونهاية الرحلة فقط، إذا سمحت الصلاحيات وإعدادات الخصوصية.

لا يشمل أول Release تتبع المسار بشكل مستمر.

GPS الخاص بالموبايل لا يُعتبر دليلًا قاطعًا على الموقع الفعلي للمركبة.

## 16.6 Trip Coverage
يقارن النظام المسافات الصحيحة للرحلات مع بيانات Sessions والمسافة المسجلة.

المسافة غير المغطاة برحلة لا تعني بالضرورة Unauthorized Usage.

**Out of Scope:** Trip Expense Recording.

---

# 17. Leave & Availability

## 17.1 Leave Management
Leave Request، Leave Type، Start/End Date، Approval Status، Approver، Notes.

## 17.2 Availability
يُحسب التوافر التشغيلي وفق: Leave، Assignments، Active Sessions، Vehicle Maintenance Unavailability، Working Schedule.

## 17.3 Leave Balance
Optional per Company. لا يعتبر النظام Payroll أو HR Management System كاملًا.

---

# 18. Cost Management

## 18.1 Cost Categories
Fuel، Preventive Maintenance، Corrective Maintenance، Insurance، Licensing، Rental / Lease، Fines، Other Configurable Costs.

## 18.2 Recorded Cost View
يعرض التكاليف وفق تاريخ التكلفة أو الخدمة المعتمد.

## 18.3 Allocated Cost View
يوزع التكاليف الدورية على فترات الاستفادة منها. أمثلة: Annual Insurance، Rental Coverage، Periodic Licensing Costs، وفق السياسة.

## 18.4 Proposed Allocation Rule
Daily Proration بناءً على Coverage Start/End.

## 18.5 Financial Integrity
- Recorded Cost وAllocated Cost منظوران لنفس المصروفات.
- Allocation لا تنشئ Expense إضافية.
- Payment Date منفصل عن Expense Date.
- Fuel Card Top-Up ليست Fuel Expense.
- Card Settlement لا تُضاعف Provider Charges.
- لا يجوز جمع Total Invoice مع Cost Breakdown مرة ثانية.

## 18.6 Cost/km
Cost per km = Applicable Operating Cost During Period ÷ Valid Distance During Same Period

يجب فصل Recorded Cost/km وAllocated Cost/km.

إذا كانت المسافة غير متاحة أو غير موثوقة، لا يتم عرض مؤشر مضلل.

لا يُعتبر هذا المؤشر Full TCO ما لم تدخل جميع مكونات التكلفة وفق منهجية معتمدة.

---

# 19. Multi-Currency

## 19.1 Requirements
Original Amount، Original Currency، Company Reporting Currency، Exchange Rate، Rate Date، Rate Source، Conversion Policy Version.

## 19.2 Consolidated Reporting
يتم تحويل المبالغ وفق سياسة FX معتمدة، مع الحفاظ على القيم الأصلية. لا يجوز جمع عملات مختلفة مباشرة.

## 19.3 Historical Reports
تحتفظ التقارير المنشورة بمراجع أسعار الصرف المستخدمة. إذا تغيّرت أسعار الصرف أو البيانات، يتم إصدار نسخة مصححة أو إعادة حساب وفق سياسة Versioning.

**Open:** FX Provider، Rate Selection Date، Missing Rate Handling، Historical Rate Correction Rules.

---

# 20. Alerts & Notification Management

## 20.1 Notification Channels
In-App، Mobile Push، Configurable Email.

## 20.2 Alert Categories
Document Expiry، Maintenance Due/Overdue، Fuel Budget Exceeded، Fuel Card Balance/Credit Limit، Odometer Conflict، Missing Sessions، Pending Trip Approvals، Leave Approvals، Operational Restrictions، Offline Sync Conflicts.

## 20.3 Ownership
كل Alert له Primary Owner محدد، ويمكن تعيين Escalation Owner.

## 20.4 Alert Status
Proposed: Open / Acknowledged / In Progress / Resolved / Closed. Escalated Flag منفصلة عن Status.

## 20.5 SLA
**Confirmed: Configurable Calendar / Business Hours.** يدعم: Acknowledgement SLA، Resolution SLA، Reminder Timing، One-Level Escalation — Proposed، Company/Country/Branch Calendar، Severity-Based Rules.

## 20.6 Rules
- Acknowledged لا تعني Resolved.
- إرسال التنبيه لا يعني استلامه أو قراءة محتواه.
- لا تُنشأ تنبيهات مكررة لنفس السبب المفتوح.
- التصعيد لا يزيل الـOperational Restriction.
- Critical Safety Alerts تخضع لقواعد استجابة معتمدة قد تتطلب Calendar-Time Handling.

---

# 21. Offline-First Operations

## 21.1 Confirmed Strategy
Last Verified Eligibility.

## 21.2 Offline Functions
Start/End Session، Fuel Entry، Trip Start/End، Odometer Update، Maintenance Report، Photo Capture. تخضع كل وظيفة لصلاحيات المستخدم ونطاق Offline المسموح. Management Approvals تتطلب اتصالًا بالسيرفر في الإصدار الأول.

## 21.3 Offline Authorization
User Identity، Tenant، Assignment، Vehicle، Last Verified Eligibility، Credential Validity، Platform Security Maximum، Country/Company Restrictions.

## 21.4 Sync
Unique Event ID، Event Timestamp، Sync Timestamp، Retry Mechanism، Idempotency، Duplicate Protection، Conflict Detection، Audit Trail.

## 21.5 Conflict Resolution
يتم عرض التعارض على Authorized Fleet Manager أو Company Admin. لا يجوز استخدام Last Write Wins بصورة صامتة. يجب الاحتفاظ بالبيانات الأصلية، وتوثيق القرار، وإعادة حساب المؤشرات المتأثرة.

## 21.6 Expired Offline Authorization
عند انتهاء الصلاحية، يُمنع بدء عمليات جديدة تحتاج تصريحًا صالحًا، مع الإبقاء على آلية آمنة لتسجيل إغلاق العمليات القائمة وإرسال البيانات المعلقة.

**Open:** Platform Maximum + Country Override Policy والقيم الفعلية.

---

# 22. Data Quality & Historical Recalculation

## 22.1 Data Quality Status
يجب إظهار موثوقية البيانات بصورة منفصلة عن قيمة المؤشر. Proposed Statuses: Reliable / Estimated / Partial / Unavailable. ويفضل فصل Calculation Status عن Data Coverage.

## 22.2 Data Corrections
Record ID، Previous Value، Corrected Value، Reason، Changed By، Changed At، Approval if required، Affected Periods.

## 22.3 Historical KPI Recalculation
1. تحديد الفترات المتأثرة.
2. إعادة الحسابات المطلوبة.
3. تحديث Live Dashboard.
4. الاحتفاظ بتاريخ التغيير.
5. حفظ نسخ Published Reports.
6. توضيح سبب اختلاف الأرقام.

## 22.4 Data Integrity
لا يجوز اعتبار Missing Data مساوية للصفر. لا يجوز احتساب نفس Financial Transaction مرتين. لا يجوز استخدام قراءة عداد متعارضة في KPI موثوقة دون معالجة.

---

# 23. Dashboards & Analytics

## 23.1 Executive Dashboard
Total Vehicles، Active Vehicles، Restricted Vehicles، Available Vehicles، Total Operating Cost، Fuel Cost، Maintenance Cost، Cost/km، Open Alerts، Overdue Maintenance، Data Quality Coverage.

## 23.2 Fleet Manager Dashboard
Vehicles by Branch، Current Assignments، Documents Expiring، Pending Verifications، Maintenance Due/Overdue، Fuel Spend، Fuel Cards، Open Sessions، Pending Approvals، Sync Conflicts.

## 23.3 Vehicle 360 View
Master Details، Assignment History، Odometer Timeline، Fuel Entries، Fuel Efficiency، Maintenance History، Documents، Sessions، Trips، Operating Costs، Alerts.

## 23.4 KPI Dictionary

| KPI | Definition |
|---|---|
| Fuel Consumption | L/100 km من Valid Full-to-Full Cycles |
| Fuel Cost/km | Fuel Cost ÷ Valid Distance |
| Recorded Cost/km | Recorded Operating Cost ÷ Valid Distance |
| Allocated Cost/km | Allocated Operating Cost ÷ Valid Distance |
| Maintenance Overdue | بنود الصيانة التي تجاوزت تاريخ/مسافة الاستحقاق |
| Vehicle Used Days | أيام استخدام وفق قواعد Session المعتمدة |
| Driven Days | الأيام المثبت فيها حركة من سجلات صالحة |
| Card Matching Coverage | Matched Eligible Card Transactions ÷ Total Eligible Transactions |
| Alert SLA Compliance | Alerts Meeting Applicable SLA ÷ Applicable Alerts |
| Data Coverage | السجلات أو الفترات المغطاة ببيانات صالحة ÷ إجمالي نطاق القياس |

التعريفات التفصيلية للـDenominators والـExceptions والـDate Boundaries تحتاج اعتماد في KPI Dictionary.

---

# 24. Data Import & Onboarding

## 24.1 Import Sources
Excel، CSV، Manual Entry.

## 24.2 Import Workflow
Upload → Mapping → Preview → Validation → Error Review → Approval → Import → Audit.

## 24.3 Opening Balance
Opening Odometer، Current Assignment، Maintenance Baseline، Confirmed Fuel Card Balance، Existing Documents، Existing Operational Status. يجب الفصل بين Opening Balance وبين Historical Financial Transaction.

## 24.4 Backdated Records
التحقق من التكرار، الحفاظ على Event Date، ربط السجلات الأصلية، إعادة حساب المؤشرات المتأثرة، تسجيل Import Batch ID.

---

# 25. Data Model — Conceptual

## 25.1 Platform Entities
Tenant، Tenant Region Assignment، Country Template، Country Policy Version، Platform User Identity، Subscription / Plan، Platform Audit.

## 25.2 Tenant Operational Entities
Company، Country Operations، Branch، User Membership، Role، Permission، Vehicle، Driver، Assignment، Odometer Event، Fuel Entry، Fuel Card، Fuel Card Transaction، Fuel Reconciliation، Maintenance Template، Maintenance Item، Maintenance Visit، Document Type، Document Record، Driver Session، Trip، Leave Request، Availability Record، Financial Cost، Cost Allocation، Alert، SLA Policy، Notification Event، Offline Event، Conflict Review، Import Batch، Audit Event، Published Report Snapshot.

## 25.3 Data Model Principles
Immutable identifiers، Historical relationships، Effective-dated configurations، Auditability، Separation of Event Time and Recorded Time، Clear source references، No silent overwrites، Referential Integrity، Tenant-Level Separation، Explicit Data Quality Status.

ده Conceptual Data Model، وليس Physical Database Schema.

---

# 26. Non-Functional Requirements

## 26.1 Security
Strong Authentication، Role-Based Access Control، Server-Side Authorization، Encrypted Transport، Encryption at Rest، Secure File Storage، Secrets Management، Audit Logging، Tenant Isolation Testing، Secure Offline Storage، Session/Token Management.

## 26.2 Reliability
Durable Server-Side Event Processing، Retryable Sync، Idempotent Operations، Recovery Monitoring، Data Consistency Validation، Backup Verification.

## 26.3 Performance
يجب تحديد Performance Targets بعد معرفة حجم أول شركة: Concurrent Users، Active Vehicles، Driver Events per Day، Average Photo Size، Expected API Volume، Reporting Period، Historical Data Volume. لا توجد قيم Performance معتمدة حاليًا.

## 26.4 Backup & Recovery
Tenant-Specific Backup، Encrypted Backup، Restore Testing، Database/File Consistency، Recovery Procedures، Offline Event Protection. **Open:** RPO وRTO.

## 26.5 Scalability
Tenants، Vehicles، Drivers، Branches، Countries، Storage، Transactions — بدون افتراض أن Multiple Regions مطلوبة من أول تشغيل.

## 26.6 Observability
Application Monitoring، Database Health، Sync Failures، Notification Failures، Import Failures، Backup Status، Security Events، Tenant-Level Diagnostics.

## 26.7 Accessibility & Usability
Mobile Driver Tasks بسيطة، Clear Error Messages، Arabic RTL / English & French LTR، Camera-Based Input، Minimal Required Fields، Offline/Online Status Visible، Pending Sync Indicator، Clear Data Validation Feedback.

---

# 27. Privacy & Data Retention

## 27.1 Data Categories
Personal Identity Data، Driver License Documents، Vehicle Records، GPS Start/End، Financial Transactions، Operational History، Audit Records، Offline Cache.

## 27.2 Retention Framework
Legal Requirements، Contractual Requirements، Purpose Limitation، Data Minimization، Access Restrictions، Deletion/Archiving، Data Export.

## 27.3 Data Hosting
**Confirmed:** Single Region Initially, Region-Ready.

## 27.4 Data Residency
Hosting Location، Backup Location، Processing Location، Cross-Border Transfers، Third-Party Services، Data Access Permissions.

## 27.5 Tenant Termination
Proposed: Subscription Termination → Authorized Data Export → Retention Review → Deletion/Restricted Archiving → Audit Evidence. **Open:** Legal Retention Durations وHosting Region Selection.

---

# 28. Pilot Operating Model

## 28.1 Confirmed Strategy
First Real Customer + Pilot.

## 28.2 Pilot Objectives
Validation of Core Workflows، Verification of Financial Accuracy، Offline Reliability Testing، Driver Usability Validation، Maintenance & Fuel Workflow Validation، Access Control Testing، Alert & SLA Validation، Business Acceptance.

## 28.3 Pilot Stages
- **Stage 1 — Preparation:** Company Configuration، Fleet Inventory، Driver Setup، Document Upload، Opening Balances، Training، Acceptance Baseline.
- **Stage 2 — Controlled Live Operation:** Actual Driver Operations، Fuel Recording، Maintenance Updates، Sessions and Trips if enabled، Offline Testing، Error Handling، Feedback Collection.
- **Stage 3 — Reconciliation:** Compare Source Records، Resolve Data Errors، Verify Costs، Verify Odometer/KPIs، Test Corrections، Validate Reports.
- **Stage 4 — Acceptance:** Review Test Evidence، Evaluate Critical Defects، Customer Sign-off، Technical Sign-off، Go/No-Go Decision.

## 28.4 Pilot Cutover Mode
**Open Decision:** Direct Cutover / Parallel Run then Cutover / Shadow Pilot. **Recommendation (not confirmed):** Parallel Run then Cutover، مع تحديد System of Record واضح أثناء التشغيل المزدوج.

## 28.5 Pilot Success KPIs
Import Accuracy، Driver Adoption، Offline Sync Success، Duplicate Prevention، Financial Reconciliation، Data Quality Coverage، SLA Compliance، Critical Defect Closure، Restore Test Success، Permission Test Success. **Open:** Required Thresholds.

---

# 29. Acceptance Criteria

- **G1 — Data Readiness:** اكتمال البيانات الأساسية، عدم وجود تكرارات مؤثرة غير محلولة، Opening Odometer موثوق أو توضيح نقصه، صحة Current Assignments، تصنيف المستندات والتحقق منها.
- **G2 — Operational Validation:** تسجيل التفويلات، تسجيل الصيانة، متابعة العداد، Sessions وTrips وLeave حسب نطاق التفعيل، تجربة السواق والإدارة، معالجة الأخطاء التشغيلية.
- **G3 — Security & Data Integrity:** Tenant Isolation، RBAC، عدم فقد الأحداث المؤكدة، عدم تكرار العمليات بعد Retry/Sync، توثيق Corrections، التعامل الصحيح مع Restrictions.
- **G4 — Financial & Analytical Validation:** مطابقة التكاليف، عدم Double Counting، صحة Full-to-Full، صحة Cost Allocation، صحة Cost/km، ظهور Data Quality Status، صحة Historical Recalculation.
- **G5 — Business & Operational Acceptance:** Customer Approval، Training Completion، Support Process Ready، Backup/Restore Tested، Critical Issues Closed، Full Commercial Scope Verified.

### No-Go Conditions
Unauthorized Data Access، Material Data Loss، Duplicate Financial Accounting، Mandatory Safety Restriction Bypass، Critical Calculation Integrity، Unacceptable Recovery Failure، Applicable Compliance Requirements.

---

# 30. Product Dependencies & Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Poor Master Data | تقارير غير موثوقة | Import Validation + Opening Balance |
| Driver Resistance | ضعف Adoption | Simplified UX + Training |
| Offline Conflicts | تضارب العمليات | Unique Events + Conflict Review |
| Wrong Odometer | أخطاء Fuel/Maintenance KPIs | Unified Timeline + Validation |
| Financial Double Counting | تقارير تكلفة خاطئة | Expense Identity + Reconciliation |
| Complex Country Configuration | زيادة التطوير والدعم | Controlled Templates |
| Database per Tenant Overhead | زيادة التشغيل والتكلفة | Automated Provisioning |
| Regional Data Restrictions | منع تشغيل بعض الأسواق | Country Activation Gate |
| Missing FX Rates | تقارير مالية ناقصة | Versioned FX Policy |
| Unverified Maintenance Baseline | Forecast غير موثوق | Data Status + Baseline Collection |
| Incomplete Pilot Coverage | ثغرات بعد الإطلاق | Scenario-Based UAT |
| Full Scope Delivery Complexity | تأخر التطوير | Module-Based Delivery + Acceptance Gates |

---

# 31. Release Strategy

- **Phase A — Requirements & Design:** Approve PRD، Business Rules Sign-off، Data Dictionary، Permission Matrix، Architecture، Test Strategy.
- **Phase B — Platform Foundation:** Authentication، Tenant Provisioning، Company/Branch Setup، Roles & Permissions، Vehicle/Driver Master، Document Framework، Audit Infrastructure.
- **Phase C — Core Operations:** Odometer، Fuel، Maintenance، Assignment، Offline Sync، Validation.
- **Phase D — Operational & Financial Modules:** Fuel Cards، Sessions، Trips، Leave، Availability، Cost Management، Alerts/SLA.
- **Phase E — Analytics & Governance:** Dashboards، KPIs، Historical Recalculation، Financial Allocation، Reporting، Imports/Exports، Country Configuration Validation.
- **Phase F — Controlled Pilot & Full Acceptance:** Pilot Preparation، Live Operations، Reconciliation، UAT، Security/Recovery Testing، Customer Sign-off، Go/No-Go.

**Important:** ترتيب المراحل هنا للتخطيط، وليس جدولًا زمنيًا معتمدًا.

---

# 32. Open Decisions Register

| ID | Decision | Priority | Status |
|---|---|---|---|
| OD-01 | First Operating Country | Critical before country activation | Open |
| OD-02 | First Customer Fleet Profile | Critical before pilot sizing | Open |
| OD-03 | Pilot Cutover Mode | Critical | Open |
| OD-04 | Offline Security Maximum Policy & Duration | Critical | Open |
| OD-05 | Country Legal Eligibility Rules | Critical before live activation | Open |
| OD-06 | Data Hosting Region | Critical before production | Open |
| OD-07 | Data Retention Periods | High | Open |
| OD-08 | Backup RPO/RTO | High | Open |
| OD-09 | FX Provider & Conversion Policy | High | Open |
| OD-10 | Cost Allocation Exceptions | High | Open |
| OD-11 | Pilot Acceptance Thresholds | Critical | Open |
| OD-12 | Support & Incident SLA | High | Open |
| OD-13 | Performance & Capacity Targets | High | Open |
| OD-14 | Commercial Pricing & Packaging | High before commercial launch | Open |
| OD-15 | Country Activation Approval Process | High | Proposed |
| OD-16 | Tenant Migration Procedure | Future-dependent | Proposed |
| OD-17 | Detailed RBAC Matrix | Critical before development | Open |
| OD-18 | Detailed KPI Dictionary | High | Open |

---

# 33. Requirements Traceability

كل Requirement عند تحويلها إلى Epics وUser Stories تُربط بـ: PRD Requirement ID، Business Objective، Module، Priority، Business Rule، Data Entities، Dependencies، Acceptance Criteria، Test Evidence، Change History.

**Proposed IDs:** ADM، VEH، DRV، ASN، ODO، FUEL، CARD، MNT، DOC، OPS، SES، TRP، LEV، FIN، ALR، OFF، KPI، TEN، CTR، SEC، PIL.

---

# 34. Final Product Positioning

الميزة الأساسية: Operational Traceability، Financial Cost Visibility، Reliable Vehicle KPIs، Controlled Driver Operations، Offline-First Data Collection، Configurable Country Operations، Secure Multi-Tenant Expansion.

---

# 35. Approval Status

| Approval Area | Status |
|---|---|
| Business Vision | Defined |
| Functional Scope | Discovery Confirmed |
| Initial Deployment Strategy | Confirmed |
| Tenant Database Model | Confirmed |
| Country Configuration Strategy | Confirmed |
| Security & Offline Details | Pending |
| Detailed Data Model | Pending Technical Design |
| NFR Targets | Pending |
| Pilot Acceptance Thresholds | Pending |
| Commercial Pricing | Pending |
| Final PRD Sign-off | Not Approved |

**Next Required Milestone:** PRD Review & Baseline Approval.
