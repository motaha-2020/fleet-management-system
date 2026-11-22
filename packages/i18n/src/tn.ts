import { ar } from "./ar.js";
import type { Messages } from "./index.js";

/**
 * Tunisian (owner, 16 Nov 2026: Tunisian for the whole site). Written over the standard Arabic: what is said
 * differently in Tunisian is here; long explanations stay in standard Arabic, as Tunisian apps usually do.
 * ⚖️ To be reviewed by a native Tunisian speaker before go-live.
 */
type DeepPartial<T> = T extends string ? string : T extends readonly string[] ? readonly string[] : { [K in keyof T]?: DeepPartial<T[K]> };

const say: DeepPartial<Messages> = {
  app: { name: "منصّة الأسطول", switchLang: "اللغة" },
  common: { save: "سجّل", cancel: "بطّل", loading: "قاعد يتحمّل…", logout: "اخرج", add: "زيد", none: "ما فمّاش", optional: "موش لازم", copy: "انسخ", copied: "تنسخ", retry: "عاود جرّب", close: "سكّر" },
  auth: {
    loginTitle: "الدخول", password: "كلمة السرّ", login: "ادخل",
    invalid: "الإيمايل ولا كلمة السرّ غالطين", locked: "الحساب تسكّر شويّة على خاطر برشا محاولات غالطة. عاود بعد 15 دقيقة",
    acceptTitle: "فعّل حسابك", activate: "فعّل الحساب", downloadApp: "نزّل تطبيق الشوفور", downloadAppHint: "أندرويد · حلّ الرابط من تليفون الشوفور",
    showPassword: "ورّي كلمة السرّ", hidePassword: "خبّي كلمة السرّ", remember: "خلّيني داخل",
    forgot: "نسيت كلمة السرّ؟", forgotSend: "ابعثلي الرابط", backToLogin: "ارجع للدخول",
    forgotUsernameTitle: "نسيت اسم الدخول", forgotPasswordTab: "نسيت كلمة السرّ", forgotUsernameTab: "نسيت اسم الدخول",
  },
  roles: { company_admin: "مدير الشركة", fleet_manager: "مسؤول الكراهب", finance_reviewer: "المسؤول المالي", driver: "شوفور" },
  mfa: { title: "ثبّت في الإيمايل متاعك", code: "الكود", confirm: "أكّد", resend: "ابعث كود جديد", resent: "تبعث كود جديد.", restart: "ادخل بحساب آخر", invalid: "الكود غالط ولا وفى وقتو" },
  nav: { fuel: "الوقود", costs: "المصاريف", corrections: "التصليحات", fuelPrices: "أسوام الوقود", vehicles: "الكراهب", drivers: "الشوافرية", users: "المستعملين", branches: "الفروع", vendors: "المزوّدين", documents: "الأوراق", maintenance: "الصيانة", defects: "البانات", readiness: "الجاهزيّة", dashboard: "لوحة المتابعة", alerts: "التنبيهات", fines: "الخطايا", reports: "التقارير", imports: "التوريد", budgets: "الميزانيّات", policies: "القواعد", company: "ملف الشركة", approvals: "المصادقات", customers: "العملاء", tasks: "المهمّات", inspections: "الفحص" },
  navGroups: { menu: "القايمة", platform: "المنصّة", overview: "نظرة عامّة", operations: "الخدمة", fleet: "الأسطول", finance: "الفلوس", admin: "الإدارة" },
  signup: { title: "سجّل شركتك", noAccount: "شركتك موش مسجّلة؟", haveAccount: "عندك حساب؟ ادخل", sendCode: "ابعث الكود", create: "اعمل الشركة", back: "ارجع", preparing: "قاعدين نحضّرو في شركتك… ثواني.", adminName: "اسمك" },
  account: { title: "حسابي", profile: "معلوماتي", saved: "معلوماتك تسجّلت.", changePassword: "بدّل كلمة السرّ", mismatch: "كلمتين السرّ موش كيف كيف" },
  company: { saved: "ملف الشركة تسجّل.", uploadLogo: "حطّ اللوغو", changeLogo: "بدّل اللوغو", logo: "اللوغو", noLogo: "ما فمّاش لوغو", logoSaved: "اللوغو تحطّ." },
  approvals: {
    empty: "ما فمّا حتّى شي يستنّى في المصادقة.", approve: "صادق", reject: "ارفض", reason: "علاش رفضتها", confirmReject: "أكّد الرفض",
    approved: "تصادقت.", rejected: "ترفضت، والشوفور باش يوصلو علاش.", approveAll: "صادق على الكلّ ({n})", approvedAll: "تصادقو {n}.",
    types: { fuel: "تعميرة", task: "مهمّة", odometer: "قراية كونتور", cost: "فاتورة / مصروف", maintenance: "صيانة", inspection: "فحص" },
  },
  customers: { add: "زيد عميل", empty: "ما فمّاش عملاء توّا.", edit: "بدّل", deactivate: "وقّف", activate: "فعّل" },
  tasks: {
    title: "المهمّات", add: "مهمّة جديدة", empty: "ما فمّاش مهمّات.", vehicle: "الكرهبة", driver: "الشوفور", crew: "الكراهب والشوافرية", addCrew: "+ كرهبة وشوفور",
    statuses: { planned: "مبرمجة", in_progress: "ماشية", done: "كمّلت — تستنّى المصادقة", approved: "مصادق عليها", rejected: "مرفوضة", cancelled: "متبطّلة" },
    reasons: { done: "كمّلت", breakdown: "بانة", driver_change: "تبديل شوفور", cancelled: "تبطّلت", other: "حاجة أخرى" },
    start: "ابدا", finish: "كمّل", cancel: "بطّل المهمّة", saved: "تسجّل.", swap: "بدّل", swapTitle: "بدّل كرهبة ولا شوفور",
  },
  inspections: { title: "فحص الكراهب", add: "فحص جديد", ok: "باهي", notOk: "فيه مشكل", saved: "الفحص تسجّل.", empty: "ما فمّاش فحوصات.", never: "عمرها ما تفحصت", vehicle: "الكرهبة" },
  driverWeb: {
    issueWebCode: "كود للدخول من البراوزر", entry: "شوفور؟ ادخل من البراوزر", loginTitle: "دخول الشوفور",
    loginHelp: "اكتب اسم المستعمل وكود التفعيل اللي عطاهولك مسؤول الكراهب. الكود يخدم مرّة برك في كل براوزر، وما يسكّرش التطبيق متاع التليفون.",
    username: "اسم المستعمل", code: "كود التفعيل", invalid: "اسم المستعمل ولا الكود غالط، ولا وفى وقتو، ولا تستعمل قبل.", officeLogin: "دخول البيرو",
    onlineOnly: "نسخة الواب تحبّ الإنترنات. كان ما فمّاش كونكسيون، استعمل التطبيق متاع التليفون.", notifications: "الإشعارات", noNotifications: "ما فمّاش إشعارات.",
  },
  users: { invite: "استدعي مستعمل", deactivate: "وقّف", activate: "فعّل", edit: "بدّل", copied: "تنسخ" },
  vehicles: { title: "الكراهب", add: "زيد كرهبة", empty: "ما فمّاش كراهب توّا. زيد أوّل وحدة.", registrationNumber: "النومرو (المنريكولة)", created: "الكرهبة تزادت" },
  vehicle: { back: "الكراهب الكلّ", details: "معلومات الكرهبة", edit: "بدّل المعلومات" },
  drivers: { title: "الشوافرية", add: "زيد شوفور", empty: "ما فمّاش شوافرية توّا.", issueCode: "اعطي كود تفعيل", phone: "التليفون" },
  driver: { back: "الشوافرية الكلّ", details: "معلومات الشوفور", licenseNumber: "نومرو البرمي", licenseCategories: "أصناف البرمي", licenseExpiry: "وقتاش يوفى البرمي", nationalId: "نومرو الكارط ديدونتيتي" },
  docs: { title: "الأوراق", add: "زيد ورقة", none: "ما فمّاش أوراق", missing: "أوراق لازمة ناقصة", download: "نزّل" },
  driverApp: {
    activateTitle: "فعّل التطبيق", activateHelp: "اكتب اسم المستعمل وكود التفعيل اللي عطاهولك مسؤول الكراهب.",
    username: "اسم المستعمل", code: "كود التفعيل", activate: "فعّل", invalid: "اسم المستعمل ولا الكود غالط ولا وفى وقتو",
    locked: "برشا محاولات غالطة. عاود بعد 15 دقيقة", hello: "عسلامة", vehicles: "الكراهب", noVehicles: "ما فمّا حتّى كرهبة متاحة ليك توّا.",
    refresh: "حدّث", logout: "اخرج", online: "كونكتي", offline: "موش كونكتي", lastUpdate: "آخر تحديث",
    plate: "المنريكولة", fuel: "الوقود", tank: "الريزرفوار",
    recordFuel: "سجّل تعميرة", back: "ارجع", fuelType: "نوع الوقود", quantity: "الكمّية", amount: "المبلغ", odometer: "الكونتور",
    full: "عمّرت الكلّ", partial: "شويّة برك", cash: "كاش", card: "كارطة", takePhoto: "صوّر الوصل", choosePhoto: "اختار تصويرة", photoReady: "تصويرة الوصل حاضرة",
    receiptRequired: "لازم تصويرة الوصل كان خلّصت كاش", submit: "ابعث", sent: "التعميرة تبعثت", recent: "آخر تعميراتي", noEntries: "ما فمّاش تعميرات توّا",
    statuses: { submitted: "تبعثت", under_review: "قاعدة تتراجع", accepted: "مقبولة", voided: "متبطّلة" }, invalidNumber: "اكتب نومرو صحيح",
    recordOdometer: "سجّل الكونتور", lastOdometer: "آخر قراية", saved: "تسجّلت، وباش تتبعث أوّل ما تجي الكونكسيون", sendNow: "ابعث توّا",
    odometerPhoto: "صوّر الكونتور", retakePhoto: "عاود صوّر", odometerPhotoRequired: "لازم تصويرة الكونتور",
    odometerBelowLast: "{value} أقلّ من آخر قراية ({last}). الكونتور ما يرجعش لتالي: ثبّت في النومرو، وكان متأكّد اللي صحيح انزل على ابعث مرّة أخرى.",
    odometerBigJump: "{value} أكثر من آخر قراية ({last}) بـ {diff} كم. ثبّت في النومرو، وكان متأكّد اللي صحيح انزل على ابعث مرّة أخرى.",
    criticalFailWarning: "ما تسوقش الكرهبة هاذي: فمّا مشكل في {items}. قول لمسؤول الكراهب توّا.", photoTakenAt: "تصوّرت {time}",
    myTasks: "مهمّاتي", noTasks: "ما عندك حتّى مهمّة توّا.", tasksOffline: "ما فمّاش كونكسيون: ليستة المهمّات تحبّ الإنترنات. اللي تسجّلو يتبعث كي ترجع الكونكسيون.",
    startTask: "ابدا المهمّة", finishTask: "كمّل المهمّة", taskDone: "المهمّة كمّلت وتستنّى المصادقة", startedAt: "الكونتور في البداية", waitingToSend: "تسجّل، ويتبعث كي تجي الإنترنات",
    belowStart: "الكونتور أقلّ من متاع البداية", vehicle: "الكرهبة", inspection: "افحص الكرهبة", checkOk: "باهي", checkProblem: "فيه مشكل", problemNote: "شنوّة المشكل؟", notes: "ملاحظات",
    savedPendingApproval: "تسجّل، ويتحسب كي يصادق عليه مسؤول الكراهب", readingPhoto: "قاعدين نقراو النومرو من التصويرة…", ocrNone: "ما نجّمناش نقراو النومرو من التصويرة، اكتبو انت.",
    ocrMatch: "النومرو كيف التصويرة ({n}).", ocrDiffers: "التصويرة فيها {n}، ثبّت في النومرو.", confirmOdometer: "أكّد الكونتور", locating: "قاعدين نلوّجو على بلاصتك…",
    stationLocated: "بلاصة الكيوسك تسجّلت (±{m} م)", locationOk: "البلاصة تسجّلت (±{m} م)", locationDenied: "من غير بلاصة (ما سمحتش). القراية تتسجّل عادي.",
    locationUnavailable: "البلاصة موش متاحة. القراية تتسجّل عادي.", cameraNeeded: "لازمك الكاميرا باش تصوّر الكونتور. اسمح بيها من الباراميترات متاع التليفون.",
    pending: "يستنّى باش يتبعث", allSent: "كل شي تبعث", recentActivity: "آخر ما سجّلت", noActivity: "مازلت ما سجّلت شي",
    photoPending: "التصويرة مازالت ما طلعتش", sending: "قاعد يتبعث…", neverSynced: "مازال ما تكونكتاش",
    grantExpired: "فات برشا وقت من غير كونكسيون. اتّصل بالإنترنات باش تنجم تسجّل حاجة جديدة؛ اللي سجّلتو قبل يتبعث عادي.",
    grantLeft: "تنجم تخدم من غير إنترنات مدّة", hours: "ساعة",
    logoutPendingTitle: "فمّا حاجات مازالت ما تبعثتش", logoutPendingBody: "عندك {n} حاجة مازالت ما وصلتش للسرفور. كان تخرج توّا يضيعو. اتّصل بالإنترنات واستنّى حتّى يتبعثو.", logoutAnyway: "اخرج مهما كان",
    localStatuses: { pending: "يستنّى", held: "يستنّى", accepted: "تمّ", warning: "يتراجع", conflict: "البيرو باش يراجعو", rejected: "مرفوض" },
    types: { "fuel.create": "تعميرة", "odometer.record": "قراية كونتور", "defect.report": "بانة", "task.line": "مهمّة", "inspection.create": "فحص" },
    photoProcessing: "قاعدين نحضّرو في التصويرة…", connecting: "قاعد يتكونكتا…",
    pin: {
      setupTitle: "اختار كود سرّي من 6 أرقام", setupHelp: "باش تستعملو كل ما تحلّ التطبيق، حتّى من غير إنترنات.", confirmTitle: "عاود اكتب الكود السرّي",
      mismatch: "الكودين موش كيف كيف، عاود من الأوّل", unlockTitle: "اكتب الكود السرّي", wrong: "الكود السرّي غالط", lastTries: "الكود غالط — بقاتلك {n} محاولات، ومن بعد يلزمك كود تفعيل جديد",
      wipedTitle: "التطبيق تسكّر", wipedBody: "كتبت الكود السرّي غالط برشا مرّات. اطلب كود تفعيل جديد من مسؤول الكراهب.",
      forgot: "نسيت الكود السرّي؟ اطلب كود تفعيل جديد من مسؤول الكراهب. بعد {n} محاولات غالطة التطبيق يتسكّر.",
      biometricOfferTitle: "تحبّ تستعمل البصمة؟", biometricOfferBody: "تنجم تحلّ التطبيق بالبصمة عوض ما تكتب الكود كل مرّة.",
      enable: "استعمل البصمة", notNow: "موش توّا", biometricPrompt: "حلّ تطبيق الأسطول", usePin: "استعمل الكود السرّي", delete: "امسح",
    },
    appVersion: "نسخة التطبيق", builtIn: "النسخة الأصليّة", update: "تحديث", updateReady: "فمّا نسخة جديدة للتطبيق — انزل هوني باش تخدّمها",
  },
  m2: {
    fuel: {
      title: "الوقود", add: "سجّل تعميرة", queue: "تعميرات للمراجعة", empty: "ما فمّاش تعميرات", cash: "كاش", card: "كارطة", receipt: "تصويرة الوصل", station: "الكيوسك",
      full: "عمّرت الكلّ", partial: "شويّة برك", accept: "اقبل", void: "بطّل", saved: "التعميرة تسجّلت", mapTitle: "وين تعمّرت الكراهب",
    },
    costs: { title: "المصاريف", add: "زيد مصروف", empty: "ما فمّاش مصاريف" },
  },
  m4: {
    defects: { title: "البانات", report: "صرّح ببانة", empty: "ما فمّاش بانات", drivable: "تمشي", notDrivable: "ما تمشيش" },
    driver: {
      report: "صرّح ببانة", title: "تصريح ببانة", description: "شنوّة المشكل؟", severity: "قدّاش خطير", drivable: "تنجم تسوق بلا خطر؟",
      yes: "إيه", no: "لا", photo: "تصويرة (موش لازم)", takePhoto: "صوّر", send: "ابعث التصريح", saved: "التصريح تسجّل، ويتبعث كي تجي الإنترنات",
      readiness: "الجاهزيّة", mayDrive: "تنجم تسوق", warning: "تنجم تسوق، أما رد بالك", restricted: "ما تنجمش تسوق — كلّم المسؤول متاعك",
    },
  },
  m5: {
    fines: { title: "الخطايا", add: "سجّل خطيّة", empty: "ما فمّاش خطايا", statuses: { unpaid: "موش خالصة", paid: "خالصة", disputed: "فيها اعتراض" }, unpaid: "اللي موش خالصة" },
    alerts: { title: "التنبيهات", empty: "ما فمّاش تنبيهات" },
    reports: { title: "التقارير", run: "ورّي", empty: "ما فمّاش معطيات" },
  },
  m6: {
    consent: { allow: "باهي", deny: "لا", useGallery: "الكاميرا موش مسموحة — اختار تصويرة من الغاليري" },
  },
  theme: { toDark: "الوضع متاع الليل", toLight: "الوضع متاع النهار" },
  access: { deniedTitle: "ما عندكش الصلاحية للصفحة هاذي", deniedBody: "الدور متاعك ما يخلّيكش تحلّ الصفحة هاذي. كان تستحقها اطلب الصلاحية من مدير الشركة.", back: "ارجع للصفحة الرئيسية" },
  onboarding: { title: "ابدا حضّر شركتك", hint: "شوية خطوات وتولّي المنصة حاضرة للخدمة", dismiss: "خبّي", steps: { profile: "كمّل ملف الشركة (العنوان والتليفون)", branches: "زيد الفروع متاعك", vehicles: "زيد الكراهب", drivers: "زيد الشوافرية", documents: "حطّ أوراق الكراهب والشوافرية", users: "استدعي الفريق متاعك" } },
  errors: {
    company_preparing: "شركتك قاعدة تتحضّر. استنّى شوية ونعاودو وحدنا — الرابط مازال يخدم.",
    generic: "صار مشكل. عاود جرّب.", forbidden: "ما عندكش الصلاحيّة باش تعمل هذا", network: "ما نجّمناش نوصلو للسرفور",
    required: "لازم", wrong_password: "كلمة السرّ غالطة", invalid_code: "الكود غالط", validation_failed: "ثبّت في الخانات اللي معلّمين",
  },
};

function merge<T>(base: T, over: unknown): T {
  if (over === undefined) return base;
  if (typeof base !== "object" || base === null || Array.isArray(base)) return over as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) out[k] = merge((base as Record<string, unknown>)[k], v);
  return out as T;
}

export const tn: Messages = merge<Messages>(ar, say);
