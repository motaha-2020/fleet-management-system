# Progress — Fleet Management SaaS

**آخر تحديث:** 12 Nov 2026 · **آخر دمج في `main`:** PR #1 (M0–M2) · **المرجع:** `Backlog_Epics_Stories_v0.3.md`, `Architecture_v0.1.md` §14

> هذا الملف يُحدَّث مع نهاية كل Milestone. الحالة تُقاس على **Acceptance Criteria** في الـBacklog: لو جزء من الـAC غير منفّذ (مثلًا التنبيه) تكون الحالة 🟡 حتى لو باقي القصة شغال.

**المفتاح:** ✅ منفّذ ومختبَر · 🟡 جزئي (المتبقي مذكور) · ⬜ لم يبدأ

---

## 1. الملخص

| | العدد | النسبة |
|---|---|---|
| ✅ منفّذ | 46 | 47% |
| 🟡 جزئي | 12 | 12% |
| ⬜ لم يبدأ | 40 | 41% |
| **إجمالي Stories (Pilot)** | **98** | (بدون US-E02-08 الملغاة) |

### الـMilestones

| Milestone | الحالة | المحتوى |
|---|---|---|
| **M0 — Walking Skeleton** | ✅ مدموج | Monorepo + CI + Local Stack، Provisioning، Login، مركبة من الويب تظهر في الموبايل |
| **M1 — Foundation** | ✅ مدموج | E01–E06, E11 + MFA + Audit |
| **M2 — Core Ledgers** | ✅ مدموج | E07–E09, E15, E16 |
| **M3 — Offline** | ⬜ التالي | E14: Outbox، Sync، Offline Grant، Conflict Queue، Photos |
| **M4 — Maintenance & Readiness** | ⬜ | E10, E12 |
| **M5 — Control & Insight** | ⬜ | E13, E17, E18, E29 (+ ما تأجّل من M1/M2 ويعتمد على التنبيهات) |
| **M6 — Hardening** | ⬜ | E19 → Pilot Wave 0 |

### الاختبارات (CI على `main`)

| المجموعة | العدد |
|---|---|
| Domain (منها Worked Examples E1, E3 كـGolden Tests) | 65 |
| API Integration على PostgreSQL حقيقي (اختبار أو أكثر لكل Story، منها E5) | 49 |
| RBAC Matrix — كل خلية (6 أدوار × 35 إجراء) عبر الـAPI | 211 |
| TOTP (متجهات RFC 6238) | 3 |
| Provisioning / Tenant Isolation | 6 |
| Contracts | 4 |
| **الإجمالي** | **338** |

> سيناريوهات المتصفح (Playwright) لـM0 وM1 وM2 كاملة تمت يدويًا ولم تُضف للـCI بعد.

---

## 2. الحالة لكل Story

### E01 — Tenancy & Platform Admin
| Story | الحالة | ملاحظات |
|---|---|---|
| US-E01-01 Provision Tenant | ✅ | قاعدة + Role لكل شركة، Idempotent، الفشل يُسجَّل بالخطوة والسبب |
| US-E01-02 Tenant Isolation | ✅ | الـTenant من التوكن فقط؛ Role الشركة لا يتصل بقاعدة غيرها؛ اختبارات عبر الـAPI |
| US-E01-03 Suspend / Reactivate | ✅ | Suspended = قراءة فقط. الـQuarantine للأحداث الـOffline مع M3 |
| US-E01-04 Managed Schema Migration | ✅ | `pnpm db:migrate` بتقرير لكل Tenant؛ الفشل يرجع للإصدار السابق ولا يوقف الباقي |

### E02 — Authentication & RBAC
| Story | الحالة | ملاحظات |
|---|---|---|
| US-E02-01 Admin Login with MFA | ✅ | TOTP إجباري للـPlatform/Company Admin، قفل بعد 5 محاولات، خروج بعد 30 دقيقة خمول |
| US-E02-02 Driver Login (Activation Code) | 🟡 | الكود لمرة واحدة/24 ساعة، القفل، إلغاء الجهاز القديم، تعطيل الحساب ✅ · **ناقص:** PIN/Biometric، دخول Offline، مسح الـCache عن بعد (M3) |
| US-E02-03 Manage Users & Roles | ✅ | دعوة بدور وفروع، Role Switcher |
| US-E02-04 Enforce RBAC Matrix | ✅ | 211 اختبار مولَّد من `packages/config` |
| US-E02-05 Maker ≠ Checker | ✅ | في الـAPI + CHECK في القاعدة (مستندات، تفويلات، تصحيحات) |
| US-E02-06 Break-Glass | ⬜ | — |
| US-E02-07 Sensitive Action Audit | ✅ | Audit Append-only في كل شركة + Platform Audit |
| ~~US-E02-08 WhatsApp OTP~~ | — | ملغاة بقرار المالك |

### E03 — Company, Branches & Country Config
| Story | الحالة | ملاحظات |
|---|---|---|
| US-E03-01 Company & Branch Setup | 🟡 | الفرع بمنطقة زمنية وأيام عطلة ✅، وتاريخ مصروف الوقود بتوقيت الفرع · **ناقص:** تقارير مجمّعة بتوقيت كل فرع (ملخص التكلفة حاليًا بتوقيت الشركة) |
| US-E03-02 Apply Country Template | ✅ | الشركة تشدد ولا تخفف المستندات الإلزامية |
| US-E03-03 Effective-dated Policy | ⬜ | لا توجد Policies قابلة للتعديل بعد؛ تأتي مع Readiness (M4) |

### E04 — Vendors
| Story | الحالة | ملاحظات |
|---|---|---|
| US-E04-01 Manage Vendors | ✅ | — |

### E05 — Vehicles
| Story | الحالة | ملاحظات |
|---|---|---|
| US-E05-01 Create Vehicle | ✅ | التكرار يحدد المركبة المتعارضة؛ قيود في القاعدة |
| US-E05-02 Lifecycle & Availability | 🟡 | Lifecycle ✅ ومنع تخصيص مركبة غير نشطة ✅ · **ناقص:** Availability المحسوبة (تحتاج Work Orders — M4) |
| US-E05-03 Branch Transfer | ✅ | سجل نقل؛ تحذير الـAssignments المتأثرة لم يُعرض بعد |
| US-E05-04 Dispose Vehicle | ✅ | منع الأحداث بعد تاريخ الاستبعاد · الأحداث الـOffline → Conflict Review مع M3 |
| US-E05-05 Vehicle 360 | 🟡 | بيانات، مستندات، عهدة، عداد، وقود، تكاليف ✅ · **ناقص:** الصيانة والتنبيهات (M4/M5) |

### E06 — Drivers
| Story | الحالة | ملاحظات |
|---|---|---|
| US-E06-01 Create Driver & Link Account | ✅ | — |
| US-E06-02 Employment Status | ✅ | Suspended → Restricted بسبب واضح |
| US-E06-03 Eligibility Re-evaluation | 🟡 | الأهلية تُحسب عند العرض ✅ · **ناقص:** Job يومي + Alert واحد (M5) |
| US-E06-04 Sensitive Personal Data | ✅ | تشفير بمفتاح الشركة، عرض مُقنَّع، إظهار بصلاحية مع Audit |

### E07 — Assignments & Handover
| Story | الحالة | ملاحظات |
|---|---|---|
| US-E07-01 Create Assignment | ✅ | Exclusion Constraints في القاعدة؛ فئة الرخصة بدون Override |
| US-E07-02 End / Backdate | ✅ | إعادة نسبة التفويلات + Audit |
| US-E07-03 Handover | ✅ | المستلم لازم مخصص ومؤهل؛ القراءة تدخل الـTimeline |
| US-E07-04 Custody Timeline | ✅ | الفجوات تظهر صراحة |

### E08 — Odometer
| Story | الحالة | ملاحظات |
|---|---|---|
| US-E08-01 Unified Timeline | ✅ | — |
| US-E08-02 Detect Conflict | 🟡 | Conflict محفوظ ومستبعد من الـKPIs ✅ · **ناقص:** إنشاء Alert (M5) |
| US-E08-03 Daily Distance Warning | ✅ | — |
| US-E08-04 Corroborating Readings | ✅ | — |
| US-E08-05 Meter Replacement | ✅ | — |
| US-E08-06 Correct Reading | ✅ | Maker/Checker؛ الأصل يبقى Corrected |

### E09 — Fuel
| Story | الحالة | ملاحظات |
|---|---|---|
| US-E09-01 Record Fuel Entry (Mobile) | 🟡 | من التطبيق بصورة الإيصال، الكاش يُمنع بدونها ✅ · **ناقص:** حالة Pending Sync (M3) |
| US-E09-02 Tank Capacity Check | 🟡 | +5% مقبول وأكثر = Conflict ✅ · **ناقص:** Alert (M5) |
| US-E09-03 Duplicate Detection | ✅ | لا تُحتسب في التكلفة حتى القرار |
| US-E09-04 Fuel Type & Price Warnings | ✅ | — |
| US-E09-05 Entry Without Valid Assignment | ✅ | Under Review بدل الرفض |
| US-E09-06 Review / Void | ✅ | طلب التصحيح من السائق متاح في الـAPI؛ شاشة الموبايل له لم تُبنَ |
| US-E09-07 Full-to-Full Consumption | ✅ | Worked Example E1 = 10.0 L/100km |
| US-E09-08 Fuel Budget | ⬜ | يعتمد على التنبيهات (M5) |
| US-E09-09 Bi-Fuel | ✅ | دورات منفصلة لكل نوع، سعة خزان الغاز |
| US-E09-10 Official Fuel Price Table | ✅ | ±2% بالسعر الساري وقت الواقعة |

### E10 — Maintenance & Work Orders · ⬜ (M4)
US-E10-01 … US-E10-08 — لم تبدأ.

### E11 — Documents
| Story | الحالة | ملاحظات |
|---|---|---|
| US-E11-01 Document Types | ✅ | — |
| US-E11-02 Upload & Verify | ✅ | فحص النوع من البايتات، حد 10 MB، Maker ≠ Checker |
| US-E11-03 Validity vs Verification | ✅ | — |
| US-E11-04 Supersede | ✅ | — |
| US-E11-05 Driver Access | ✅ | العرض غير التحميل؛ Audit لكل تحميل |

### E12 — Operational Readiness · ⬜ (M4)
US-E12-01 … US-E12-04 — لم تبدأ.

### E13 — Alerts & Notifications · ⬜ (M5)
US-E13-01 … US-E13-04 — لم تبدأ.

### E14 — Offline & Sync · ⬜ (M3 — التالي)
US-E14-01 … US-E14-07 — لم تبدأ. (إنشاء التفويلة والقراءات Idempotent بالـid من الآن، وهو أساس US-E14-02.)

### E15 — Costs (Recorded)
| Story | الحالة | ملاحظات |
|---|---|---|
| US-E15-01 Record Cost | ✅ | Net/Tax/Gross + العملة |
| US-E15-02 Single Expense Identity | ✅ | UNIQUE في القاعدة |
| US-E15-03 Recorded Cost/km | ✅ | Worked Example E3 = Unavailable |
| US-E15-04 Tax Treatment per Category | ✅ | ⚖️ تحتاج مراجعة ضريبية |
| US-E15-05 Tolls & e-Invoice | ✅ | — |

### E16 — Corrections, Audit & Recalculation
| Story | الحالة | ملاحظات |
|---|---|---|
| US-E16-01 Correction Record | ✅ | — |
| US-E16-02 Approval for Financial/Odometer | ✅ | المالي للمالية/الأدمن وغير المالي لمدير الأسطول |
| US-E16-03 Recalculation | 🟡 | الـKPIs تُحسب من الـLedgers فيظهر التصحيح فورًا، والفترة المتأثرة محفوظة · **ناقص:** Snapshots ومؤشر "Recalculating" (M5) |
| US-E16-04 Data Quality on KPIs | ✅ | Reliable / Partial / Unavailable للاستهلاك والتكلفة/كم |

### E17 — Import & Onboarding · ⬜ (M5)
US-E17-01 … US-E17-04 — لم تبدأ. (رصيد العداد الافتتاحي متاح يدويًا.)

### E18 — Dashboards, KPIs & Reports
| Story | الحالة | ملاحظات |
|---|---|---|
| US-E18-01 Executive Dashboard | ⬜ | — |
| US-E18-02 Fleet Manager Dashboard | ⬜ | — |
| US-E18-03 Driver Home | 🟡 | المركبات المخصصة وآخر التفويلات ✅ · **ناقص:** الأهلية، المستندات، Pending Sync |
| US-E18-04 KPI Dictionary Conformance | ⬜ | — |
| US-E18-05 Standard Reports & Export | 🟡 | سجل المراجعة (RPT-007) وملخص التكلفة/كم ✅ · **ناقص:** باقي التقارير والتصدير |

### E19 — NFR & Operations
| Story | الحالة | ملاحظات |
|---|---|---|
| US-E19-01 Backup & Restore | ⬜ | — |
| US-E19-02 Observability | ⬜ | — |
| US-E19-03 Security Baseline | 🟡 | اختبارات العزل والصلاحيات ✅ · **ناقص:** Pen Test، Rate Limiting لكل IP، فحص كلمات السر المسرّبة |
| US-E19-04 Consent | ⬜ | — |
| US-E19-05 Low-end Android Performance | ⬜ | — |

### E29 — Traffic Fines (Egypt) · ⬜ (M5)
US-E29-01 … US-E29-03 — لم تبدأ.

---

## 3. لازم يخلص قبل الـPilot (بغض النظر عن الـMilestone)

| البند | الحالة |
|---|---|
| ربط الجهاز بمفتاح + PIN/Biometric + Offline Grant | M3 |
| إرسال الدعوات والتنبيهات بالإيميل (الروابط تظهر لمن يدعو حاليًا) | ⬜ |
| Rate Limiting لكل IP | ⬜ |
| فحص كلمات السر المسرّبة (D-SEC-PWD) | ⬜ |
| أكواد استرجاع للتحقق بخطوتين | ⬜ |
| تجربة التخزين على S3/Hetzner Object Storage فعليًا | ⬜ (الاختبارات على القرص المحلي) |
| بناء صور Docker وتشغيلها | ⬜ (لم تُبنَ — لا Docker في بيئة التطوير) |
| تجربة التطبيق على Android حقيقي (والكاميرا) | ⬜ (جُرّب كنسخة ويب فقط) |
| Backup/Restore Drill على Hetzner | ⬜ (M6) |
| مراجعة البنود ⚖️ (الضرائب، المستندات الإلزامية، الإقامة) مع مستشار مصري | ⬜ |

## 4. قرارات اتخذت أثناء التنفيذ

موثّقة بالتفصيل في `Architecture_v0.1.md` تحت "M0 / M1 / M2 Implementation Notes". أهمها:

- العقد بـZod 4 بدل ts-rest (ADR-008 معدّل)، وTypeScript 5.9 بدل 7.
- الـKPIs تُحسب عند العرض من الـLedgers؛ الـSnapshots في M5.
- رفع وتحميل الملفات عبر الـAPI (لتسجيل كل تحميل) بدل Presigned URLs حاليًا.
- السائق يسجل تفويلة لمركبة في فرعه بدون تخصيص → مراجعة، لا رفض.
- التأمين اعتُبرت ضريبته قابلة للاسترداد لتطابق US-E15-01 ⚖️.
