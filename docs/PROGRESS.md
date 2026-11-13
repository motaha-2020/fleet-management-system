# Progress — Fleet Management SaaS

**آخر تحديث:** 13 Nov 2026 · **آخر دمج في `main`:** PR #10 (Expo Web للتطوير) · **المرجع:** `Backlog_Epics_Stories_v0.3.md`, `Architecture_v0.1.md` §14, `M3_Offline_Design.md`

> هذا الملف يُحدَّث مع نهاية كل Milestone. الحالة تُقاس على **Acceptance Criteria** في الـBacklog: لو جزء من الـAC غير منفّذ (مثلًا التنبيه) تكون الحالة 🟡 حتى لو باقي القصة شغال.

**المفتاح:** ✅ منفّذ ومختبَر ومدموج في `main` · 🟡 جزئي (المتبقي مذكور) · ⬜ لم يبدأ

---

## 1. الملخص

| | العدد | النسبة |
|---|---|---|
| ✅ منفّذ | 89 | 91% |
| 🟡 جزئي | 8 | 8% |
| ⬜ لم يبدأ | 1 | 1% |
| **إجمالي Stories (Pilot)** | **98** | (بدون US-E02-08 الملغاة) |

### الـPRs

| PR | الحالة | المحتوى |
|---|---|---|
| [#1](https://github.com/motaha-2020/fleet-management-system/pull/1) | ✅ مدموج | M0–M2 |
| [#2](https://github.com/motaha-2020/fleet-management-system/pull/2) | ✅ مدموج | Staging على Hetzner: صور api/worker/web على GHCR، Compose + Caddy، Script نشر برجوع تلقائي |
| [#3](https://github.com/motaha-2020/fleet-management-system/pull/3) | ✅ مدموج | M3: Offline Grant، `/sync/events`، حل التعارضات، رفع الصور على أجزاء، Outbox مشفّر، مفتاح الجهاز + PIN/بصمة، تحديثات OTA للتطبيق |
| [#4](https://github.com/motaha-2020/fleet-management-system/pull/4) | ✅ مدموج | ملف متابعة التقدم `docs/PROGRESS.md` |
| [#5](https://github.com/motaha-2020/fleet-management-system/pull/5) | ✅ مدموج | M4: الصيانة وأوامر الشغل والجاهزية التشغيلية (E10, E12) |
| [#6](https://github.com/motaha-2020/fleet-management-system/pull/6) | ✅ مدموج | M5: التنبيهات والإشعارات، ميزانية الوقود، المخالفات، لوحات المتابعة والتقارير، الاستيراد |
| [#7](https://github.com/motaha-2020/fleet-management-system/pull/7) | ✅ مدموج | M6: أمان الدخول، دخول الدعم الفني، المراقبة، موافقة السائق، النسخ الاحتياطي والاسترجاع |
| [#8](https://github.com/motaha-2020/fleet-management-system/pull/8) | ✅ مدموج | إشعارات Push للسائقين (Expo Push) |
| [#9](https://github.com/motaha-2020/fleet-management-system/pull/9) | ✅ مدموج | السياسات بتاريخ سريان (US-E03-03) |
| [#10](https://github.com/motaha-2020/fleet-management-system/pull/10) | ✅ مدموج | تطبيق السائق كـExpo Web للتطوير فقط (بدون تشفير)؛ التخزين الآمن وSQLCipher على الموبايل كما هما |
| [#11](https://github.com/motaha-2020/fleet-management-system/pull/11) | ✅ مدموج | تحديث ملف المتابعة بدمج PR #9 |

### الـMilestones

| Milestone | الحالة | المحتوى |
|---|---|---|
| **M0 — Walking Skeleton** | ✅ مدموج | Monorepo + CI + Local Stack، Provisioning، Login، مركبة من الويب تظهر في الموبايل |
| **M1 — Foundation** | ✅ مدموج | E01–E06, E11 + MFA + Audit |
| **M2 — Core Ledgers** | ✅ مدموج | E07–E09, E15, E16 |
| **M3 — Offline** | ✅ مدموج | E14 كاملة + مفتاح الجهاز + PIN/بصمة |
| **M4 — Maintenance & Readiness** | ✅ مدموج | E10, E12 |
| **M5 — Control & Insight** | ✅ مدموج | E13, E17, E18, E29 + ميزانية الوقود وما تأجّل من M1/M2/M4 |
| **M6 — Hardening** | ✅ مدموج (جزء الكود) | E19 + Break-Glass + أمان الدخول · المتبقي يحتاج سيرفر/جهاز/جهة خارجية قبل Pilot Wave 0 |

### الاختبارات (CI على `main`، واتشغلت محليًا على نفس النسخة)

| المجموعة | العدد |
|---|---|
| Domain (منها Worked Examples E1, E3 كـGolden Tests، وقواعد M3–M6 وقاموس المؤشرات) | 106 |
| API Integration على PostgreSQL حقيقي (اختبار أو أكثر لكل Story، منها E5) | 97 |
| RBAC Matrix — كل خلية (6 أدوار × 55 إجراء) عبر الـAPI | 331 |
| TOTP (متجهات RFC 6238) + Rate Limit + سياسة كلمات السر | 5 |
| Provisioning / Tenant Isolation | 6 |
| Contracts | 4 |
| **الإجمالي** | **549** |

> تجربة استرجاع (PITR) بنفس سكربتات النسخ الاحتياطي ناجحة محليًا — التفاصيل في `docs/Runbook_Backup_Restore.md`.

> سيناريوهات المتصفح (Playwright) لـM0 وM1 وM2 وM4 وM5 وM6 (الويب) كاملة تمت يدويًا ولم تُضف للـCI بعد. تطبيق الموبايل بقى يشتغل كـExpo Web للتطوير فقط (PR #10: بدون تشفير، والتخزين على الويب يرفض العمل خارج `__DEV__`)، لكن شاشات M4 في التطبيق (بلاغ العطل، الجاهزية) اتراجعت بالـTypecheck فقط ولم تُجرَّب بعد على الويب ولا على جهاز، ومسار البلاغ Offline + رفع الصورة مختبَر عبر الـAPI.

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
| US-E02-06 Break-Glass | ✅ | بدون Grant لا وصول؛ طلب بسبب → موافقة مدير الشركة → جلسة قراءة فقط تنتهي بعد 24 ساعة أو بالإلغاء فورًا؛ كل صفحة تُفتح تُسجَّل في سجل مراجعة العميل |
| US-E02-07 Sensitive Action Audit | ✅ | Audit Append-only في كل شركة + Platform Audit |
| ~~US-E02-08 WhatsApp OTP~~ | — | ملغاة بقرار المالك |

### E03 — Company, Branches & Country Config
| Story | الحالة | ملاحظات |
|---|---|---|
| US-E03-01 Company & Branch Setup | 🟡 | الفرع بمنطقة زمنية وأيام عطلة ✅، وتاريخ مصروف الوقود بتوقيت الفرع · **ناقص:** تقارير مجمّعة بتوقيت كل فرع (ملخص التكلفة حاليًا بتوقيت الشركة) |
| US-E03-02 Apply Country Template | ✅ | الشركة تشدد ولا تخفف المستندات الإلزامية |
| US-E03-03 Effective-dated Policy | ✅ | حدود الوقود والعداد كسياسات للشركة بتاريخ سريان (نسخ Append-only)؛ كل سجل يتقيّم بالقيمة السارية وقت حدوثه؛ التاريخ الماضي يحتاج قرارًا صريحًا ويعيد حساب التفويلات غير المراجَعة مع Audit |

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
| US-E05-05 Vehicle 360 | ✅ | بيانات، مستندات، عهدة، عداد، وقود، تكاليف، صيانة وجاهزية، تنبيهات المركبة |

### E06 — Drivers
| Story | الحالة | ملاحظات |
|---|---|---|
| US-E06-01 Create Driver & Link Account | ✅ | — |
| US-E06-02 Employment Status | ✅ | Suspended → Restricted بسبب واضح |
| US-E06-03 Eligibility Re-evaluation | ✅ | المسح اليومي ينشئ تنبيهًا واحدًا لرخصة السائق (30/14/7 يوم ثم منتهية) ويرفع مستواه بدل التكرار |
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
| US-E08-02 Detect Conflict | ✅ | Conflict محفوظ ومستبعد من الـKPIs، وتنبيه لكل قراءة Conflict يُحل تلقائيًا عند التصحيح |
| US-E08-03 Daily Distance Warning | ✅ | — |
| US-E08-04 Corroborating Readings | ✅ | — |
| US-E08-05 Meter Replacement | ✅ | — |
| US-E08-06 Correct Reading | ✅ | Maker/Checker؛ الأصل يبقى Corrected |

### E09 — Fuel
| Story | الحالة | ملاحظات |
|---|---|---|
| US-E09-01 Record Fuel Entry (Mobile) | ✅ | بصورة الإيصال (تُضغط ≤ 500 KB)، الكاش يُمنع بدونها، وحالة Pending Sync في الـOutbox (M3) |
| US-E09-02 Tank Capacity Check | 🟡 | +5% مقبول وأكثر = Conflict ويدخل قائمة المراجعة ✅ · **ناقص:** نوع تنبيه مستقل للتفويلة المتعارضة |
| US-E09-03 Duplicate Detection | ✅ | لا تُحتسب في التكلفة حتى القرار |
| US-E09-04 Fuel Type & Price Warnings | ✅ | — |
| US-E09-05 Entry Without Valid Assignment | ✅ | Under Review بدل الرفض |
| US-E09-06 Review / Void | ✅ | طلب التصحيح من السائق متاح في الـAPI؛ شاشة الموبايل له لم تُبنَ |
| US-E09-07 Full-to-Full Consumption | ✅ | Worked Example E1 = 10.0 L/100km |
| US-E09-08 Fuel Budget | ✅ | ميزانية شهرية (شركة/فرع/مركبة) بالمبلغ و/أو اللترات مقابل التفويلات المقبولة؛ تنبيه واحد يرتفع من 80% إلى 100%؛ انحراف الميزانية في لوحة المتابعة |
| US-E09-09 Bi-Fuel | ✅ | دورات منفصلة لكل نوع، سعة خزان الغاز |
| US-E09-10 Official Fuel Price Table | ✅ | ±2% بالسعر الساري وقت الواقعة |

### E10 — Maintenance & Work Orders · ✅ (M4)
| Story | الحالة | ملاحظات |
|---|---|---|
| US-E10-01 Templates & Overrides | ✅ | القالب الأكثر تحديدًا (ماركة + موديل) ينطبق؛ فترة خاصة بالمركبة لا تغيّر القالب ولا باقي المركبات |
| US-E10-02 Due Status (Combined) | ✅ | كم أو شهور أيهما أسبق؛ Upcoming قبل 500 كم / 14 يوم؛ على مقياس العداد التراكمي |
| US-E10-03 Forecast with Weak Baseline | ✅ | بدون تنفيذ سابق = Unknown؛ Baseline على قراءة Conflict = Estimated؛ التوقع من متوسط آخر 30 يوم |
| US-E10-04 Driver Defect Report | 🟡 | البلاغ Online وOffline والصورة على أجزاء؛ تنبيه مدير الأسطول فورًا (مسح بعد البلاغ)؛ الرفض بسبب يصل للسائق داخل التطبيق ✅ · **ناقص:** تجربة الشاشة على جهاز |
| US-E10-05 Work Order Lifecycle | ✅ | البلاغ يتحول لأمر شغل واحد ويُربطان؛ الإغلاق بدون زيارة مكتملة يطلب سببًا |
| US-E10-06 Not-Drivable Restriction | ✅ | R4 بدون استثناء حتى الإكمال/الإلغاء؛ التوقف من Off-Road لـReturn to Service |
| US-E10-07 Maintenance Visit & Invoice | ✅ | الإجمالي إلزامي للإكمال؛ التفصيل أكبر من الإجمالي يُرفض؛ "غير موزّع" يظهر؛ تكلفة واحدة `source = maintenance` |
| US-E10-08 Baseline Update | ✅ | الزيارة المكتملة تحدّث Baseline البنود المنفذة وتسجل القراءة، وتنبيه Overdue يُحل تلقائيًا في المسح التالي |

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

### E13 — Alerts & Notifications · ✅ (M5)
| Story | الحالة | ملاحظات |
|---|---|---|
| US-E13-01 Generate & Dedup | ✅ | المسح اليومي (عملية `jobs`) يحسب الأسباب القائمة ويطابقها: تنبيه واحد لكل سبب (Unique Index)، والتصعيد 30→14→7 على نفس التنبيه |
| US-E13-02 Lifecycle & Ownership | ✅ | Open → Acknowledged → In Progress → Resolved → Closed؛ المسؤول حسب الدور والفرع، والرجوع لمدير الشركة لو المسؤول غير متاح |
| US-E13-03 Auto-Resolve | ✅ | زوال السبب (مستند جديد موثّق، زيارة، تحويل البلاغ…) = Resolved تلقائيًا مع Audit |
| US-E13-04 Channels | 🟡 | إيميل بلغة المستخدم، Push للسائق (Expo Push: توكن لكل جهاز، التوكن الملغي يُحذف تلقائيًا) + داخل التطبيق، وسجل الإرسال بالحالة والمحاولات والخطأ ✅ · **ناقص:** بيانات FCM/APNs في EAS + Build جديد وتجربة على جهاز، وإعداد SMTP في الـStaging |

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

### E17 — Import & Onboarding · ✅ (M5)
| Story | الحالة | ملاحظات |
|---|---|---|
| US-E17-01 Import Workflow | ✅ | قالب رسمي لكل كيان؛ CSV/Excel؛ ربط الأعمدة بالاسم؛ الأخطاء بالصف والعمود في المعاينة قبل أي حفظ |
| US-E17-02 Import Modes | ✅ | التكاليف والمخالفات كلها أو لا شيء في Transaction واحدة؛ البيانات الأساسية جزئي مع ملف بالصفوف المرفوضة |
| US-E17-03 Opening Balances | ✅ | رصيد العداد الافتتاحي كأول قراءة (Opening) بدون مصروف · رصيد Baseline الصيانة والتخصيص يدويًا من الشاشات |
| US-E17-04 Backdated & Rollback | ✅ | نفس الملف مرتين يُكتشف، والتكرارات بالصف؛ التراجع عن دفعة غير مستخدمة (تكاليف، مخالفات، أرصدة عداد) مع Audit · البيانات الأساسية لا يُتراجع عنها (لا حذف) |

### E18 — Dashboards, KPIs & Reports
| Story | الحالة | ملاحظات |
|---|---|---|
| US-E18-01 Executive Dashboard | ✅ | المركبات (متاحة/مقيّدة)، التكاليف، تكلفة/كم، التنبيهات، الصيانة المتأخرة، تغطية البيانات، مع جودة كل مؤشر؛ < 3 ثوانٍ في الاختبار |
| US-E18-02 Fleet Manager Dashboard | ✅ | نفس الأرقام مقصورة على فروع المدير وتطابق تقرير التفاصيل (مختبَر) |
| US-E18-03 Driver Home | ✅ | المركبة، الجاهزية وأسبابها، الإشعارات، المعلّق، آخر 5 عمليات (شاشة الموبايل بالـTypecheck) |
| US-E18-04 KPI Dictionary Conformance | ✅ | Golden Tests لأمثلة E1 وE3 ولكل معادلة في القاموس؛ المقام صفر = غير متاح |
| US-E18-05 Standard Reports & Export | ✅ | RPT-001..007 + المخالفات؛ فلاتر الفترة والفرع وفئة المركبة؛ Excel/CSV بنفس إجماليات الشاشة؛ Audit لكل تصدير؛ داخل صلاحية المستخدم فقط |

### E19 — NFR & Operations
| Story | الحالة | ملاحظات |
|---|---|---|
| US-E19-01 Backup & Restore | 🟡 | WAL مستمر (RPO ثوانٍ) + Base Backup يومي واحتفاظ 35 يوم + نسخة الملفات؛ النتيجة في صفحة المراقبة؛ تجربة PITR ناجحة محليًا بنفس السكربتات · **ناقص:** نفس التجربة على Hetzner بحجم حقيقي، ونسخة خارج السيرفر (Storage Box) |
| US-E19-02 Observability | ✅ | فشل المزامنة/الإيميل/الاستيراد/المهام/أخطاء الخادم/قفل الحسابات يُسجَّل فورًا بالشركة والسبب + سطر Log منظّم؛ صفحة "المراقبة" لمدير المنصة مع آخر نسخة احتياطية |
| US-E19-03 Security Baseline | 🟡 | العزل والصلاحيات، Rate Limit لكل IP، Security Headers، كلمات السر الشائعة/المسرّبة (HIBP k-anonymity)، أكواد استرجاع MFA ✅ · **ناقص:** Pen Test خارجي قبل الإنتاج |
| US-E19-04 Consent | 🟡 | شرح قبل طلب إذن الكاميرا، القرار يُحفظ على الجهاز ويُرسل مع المزامنة، الرفض يترك اختيار صورة من المعرض؛ سجل الموافقات لكل سائق في الـAPI ✅ · **ناقص:** تجربة على جهاز |
| US-E19-05 Low-end Android Performance | ⬜ | يحتاج جهاز Android بـ2 GB RAM |

### E29 — Traffic Fines (Egypt) · ✅ (M5)
| Story | الحالة | ملاحظات |
|---|---|---|
| US-E29-01 Record Fine | ✅ | السائق المقترح من العهدة وقت المخالفة ويُؤكَّد يدويًا؛ بدون عهدة → اختيار يدوي؛ رقم المخالفة المكرر يُرفض (يدوي واستيراد) |
| US-E29-02 Fine as Cost | ✅ | تكلفة واحدة بفئة المخالفات؛ تغيير السداد لا ينشئ تكلفة؛ الإلغاء يلغي التكلفة |
| US-E29-03 Unpaid Fines Before Renewal | ✅ | تنبيه واحد بالإجمالي لو رخصة التسيير تنتهي خلال 30 يومًا وفيه مخالفات غير مسددة؛ يُحل بالسداد |

---

## 3. لازم يخلص قبل الـPilot (بغض النظر عن الـMilestone)

| البند | الحالة |
|---|---|
| ربط الجهاز بمفتاح + PIN/Biometric | ✅ M3 |
| بناء صور Docker ونشر Staging | ✅ PR #2 (الإنتاج لسه) |
| إرسال الدعوات والتنبيهات بالإيميل | 🟡 الدعوات والتنبيهات بالإيميل جاهزة؛ تحتاج إعداد SMTP في الـStaging (`SMTP_URL`) |
| Rate Limiting لكل IP | ✅ M6 (20 محاولة دخول/دقيقة، 600 طلب/دقيقة) |
| فحص كلمات السر المسرّبة (D-SEC-PWD) | ✅ M6 (يُفعَّل في الإنتاج؛ يحتاج وصول لـapi.pwnedpasswords.com) |
| أكواد استرجاع للتحقق بخطوتين | ✅ M6 |
| تجربة التخزين على S3/Hetzner Object Storage فعليًا | ⬜ (الاختبارات على القرص المحلي) |
| تجربة التطبيق على Android حقيقي | 🟡 Spike الساعة + SQLCipher اتجرب؛ المسار كامل (تفويلة بالكاميرا Offline ثم مزامنة) غير موثّق |
| Backup/Restore Drill على Hetzner | 🟡 السكربتات وخدمات النشر جاهزة والتجربة نجحت محليًا؛ التشغيل على Hetzner + نسخة خارج السيرفر لسه |
| Penetration Test خارجي | ⬜ |
| تجربة الأداء على Android بـ2 GB RAM | ⬜ |
| مراجعة البنود ⚖️ (الضرائب، المستندات الإلزامية، الإقامة) مع مستشار مصري | ⬜ |

## 4. قرارات اتخذت أثناء التنفيذ

موثّقة بالتفصيل في `Architecture_v0.1.md` تحت "M0 / M1 / M2 Implementation Notes". أهمها:

- العقد بـZod 4 بدل ts-rest (ADR-008 معدّل)، وTypeScript 5.9 بدل 7.
- الـKPIs تُحسب عند العرض من الـLedgers (بدون Snapshots؛ الأداء كافٍ لحجم الـPilot).
- رفع وتحميل الملفات عبر الـAPI (لتسجيل كل تحميل) بدل Presigned URLs حاليًا.
- السائق يسجل تفويلة لمركبة في فرعه بدون تخصيص → مراجعة، لا رفض.
- التأمين اعتُبرت ضريبته قابلة للاسترداد لتطابق US-E15-01 ⚖️.
- M3: قرارات التصميم ونتيجة الـSpike والاختلافات عن التصميم الأول في `docs/M3_Offline_Design.md`.
- M4: الجاهزية تُحسب لحظيًا عند كل نقطة تطبيق (بدون جدول مُخزَّن)؛ "بلاغ غير صالحة للقيادة لم يُراجع" = R3؛ المستند الإلزامي الناقص R2 افتراضيًا. التفاصيل في "M4 Implementation Notes".
- M5: التنبيهات حالة تُطابَق مع البيانات في مسح (يومي + بعد الأحداث) بدل أحداث متفرقة؛ ميزانية الوقود على التفويلات المقبولة فقط؛ استيراد البيانات الأساسية لا يُتراجع عنه. التفاصيل في "M5 Implementation Notes".
- M6: Rate Limit في الذاكرة (نسخة API واحدة في الـPilot)؛ فحص كلمات السر المسرّبة يفشل مفتوحًا لو الخدمة مش متاحة؛ النسخ الاحتياطي بأدوات Postgres نفسها (pg_receivewal + pg_basebackup) بدل WAL-G علشان نفس السكربتات تتجرّب محليًا. التفاصيل في "M6 Implementation Notes".
