# Progress — Fleet Management SaaS

**آخر تحديث:** 12 Nov 2026 · **آخر دمج في `main`:** PR #5 (M4) · **المرجع:** `Backlog_Epics_Stories_v0.3.md`, `Architecture_v0.1.md` §14, `M3_Offline_Design.md`

> هذا الملف يُحدَّث مع نهاية كل Milestone. الحالة تُقاس على **Acceptance Criteria** في الـBacklog: لو جزء من الـAC غير منفّذ (مثلًا التنبيه) تكون الحالة 🟡 حتى لو باقي القصة شغال.

**المفتاح:** ✅ منفّذ ومختبَر ومدموج في `main` · 🟡 جزئي (المتبقي مذكور) · ⬜ لم يبدأ

---

## 1. الملخص

| | العدد | النسبة |
|---|---|---|
| ✅ منفّذ | 66 | 67% |
| 🟡 جزئي | 11 | 11% |
| ⬜ لم يبدأ | 21 | 21% |
| **إجمالي Stories (Pilot)** | **98** | (بدون US-E02-08 الملغاة) |

### الـPRs

| PR | الحالة | المحتوى |
|---|---|---|
| [#1](https://github.com/motaha-2020/fleet-management-system/pull/1) | ✅ مدموج | M0–M2 |
| [#2](https://github.com/motaha-2020/fleet-management-system/pull/2) | ✅ مدموج | Staging على Hetzner: صور api/worker/web على GHCR، Compose + Caddy، Script نشر برجوع تلقائي |
| [#3](https://github.com/motaha-2020/fleet-management-system/pull/3) | ✅ مدموج | M3: Offline Grant، `/sync/events`، حل التعارضات، رفع الصور على أجزاء، Outbox مشفّر، مفتاح الجهاز + PIN/بصمة، تحديثات OTA للتطبيق |
| [#4](https://github.com/motaha-2020/fleet-management-system/pull/4) | ✅ مدموج | ملف متابعة التقدم `docs/PROGRESS.md` |
| [#5](https://github.com/motaha-2020/fleet-management-system/pull/5) | ✅ مدموج | M4: الصيانة وأوامر الشغل والجاهزية التشغيلية (E10, E12) |

### الـMilestones

| Milestone | الحالة | المحتوى |
|---|---|---|
| **M0 — Walking Skeleton** | ✅ مدموج | Monorepo + CI + Local Stack، Provisioning، Login، مركبة من الويب تظهر في الموبايل |
| **M1 — Foundation** | ✅ مدموج | E01–E06, E11 + MFA + Audit |
| **M2 — Core Ledgers** | ✅ مدموج | E07–E09, E15, E16 |
| **M3 — Offline** | ✅ مدموج | E14 كاملة + مفتاح الجهاز + PIN/بصمة |
| **M4 — Maintenance & Readiness** | ✅ مدموج | E10, E12 |
| **M5 — Control & Insight** | ⬜ التالي | E13, E17, E18, E29 (+ ما تأجّل من M1/M2 ويعتمد على التنبيهات) |
| **M6 — Hardening** | ⬜ | E19 → Pilot Wave 0 |

### الاختبارات (CI على `main`، واتشغلت محليًا على نفس النسخة)

| المجموعة | العدد |
|---|---|
| Domain (منها Worked Examples E1, E3 كـGolden Tests، وقواعد M3 وM4) | 95 |
| API Integration على PostgreSQL حقيقي (اختبار أو أكثر لكل Story، منها E5) | 73 |
| RBAC Matrix — كل خلية (6 أدوار × 45 إجراء) عبر الـAPI | 271 |
| TOTP (متجهات RFC 6238) | 3 |
| Provisioning / Tenant Isolation | 6 |
| Contracts | 4 |
| **الإجمالي** | **452** |

> سيناريوهات المتصفح (Playwright) لـM0 وM1 وM2 وM4 (الويب) كاملة تمت يدويًا ولم تُضف للـCI بعد. تطبيق الموبايل من M3 لا يعمل كـExpo Web (SecureStore/SQLCipher على الجهاز فقط)، فشاشات M4 في التطبيق (بلاغ العطل، الجاهزية) اتراجعت بالـTypecheck فقط، ومسار البلاغ Offline + رفع الصورة مختبَر عبر الـAPI.

---

## 2. الحالة لكل Story

### E01 — Tenancy & Platform Admin
| Story | الحالة | ملاحظات |
|---|---|---|
| US-E01-01 Provision Tenant | ✅ | قاعدة + Role لكل شركة، Idempotent، الفشل يُسجَّل بالخطوة والسبب |
| US-E01-02 Tenant Isolation | ✅ | الـTenant من التوكن فقط؛ Role الشركة لا يتصل بقاعدة غيرها؛ اختبارات عبر الـAPI |
| US-E01-03 Suspend / Reactivate | ✅ | Suspended = قراءة فقط |
| US-E01-04 Managed Schema Migration | ✅ | `pnpm db:migrate` بتقرير لكل Tenant؛ الفشل يرجع للإصدار السابق ولا يوقف الباقي |

### E02 — Authentication & RBAC
| Story | الحالة | ملاحظات |
|---|---|---|
| US-E02-01 Admin Login with MFA | ✅ | TOTP إجباري للـPlatform/Company Admin، قفل بعد 5 محاولات، خروج بعد 30 دقيقة خمول |
| US-E02-02 Driver Login (Activation Code) | ✅ | الكود لمرة واحدة/24 ساعة، القفل، إلغاء الجهاز القديم ✅ · مفتاح في عتاد الموبايل، PIN 6 أرقام + بصمة اختيارية، دخول Offline، ومسح البيانات عند إلغاء الجهاز أو تعطيل الحساب (M3) |
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
| US-E05-02 Lifecycle & Availability | ✅ | Lifecycle ✅؛ الـAvailability تُحسب من الجاهزية (أمر شغل غير صالحة للقيادة، بلاغ لم يُراجع) — M4 |
| US-E05-03 Branch Transfer | ✅ | سجل نقل؛ تحذير الـAssignments المتأثرة لم يُعرض بعد |
| US-E05-04 Dispose Vehicle | ✅ | منع الأحداث بعد تاريخ الاستبعاد |
| US-E05-05 Vehicle 360 | 🟡 | بيانات، مستندات، عهدة، عداد، وقود، تكاليف، صيانة وجاهزية ✅ · **ناقص:** التنبيهات (M5) |

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
| US-E09-01 Record Fuel Entry (Mobile) | ✅ | بصورة الإيصال (تُضغط ≤ 500 KB)، الكاش يُمنع بدونها، وحالة Pending Sync في الـOutbox (M3) |
| US-E09-02 Tank Capacity Check | 🟡 | +5% مقبول وأكثر = Conflict ✅ · **ناقص:** Alert (M5) |
| US-E09-03 Duplicate Detection | ✅ | لا تُحتسب في التكلفة حتى القرار |
| US-E09-04 Fuel Type & Price Warnings | ✅ | — |
| US-E09-05 Entry Without Valid Assignment | ✅ | Under Review بدل الرفض |
| US-E09-06 Review / Void | ✅ | طلب التصحيح من السائق متاح في الـAPI؛ شاشة الموبايل له لم تُبنَ |
| US-E09-07 Full-to-Full Consumption | ✅ | Worked Example E1 = 10.0 L/100km |
| US-E09-08 Fuel Budget | ⬜ | يعتمد على التنبيهات (M5) |
| US-E09-09 Bi-Fuel | ✅ | دورات منفصلة لكل نوع، سعة خزان الغاز |
| US-E09-10 Official Fuel Price Table | ✅ | ±2% بالسعر الساري وقت الواقعة |

### E10 — Maintenance & Work Orders · ✅ (M4)
| Story | الحالة | ملاحظات |
|---|---|---|
| US-E10-01 Templates & Overrides | ✅ | القالب الأكثر تحديدًا (ماركة + موديل) ينطبق؛ فترة خاصة بالمركبة لا تغيّر القالب ولا باقي المركبات |
| US-E10-02 Due Status (Combined) | ✅ | كم أو شهور أيهما أسبق؛ Upcoming قبل 500 كم / 14 يوم؛ على مقياس العداد التراكمي |
| US-E10-03 Forecast with Weak Baseline | ✅ | بدون تنفيذ سابق = Unknown؛ Baseline على قراءة Conflict = Estimated؛ التوقع من متوسط آخر 30 يوم |
| US-E10-04 Driver Defect Report | 🟡 | البلاغ Online وOffline (`defect.report`) والصورة ترفع على أجزاء؛ الرفض بسبب إلزامي ✅ · **ناقص:** تنبيه مدير الأسطول وإبلاغ السائق بالرفض (M5)، وتجربة الشاشة على جهاز |
| US-E10-05 Work Order Lifecycle | ✅ | البلاغ يتحول لأمر شغل واحد ويُربطان؛ الإغلاق بدون زيارة مكتملة يطلب سببًا |
| US-E10-06 Not-Drivable Restriction | ✅ | R4 بدون استثناء حتى الإكمال/الإلغاء؛ التوقف من Off-Road لـReturn to Service |
| US-E10-07 Maintenance Visit & Invoice | ✅ | الإجمالي إلزامي للإكمال؛ التفصيل أكبر من الإجمالي يُرفض؛ "غير موزّع" يظهر؛ تكلفة واحدة `source = maintenance` |
| US-E10-08 Baseline Update | 🟡 | الزيارة المكتملة تحدّث Baseline البنود المنفذة (بالعداد والتاريخ) وتسجل القراءة في الدفتر · **ناقص:** إغلاق تنبيه Overdue (التنبيهات M5) |

### E11 — Documents
| Story | الحالة | ملاحظات |
|---|---|---|
| US-E11-01 Document Types | ✅ | — |
| US-E11-02 Upload & Verify | ✅ | فحص النوع من البايتات، حد 10 MB، Maker ≠ Checker |
| US-E11-03 Validity vs Verification | ✅ | — |
| US-E11-04 Supersede | ✅ | — |
| US-E11-05 Driver Access | ✅ | العرض غير التحميل؛ Audit لكل تحميل |

### E12 — Operational Readiness · ✅ (M4)
| Story | الحالة | ملاحظات |
|---|---|---|
| US-E12-01 Rule Catalog | ✅ | الكتالوج كبيانات في `packages/config`؛ الشركة ترفع المستوى ولا تخفضه |
| US-E12-02 Evaluate Readiness | ✅ | كل الأسباب مع مستواها؛ الأشد يحسم؛ التخصيص والتسليم يُمنعان عند Restricted، والتفويلة تُقبل بعلامة `vehicle_restricted`؛ السائق يرى الجاهزية في الـRead Set |
| US-E12-03 Override | ✅ | R2/R3 فقط، بسبب وتاريخ انتهاء ≤ 30 يوم، يعود القيد تلقائيًا، قابل للإلغاء، Audit؛ R4 مرفوض لأي دور |
| US-E12-04 Missing Data vs Violation | ✅ | المستند الاختياري لا يقيّد؛ الإلزامي الناقص = R2 افتراضيًا وقابل للرفع حتى R4؛ يزول عند التحقق (التقييم لحظي) |

### E13 — Alerts & Notifications · ⬜ (M5)
US-E13-01 … US-E13-04 — لم تبدأ.

### E14 — Offline & Sync · ✅ (M3)
| Story | الحالة | ملاحظات |
|---|---|---|
| US-E14-01 Offline Authorization Window | ✅ | Grant موقّع لـ72 ساعة يُحسب بالساعة الـMonotonic؛ اتجربت على Android حقيقي (تغيير الساعة 3 ساعات ماأثرش) |
| US-E14-02 Idempotent Sync | ✅ | الحدث يتخزن مرة ويرجع نفس النتيجة؛ اتصلح كمان تكرار القراءة اليدوية عند إعادة الإرسال |
| US-E14-03 Clock Integrity | ✅ | `clock_drift` للمراجعة مع حفظ الوقتين |
| US-E14-04 Ordering & Dependencies | ✅ | التطبيق بترتيب `device_seq`، والانتظار عند فجوة، و`sequence_gap` بعد 7 أيام |
| US-E14-05 Photos After Text | ✅ | النص أولًا، ضغط الصورة ≤ 500 KB، رفع على أجزاء يكمل بعد الانقطاع |
| US-E14-06 Conflict Review | ✅ | Queue + قبول/رفض/تصحيح بسبب، بدون Last-Write-Wins؛ صفحة على الويب |
| US-E14-07 Offline UX & Cache Security | ✅ | SQLCipher، مؤشر Offline، عدد المعلّق وحالة كل حدث، تحذير عند الخروج بعدد المعلّق |

> اللي موثّق إنه اتجرب على Android حقيقي: الساعة الـMonotonic وSQLCipher (Spike في `M3_Offline_Design.md`). تجربة المسار كامل (Outbox → Sync → صور) على جهاز غير موثّقة في الريبو.

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
| US-E18-03 Driver Home | 🟡 | المركبات المخصصة، آخر العمليات وحالتها، مؤشر الاتصال وعدد المعلّق ✅ · **ناقص:** حالة الأهلية والمستندات |
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
| ربط الجهاز بمفتاح + PIN/Biometric | ✅ M3 |
| بناء صور Docker ونشر Staging | ✅ PR #2 (الإنتاج لسه) |
| إرسال الدعوات والتنبيهات بالإيميل (الروابط تظهر لمن يدعو حاليًا) | ⬜ |
| Rate Limiting لكل IP | ⬜ |
| فحص كلمات السر المسرّبة (D-SEC-PWD) | ⬜ |
| أكواد استرجاع للتحقق بخطوتين | ⬜ |
| تجربة التخزين على S3/Hetzner Object Storage فعليًا | ⬜ (الاختبارات على القرص المحلي) |
| تجربة التطبيق على Android حقيقي | 🟡 Spike الساعة + SQLCipher اتجرب؛ المسار كامل (تفويلة بالكاميرا Offline ثم مزامنة) غير موثّق |
| Backup/Restore Drill على Hetzner | ⬜ (M6) |
| مراجعة البنود ⚖️ (الضرائب، المستندات الإلزامية، الإقامة) مع مستشار مصري | ⬜ |

## 4. قرارات اتخذت أثناء التنفيذ

موثّقة بالتفصيل في `Architecture_v0.1.md` تحت "M0 / M1 / M2 Implementation Notes". أهمها:

- العقد بـZod 4 بدل ts-rest (ADR-008 معدّل)، وTypeScript 5.9 بدل 7.
- الـKPIs تُحسب عند العرض من الـLedgers؛ الـSnapshots في M5.
- رفع وتحميل الملفات عبر الـAPI (لتسجيل كل تحميل) بدل Presigned URLs حاليًا.
- السائق يسجل تفويلة لمركبة في فرعه بدون تخصيص → مراجعة، لا رفض.
- التأمين اعتُبرت ضريبته قابلة للاسترداد لتطابق US-E15-01 ⚖️.
- M3: قرارات التصميم ونتيجة الـSpike والاختلافات عن التصميم الأول في `docs/M3_Offline_Design.md`.
- M4: الجاهزية تُحسب لحظيًا عند كل نقطة تطبيق (بدون جدول مُخزَّن)؛ "بلاغ غير صالحة للقيادة لم يُراجع" = R3؛ المستند الإلزامي الناقص R2 افتراضيًا. التفاصيل في "M4 Implementation Notes".
