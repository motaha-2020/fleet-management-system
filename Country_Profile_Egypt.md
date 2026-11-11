# Country Profile — Egypt (EG)
## First Operating Country · Fleet Management SaaS

**Version:** 1.0 · **Date:** 11 Nov 2026 · **Related:** `PRD_v0.3.md` (OD-01, OD-02, OD-05, OD-06, OD-07, OD-14)
**Status:** Decided (OD-01 مصر · OD-02 ~100 مركبة) + Proposed (باقي البنود)

> **تنبيه:** البنود المعلَّمة ⚖️ مبنية على الفهم العام للتشريعات المصرية وتحتاج **مراجعة مستشار قانوني/ضريبي مصري** قبل Country Activation (مرحلة Compliance Review في CTR-003). لا تُعتبر رأيًا قانونيًا.

---

## 1. Country Template Values

| Key | Value |
|---|---|
| Country Code | `EG` (ISO 3166-1) |
| Currency | `EGP` — قرشان عشريان (ISO 4217) |
| Timezone | `Africa/Cairo` (IANA) — **إلزامي استخدام IANA وليس Offset ثابت**؛ مصر أعادت العمل بالتوقيت الصيفي منذ 2023، ويجب أن تتعامل الـSessions والتقارير مع ساعة التغيير |
| Languages | Arabic (Primary, RTL) · English |
| Digits | Western (0-9) افتراضيًا؛ خيار عرض الأرقام الهندية (٠-٩) لكل مستخدم |
| Date Format | DD/MM/YYYY؛ التقويم الميلادي |
| Units | km · Liter · m³ للغاز الطبيعي (يُعرض حسب وحدة المحطة) |
| Week | Weekend = الجمعة (+ السبت حسب الشركة)؛ Week Start = السبت (Configurable) |
| Public Holidays | قائمة سنوية تُحدَّث يدويًا — الأعياد الإسلامية متغيرة (تقويم قمري) وتُعلن رسميًا قبلها بفترة قصيرة؛ يحتاج Platform Admin إجراء تحديث سنوي |
| Phone | `+20`؛ أرقام الموبايل 10 أرقام بعد كود الدولة (01x) |

## 2. Fuel Types

| Code | Name | Notes |
|---|---|---|
| `PET80` | بنزين 80 | |
| `PET92` | بنزين 92 | الأكثر شيوعًا للسيارات الخاصة |
| `PET95` | بنزين 95 | |
| `DSL` | سولار | النقل والميكروباص والنقل الثقيل |
| `CNG` | غاز طبيعي | **شائع في مصر بنظام Bi-Fuel (بنزين + غاز)** — انظر FUEL-016 |

**Official Fuel Prices:** أسعار الوقود في مصر تحددها **لجنة التسعير** وتتغير على فترات. المقترح: جدول أسعار رسمي Effective-dated يُحدّثه Platform Admin، ويُستخدم كـReference Price في FUEL-005 (FUEL-017). هذا يجعل فحص سعر اللتر دقيقًا جدًا في مصر (انحراف ±2% بدل ±20%).

## 3. Driver Licensing ⚖️

**المرجع:** قانون المرور رقم 66 لسنة 1973 وتعديلاته.

| License Category | Typical Vehicles (Mapping مقترح) |
|---|---|
| خاصة | ملاكي حتى عدد ركاب محدد |
| مهنية — درجة ثالثة | ملاكي/أجرة/نقل خفيف |
| مهنية — درجة ثانية | نقل متوسط، أتوبيس صغير |
| مهنية — درجة أولى | نقل ثقيل، مقطورة، أتوبيس |
| دراجة نارية | موتوسيكل |

- الـMapping بين الفئات وأنواع المركبات يُعتمد بعد المراجعة القانونية، ويُخزَّن كـCountry Policy Effective-dated.
- **قاعدة شائعة في الشركات المصرية:** السائق المهني يجب أن يحمل رخصة مهنية حتى لو المركبة ملاكي (سياسة شركة → R3، قابلة للتشديد).

## 4. Mandatory Documents — Default Catalog

### Vehicle
| Document | Expiry | Risk | Notes |
|---|---|---|---|
| رخصة تسيير المركبة | نعم | R4 | ⚖️ التجديد يتطلب الفحص الفني والتأمين الإجباري **وسداد المخالفات** |
| وثيقة التأمين الإجباري | نعم | R4 | ⚖️ |
| تأمين شامل | نعم | R2 | اختياري حسب الشركة |
| شهادة الفحص الفني | نعم | R3 | |
| عقد إيجار/تأجير تمويلي | نعم | R2 | للمركبات المستأجرة |
| ملصق الطرق الإلكتروني (كارتة) | حسب المزود | R1 | للطرق ذات الرسوم |

### Driver
| Document | Expiry | Risk | Notes |
|---|---|---|---|
| رخصة القيادة | نعم | R4 | الفئة تُقارن بالمركبة |
| بطاقة الرقم القومي | نعم | R2 | **بيانات حساسة** — انظر §7 |
| تحليل المخدرات | حسب السياسة | R3 | ⚖️ مطلوب لاستخراج/تجديد الرخصة المهنية؛ ويمكن للشركة طلبه دوريًا |
| صحيفة الحالة الجنائية (الفيش) | حسب السياسة | R2 | سياسة شركة |
| كشف طبي | حسب السياسة | R2 | سياسة شركة |

## 5. Tax & Invoicing ⚖️

| Item | Proposed Handling |
|---|---|
| VAT | 14% (قانون الضريبة على القيمة المضافة رقم 67 لسنة 2016) — على الصيانة وقطع الغيار والخدمات |
| الوقود | ⚖️ المنتجات البترولية تخضع غالبًا لـ**ضريبة الجدول** وليس VAT القابل للخصم → في النظام: Tax غير قابل للاسترداد، وتقارير الوقود Net = Gross. يُؤكد مع مستشار ضريبي |
| Tax Treatment per Category | إعداد على مستوى الدولة: Recoverable / Non-recoverable لكل Cost Category |
| E-Invoice / E-Receipt | منظومة **الفاتورة الإلكترونية والإيصال الإلكتروني** (مصلحة الضرائب) → حقل اختياري `e-Invoice UUID` في فواتير الصيانة والتكاليف (FIN-012)، يساعد في المطابقة مع المحاسبة. التكامل الآلي مع المنظومة **خارج النطاق** |
| Vendor Tax ID | رقم التسجيل الضريبي للمورد (VND-001) |

## 6. Operational Practices (Egypt-specific)

| Topic | Implication |
|---|---|
| **المخالفات المرورية** | لا تُجدَّد رخصة المركبة قبل سدادها → تتبع المخالفات وربطها بالسائق مهم من البداية → **Fines (يدوي) نُقلت إلى Pilot** (INC-003/004) |
| **الطرق ذات الرسوم (كارتة)** | Cost Category جديدة: Tolls & Parking |
| **Bi-Fuel (CNG)** | استهلاك منفصل لكل نوع وقود؛ Full-to-Full لكل نوع على حدة |
| **Connectivity** | ضعف التغطية في الطرق الصحراوية والصعيد → الـOffline ضروري من اليوم الأول (مؤكد في الـPilot) |
| **Devices** | غالبية Android، وكثير منها منخفض الإمكانيات → اختبار على أجهزة Android منخفضة (2–3 GB RAM) ضمن الـPilot |
| **Driver OTP** | SMS عبر مزود محلي مع Sender ID مسجَّل؛ **WhatsApp OTP** كقناة بديلة (Should) لتقليل فشل الاستلام والتكلفة |
| **Cash Fuel** | التفويل الكاش منتشر → صورة الإيصال إلزامية للكاش (FUEL-009) مهمة جدًا |
| **Fuel Cards** | مزودو كروت أساطيل متعددون في السوق المصري؛ كل مزود بصيغة كشف مختلفة → Template/Mapping لكل مزود (CARD-006) يكفي بدون API في البداية |

## 7. Data Protection & Hosting ⚖️

**المرجع:** قانون حماية البيانات الشخصية رقم 151 لسنة 2020 ولائحته التنفيذية، ومركز حماية البيانات الشخصية.

| Topic | Proposed Handling |
|---|---|
| Role | العميل = Data Controller؛ المنصة = Data Processor → عقد معالجة بيانات (DPA) مع كل Tenant |
| Licensing | ⚖️ مراجعة متطلبات الترخيص/التصريح من المركز للمعالجة |
| Sensitive Data | الرقم القومي، تحليل المخدرات، الحالة الجنائية، البيانات الطبية → تشفير على مستوى الحقل + عرض مُقنَّع (Masked) + صلاحية عرض منفصلة + Audit لكل عرض |
| Cross-Border Transfer | ⚖️ القانون يقيّد نقل البيانات خارج مصر إلا بشروط وتصريح → يحكم قرار OD-06 |
| Consent | شاشة موافقة عربية للموقع والصور (PRV-002) |

### OD-06 — Hosting Region (Proposed)

**التوصية:** استضافة داخل مصر إذا توفر مزود سحابي يحقق متطلبات المنصة (Managed Database، Object Storage مشفّر، Backups، Monitoring)؛ وإلا **أقرب Region إقليمي** مع الحصول على تصريح النقل عبر الحدود قبل الإنتاج.

**قرار تنفيذي:** المعمارية تبقى **Region-Ready** (Confirmed)، فاختيار المنطقة لا يغيّر التصميم. القرار النهائي يُتخذ في Compliance Review بعد رأي قانوني، **قبل Phase E (Pilot)** وليس قبل التطوير.

## 8. OD-07 — Retention Periods (Proposed) ⚖️

| Data Category | Proposed Retention | Basis |
|---|---|---|
| Financial records & invoices | 7 سنوات | تغطي متطلبات الدفاتر والضرائب (غالبًا 5 سنوات) + هامش |
| Audit Log | 7 سنوات | مرتبط بالمالي |
| Operational history (Fuel, Odometer, Maintenance) | 7 سنوات | مرتبط بالتكاليف |
| Driver personal data | مدة العمل + 5 سنوات، ثم Anonymization | Data Minimization |
| Sensitive documents (تحليل، فيش، طبي) | آخر نسخة سارية + سنة | تقليل الاحتفاظ بالحساس |
| GPS Start/End | سنة واحدة | Data Minimization |
| Offline device cache | حتى المزامنة الناجحة | — |
| Backups | 35 يومًا | D-BKP |

## 9. OD-02 — Fleet Profile & Sizing (~100 vehicles)

### Assumptions (تُؤكد مع العميل في Stage 1)
| Item | Assumption |
|---|---|
| Vehicles | ~100 (مزيج ملاكي/نقل خفيف/ميكروباص؛ جزء Bi-Fuel) |
| Drivers | 110–130 (بدلاء) |
| Branches | 2–4 |
| Web Users | 15–25 (Admin, Fleet Managers, Finance) |
| Events/day | 300–600 (تفويلات، عداد، بلاغات) |
| Photos/day | 150–300 × ≤ 500 KB ≈ ≤ 150 MB/يوم ≈ ≤ 55 GB/سنة |
| Concurrent Users | ≤ 50 |

### Implications
- الحجم صغير تقنيًا: قاعدة بيانات واحدة متوسطة تكفي بهامش كبير؛ **لا داعي لأي تعقيد Scaling في الـPilot**.
- أهداف NFR-003 الحالية مناسبة وتصبح **Confirmed** لهذا الحجم.
- تكلفة SMS OTP ضئيلة لأن الجهاز يُربط مرة واحدة (SEC-005).

### Pilot Rollout (Recommended)

| Wave | Scope | Duration | Exit Criteria |
|---|---|---|---|
| Wave 0 — Onboarding | استيراد الـ100 مركبة والسائقين والمستندات والـOpening Balances | 2 أسابيع | G1 Data Readiness |
| Wave 1 — Controlled | فرع واحد، **20–30 مركبة**، Parallel Run | 4 أسابيع | Thresholds §31.1 على العينة، لا Sev1/Sev2 |
| Wave 2 — Full Pilot | باقي الـ100 مركبة، Parallel Run مختصر | 2–4 أسابيع | G2–G5 كاملة |
| Cutover | إيقاف النظام القديم كـSystem of Record | — | Go/No-Go |

**السبب:** إطلاق 100 مركبة مرة واحدة يضاعف أثر أي خطأ في المطابقة المالية أو تدريب السائقين؛ موجة صغيرة أولًا تكشف المشاكل بتكلفة أقل، مع بقاء الـ100 مركبة داخل النظام من البداية كبيانات.

## 10. OD-14 — Pricing & Packaging (Proposed Model)

| Package | Modules | Pricing Unit |
|---|---|---|
| **Core** | كل موديولات Pilot MVP (+ Fines يدوي) | لكل مركبة نشطة / شهر |
| **Professional** | Core + Fuel Cards & Reconciliation + Sessions + Trips + Leave + Cost Allocation + Accidents | لكل مركبة نشطة / شهر |
| **Enterprise** | Professional + Multi-Country/FX + Custom Roles + SLA متقدم + دعم مخصص | تعاقد سنوي |

- **العملة:** EGP للعملاء المصريين، مع بند مراجعة سعرية سنوي.
- **مركبة نشطة:** Lifecycle = Active خلال الشهر (المركبات Inactive/Disposed لا تُحتسب).
- **المستخدمون:** غير محدودين (لا تسعير على السائقين) لتشجيع الـAdoption.
- **العميل الأول:** سعر Pilot مخفّض مقابل Feedback ودراسة حالة، مع تثبيت السعر لفترة محددة.
- **الأرقام الفعلية:** تُحدد بعد حساب تكلفة التشغيل لكل Tenant (Database per Tenant + Storage + SMS) — قرار تجاري خارج نطاق هذا المستند.

## 11. Decisions Summary

| OD | Decision | Status |
|---|---|---|
| OD-01 | مصر | ✅ Decided (Product Owner) |
| OD-02 | ~100 مركبة؛ Rollout بموجات (§9) | ✅ Decided (الحجم) · Proposed (الموجات) |
| OD-05 | Catalog §3–4 | Proposed ⚖️ — Legal Review |
| OD-06 | داخل مصر إن أمكن، وإلا أقرب Region + تصريح نقل | Proposed ⚖️ — قبل Phase E |
| OD-07 | جدول §8 | Proposed ⚖️ |
| OD-14 | نموذج §10 | Proposed — الأرقام قرار تجاري |
