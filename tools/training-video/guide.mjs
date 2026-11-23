/**
 * Trainee guide (standard Arabic) for the client, as an A4 PDF. The screenshots come from the same filmed run
 * (OUT_DIR/guide-shots, taken by film.mjs), so the guide always matches the version shown in the video.
 * Writes OUT_DIR/guide.html and OUT_DIR/guide.pdf.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const OUT = path.resolve(process.env.OUT_DIR ?? "training-out");
const SHOTS = path.join(OUT, "guide-shots");
const has = (k) => fs.existsSync(path.join(SHOTS, `${k}.png`));
const img = (k, cap) => (has(k) ? `<figure><img src="guide-shots/${k}.png" alt=""><figcaption>${cap}</figcaption></figure>` : "");
const steps = (items) => `<ol class="steps">${items.map((s) => `<li>${s}</li>`).join("")}</ol>`;
const tasks = (items) => `<ul class="tasks">${items.map((s) => `<li><span class="box"></span><span>${s}</span></li>`).join("")}</ul>`;
const note = (s) => `<p class="note">${s}</p>`;
const today = new Intl.DateTimeFormat("ar-TN", { dateStyle: "long", timeZone: "Africa/Tunis" }).format(new Date());

const sections = [
  {
    id: "intro", title: "مقدمة", body: `
      <p>منصة الأسطول نظام لإدارة مركبات الشركة وسائقيها: قراءات العداد، والوقود، والصيانة، والوثائق، والمهام، والتكاليف، في مكان واحد. يعمل المكتب من المتصفح (على الحاسوب أو الهاتف)، ويعمل السائق من تطبيق أندرويد أو من نسخة الويب على هاتفه.</p>
      <h3>الأدوار</h3>
      <table><tr><th>الدور</th><th>ما يفعله</th></tr>
        <tr><td>مدير الشركة</td><td>يجهّز الشركة: الملف، والفروع، والمركبات، والسائقون، والمستخدمون، والأدوار والصلاحيات، وأسعار الوقود الرسمية، والسياسات.</td></tr>
        <tr><td>مدير الأسطول</td><td>العمل اليومي لفروعه: المركبات والسائقون، والمهام، ومراجعة الوقود، والصيانة، والمصادقة على ما يسجّله السائقون.</td></tr>
        <tr><td>المدير المالي</td><td>يطّلع على الشركة كلها، ويستخرج التقارير ويصدّرها إلى Excel، ويصادق على التصحيحات المالية.</td></tr>
        <tr><td>دور مخصص</td><td>يُنشئه مدير الشركة ويحدد صلاحياته (مثل: مشرف وردية).</td></tr>
        <tr><td>السائق</td><td>يسجّل العداد بالصورة، والوقود، والفحص، والأعطال، ويبدأ مهامه وينهيها.</td></tr>
      </table>
      <h3>الدخول</h3>
      ${steps([
        "موظفو المكتب: البريد الإلكتروني وكلمة السر. عند الدخول من جهاز جديد يصل رمز من 6 أرقام إلى البريد، ثم يبقى الجهاز موثوقًا 30 يومًا.",
        "خيار «البقاء متصلًا» يُبقي الجلسة 30 يومًا، وبدونه تنتهي بعد 24 ساعة.",
        "السائق: اسم المستخدم ورمز التفعيل الذي يصدره مدير الأسطول من صفحة السائقين. الرمز صالح 24 ساعة ويُستخدم مرة واحدة.",
        "اللغة من أعلى الصفحة: العربية، التونسية، Français، English. والمبالغ بالدينار التونسي (3 أرقام بعد الفاصلة) والمواعيد بتوقيت تونس.",
      ])}
      ${note("قاعدة مهمة: لا تُحتسب القراءات والتعبئات والفواتير والصيانة في التقارير إلا بعد المصادقة عليها، ومن سجّل شيئًا لا يستطيع المصادقة عليه بنفسه.")}`,
  },
  {
    id: "admin", title: "مدير الشركة: تجهيز الشركة", body: `
      <p>عند أول دخول تظهر على لوحة المتابعة قائمة «خطوات البداية». اتبعها بالترتيب.</p>
      ${img("admin-onboarding", "قائمة خطوات البداية على لوحة المتابعة")}
      ${steps([
        "<b>ملف الشركة</b>: الاسم، والهاتف، والعنوان، والشعار.",
        "<b>الفروع</b>: المقر الرئيسي موجود تلقائيًا على توقيت تونس. أضف بقية الفروع برمز واسم.",
        "<b>المركبات</b>: رقم الأسطول، ورقم اللوحة، والماركة، والطراز، وسنة الصنع، وسعة الخزان، وصنف الرخصة المطلوب. سعة الخزان ضرورية لاكتشاف التعبئات الزائدة.",
        "<b>السائقون</b>: الاسم، واسم المستخدم، وأصناف الرخصة، ثم «إصدار رمز تفعيل» وتسليمه للسائق.",
        "<b>المستخدمون</b>: دعوة موظفي المكتب بالاسم والبريد والدور والفروع. يصل إليهم رابط تفعيل صالح 7 أيام.",
        "<b>الأدوار والصلاحيات</b>: لكل صلاحية ثلاثة خيارات: غير مسموح، أو على فروع الشخص، أو على الشركة كلها. يمكن إنشاء دور جديد.",
        "<b>أسعار الوقود</b>: أدخل السعر الرسمي لكل نوع وقود بتاريخ سريان. أي تعبئة يختلف سعرها بأكثر من 2% تظهر للمراجعة.",
        "<b>السياسات</b>: حدود التنبيه (الزيادة عن الخزان، وفرق السعر، والتعبئة المكررة، وفترة الفحص، وأقصى مسافة يومية).",
      ])}
      ${img("admin-vehicle-form", "إضافة مركبة")}
      ${img("admin-activation-code", "رمز التفعيل للسائق")}
      ${img("admin-roles", "الأدوار والصلاحيات")}
      ${img("admin-policies", "السياسات وحدود التنبيه")}`,
    practice: [
      "ادخل بحساب مدير الشركة وافتح «خطوات البداية» وتعرّف على ما بقي منها.",
      "أضف فرعًا جديدًا باسم «فرع نابل» برمز NAB.",
      "أضف مركبة جديدة برقم أسطول T-900 وسعة خزان 60 لترًا.",
      "أضف سائقًا جديدًا وأصدر له رمز تفعيل، ثم ادخل به من «سائق؟ ادخل من المتصفح».",
      "أنشئ دورًا مخصصًا باسم «مراقب وقود» وامنحه مراجعة الوقود على فروعه فقط.",
      "أضف سعرًا رسميًا جديدًا لنوع وقود بتاريخ سريان اليوم.",
    ],
  },
  {
    id: "fm", title: "مدير الأسطول: العمل اليومي والمصادقات", body: `
      ${img("ops-dashboard", "لوحة المتابعة")}
      ${steps([
        "<b>لوحة المتابعة</b>: المركبات الجاهزة والمقيّدة، والتكاليف، والوقود مقارنة بالميزانية، والتنبيهات، مع رسوم بيانية.",
        "<b>صفحة المركبة</b>: تبويبات التخصيص والعهدة، والعداد (لكل قراءة صورة ووقت وموقع)، والوقود (الاستهلاك من تعبئة كاملة إلى التي تليها)، والتكاليف، والصيانة.",
        "<b>المهام</b>: مهمة رحلة (من/إلى) أو مهمة مدة، بمركبة وسائق. يمكن تبديل المركبة أو السائق عند عطل، ويمنع النظام حجز المركبة نفسها مرتين في الوقت نفسه.",
        "<b>الوقود</b>: كل تعبئة تُقارن بالسعر الرسمي وبسعة الخزان، وتظهر على الخريطة؛ الملاحظات باللون الأحمر.",
        "<b>الصيانة والجاهزية والوثائق</b>: المستحق، وأوامر العمل، والأعطال المبلّغ عنها، وهل يُسمح للمركبة بالخروج، وتواريخ انتهاء الوثائق.",
        "<b>المصادقات</b>: صفحة واحدة لكل ما سجّله السائقون. افتح العنصر، وراجع الصورة والموقع، ثم «مصادقة» أو «رفض» مع ذكر السبب (يصل إشعار إلى السائق).",
      ])}
      ${img("ops-vehicle-odometer", "قراءات العداد بالصورة والوقت والموقع")}
      ${img("ops-fuel", "مراجعة الوقود والخريطة")}
      ${img("ops-tasks", "المهام")}
      ${img("ops-maintenance", "الصيانة")}
      ${img("fm-approvals", "صفحة المصادقات")}`,
    practice: [
      "ادخل بحساب مدير الأسطول وافتح المركبة C-101، واطّلع على تبويب العداد والوقود.",
      "افتح صفحة الوقود وابحث عن تعبئة عليها ملاحظة، واقرأ سببها.",
      "صادق على قراءة عداد واحدة، وارفض أخرى مع كتابة السبب.",
      "أنشئ مهمة لعميل بمركبة وسائق، ثم بدّل المركبة كأنها تعطّلت.",
      "افتح صفحة الجاهزية واعرف أي مركبة غير مسموح لها بالخروج ولماذا.",
    ],
  },
  {
    id: "finance", title: "المدير المالي: التقارير", body: `
      ${steps([
        "افتح «التقارير» واختر واحدًا من التقارير التسعة: الوقود، والصيانة، والوثائق، والتكاليف، واستثناءات العداد، والتخصيص، وسجل المراجعة، والمخالفات، ونشاط العملاء.",
        "حدد الفترة واضغط «عرض»، ثم «تصدير Excel» أو «تصدير CSV».",
        "في «المخالفات» يقترح النظام السائق الذي كانت المركبة بعهدته وقت المخالفة، وتتابع حالة الدفع.",
        "في «الميزانيات» سقف شهري للوقود، مع تنبيه عند 80% و100%.",
      ])}
      ${img("finance-reports", "التقارير والتصدير إلى Excel")}
      ${note("المدير المالي يطّلع على الشركة كلها لكنه لا يغيّر الإعدادات؛ الصفحات خارج دوره تُظهر رسالة «لا صلاحية».")}`,
    practice: [
      "استخرج تقرير الوقود لآخر 30 يومًا وصدّره إلى Excel.",
      "استخرج تقرير التكاليف حسب المركبة، وحدد أعلى مركبة تكلفة للكيلومتر.",
      "افتح صفحة المخالفات وسجّل مخالفة، ولاحظ السائق المقترح.",
    ],
  },
  {
    id: "driver", title: "السائق: التطبيق ونسخة الويب", body: `
      ${steps([
        "<b>التفعيل</b>: اسم المستخدم ورمز التفعيل من مدير الأسطول (مرة واحدة لكل جهاز). في تطبيق أندرويد يختار السائق بعدها رمزًا سريًا من 6 أرقام أو البصمة.",
        "<b>تسجيل العداد</b>: صورة العداد إلزامية، ويحفظ النظام وقت الصورة وموقع الهاتف. يكتب السائق الرقم ويرسل.",
        "<b>تعبئة الوقود</b>: النوع، والكمية باللتر، والمبلغ بالدينار، والعداد، وتعبئة كاملة أو جزئية، ونقدًا أو بطاقة. صورة الوصل إلزامية عند الدفع نقدًا.",
        "<b>فحص المركبة</b>: لكل بند «سليم» أو «فيه مشكلة». البنود المعلّمة بنجمة بنود سلامة؛ إن كان فيها مشكلة يظهر تحذير واضح بعدم السياقة.",
        "<b>بلاغ عطل</b>: وصف المشكلة، والخطورة، وهل يمكن السياقة بأمان، وصورة اختيارية.",
        "<b>مهامي</b>: بدء المهمة وإنهاؤها بصورة العداد.",
        "<b>بدون إنترنت</b> (التطبيق فقط): يحفظ كل شيء ويرسله فور عودة الاتصال، ويقرأ رقم العداد من الصورة.",
      ])}
      ${img("driver-home", "الشاشة الرئيسية للسائق")}
      ${img("driver-odometer", "تسجيل العداد بالصورة")}
      ${img("driver-fuel", "تسجيل تعبئة وقود")}
      ${img("driver-inspection", "فحص المركبة")}
      ${img("driver-defect", "بلاغ عطل")}
      ${img("driver-home-tn-dark", "باللهجة التونسية والوضع الليلي")}`,
    practice: [
      "ادخل بحساب سائق من نسخة الويب على هاتفك برمز تفعيل جديد.",
      "سجّل قراءة عداد بصورة، ثم تعبئة وقود ببطاقة، ثم تعبئة نقدًا مع صورة الوصل.",
      "نفّذ فحصًا واجعل بند سلامة «فيه مشكلة» ولاحظ التحذير.",
      "بلّغ عن عطل بخطورة «عالية».",
      "اطلب من مدير الأسطول أن يصادق على قراءتك أو يرفضها، وتابع الإشعار.",
    ],
  },
  {
    id: "security", title: "الأمان والتحكم", body: `
      ${steps([
        "كلمة السر الخاطئة تُظهر رسالة واضحة، وبعد محاولات فاشلة كثيرة يُقفل الحساب 15 دقيقة.",
        "«نسيت كلمة السر؟» يرسل رابطًا صالحًا ساعة واحدة، ويستطيع مدير الشركة أيضًا إصدار رابط إعادة تعيين أو كلمة سر مؤقتة من صفحة المستخدمين.",
        "«سجل المراجعة» يحفظ كل إجراء: من فعل ماذا ومتى.",
        "الوضع الليلي من زر أعلى الصفحة، ويُحفظ الاختيار.",
        "إذا فقد السائق هاتفه: أصدر له رمز تفعيل جديدًا؛ التفعيل الجديد يوقف الهاتف القديم.",
      ])}
      ${img("security-audit", "سجل المراجعة")}`,
  },
  {
    id: "faq", title: "أسئلة شائعة", body: `
      <dl>
        <dt>لماذا لا تظهر قراءة السائق في التقارير؟</dt><dd>لأنها لم يُصادَق عليها بعد. افتح «المصادقات».</dd>
        <dt>رمز التفعيل لا يعمل؟</dt><dd>الرمز صالح 24 ساعة ولمرة واحدة. أصدر رمزًا جديدًا من صفحة السائق.</dd>
        <dt>تعبئة عليها ملاحظة «السعر»؟</dt><dd>سعر اللتر يختلف عن السعر الرسمي بأكثر من 2%. تأكد من الوصل ثم صادِق أو ارفض.</dd>
        <dt>تعبئة أكبر من الخزان؟</dt><dd>تأكد من سعة الخزان في بطاقة المركبة؛ يُسمح بزيادة 5% فقط.</dd>
        <dt>لا يصل البريد؟</dt><dd>يضبط مدير المنصة إعدادات البريد الصادر، ويمكن لمدير الشركة إصدار رابط من صفحة المستخدمين.</dd>
      </dl>`,
  },
];

const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 16mm 15mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: "IBM Plex Sans Arabic", "Noto Sans Arabic", sans-serif; color: #12202E; font-size: 11.5pt; line-height: 1.75; margin: 0; }
  .cover { height: 255mm; display: flex; flex-direction: column; justify-content: center; padding: 0 10mm; background: linear-gradient(160deg, #16314A, #0E2233 60%); color: #fff; border-radius: 6mm; page-break-after: always; }
  .cover .k { display: inline-block; background: #1B63A8; padding: 2mm 6mm; border-radius: 99px; font-weight: 600; width: max-content; }
  .cover h1 { font-size: 34pt; margin: 8mm 0 4mm; }
  .cover p { color: #C5D3E0; font-size: 13pt; margin: 1mm 0; }
  .toc { margin-top: 14mm; color: #C5D3E0; }
  .toc li { margin: 1.5mm 0; }
  section { page-break-before: always; }
  h2 { font-size: 20pt; color: #0E2233; border-bottom: 3px solid #1B63A8; padding-bottom: 2mm; margin: 0 0 5mm; }
  h3 { font-size: 13.5pt; color: #134C83; margin: 6mm 0 2mm; }
  table { width: 100%; border-collapse: collapse; margin: 3mm 0; }
  th, td { border: 1px solid #DFE5EC; padding: 2mm 3mm; text-align: right; vertical-align: top; }
  th { background: #E4EEF8; }
  ol.steps { padding-inline-start: 6mm; } ol.steps li { margin: 1.6mm 0; }
  figure { margin: 5mm 0; page-break-inside: avoid; }
  figure img { width: 100%; border: 1px solid #DFE5EC; border-radius: 3mm; }
  figure:has(img[src*="driver"]) img { width: 46%; display: block; margin: 0 auto; }
  figcaption { text-align: center; color: #5B6B7B; font-size: 10pt; margin-top: 1.5mm; }
  .note { background: #ECF3E1; border-inline-start: 4px solid #3F6A14; padding: 3mm 4mm; border-radius: 2mm; }
  .practice { background: #F2F5F8; border: 1px solid #DFE5EC; border-radius: 3mm; padding: 3mm 5mm; margin-top: 6mm; page-break-inside: avoid; }
  .practice h3 { margin-top: 1mm; }
  ul.tasks { list-style: none; padding: 0; } ul.tasks li { display: flex; gap: 3mm; margin: 2mm 0; }
  .box { flex: none; width: 4.2mm; height: 4.2mm; border: 1.5px solid #1B63A8; border-radius: 1mm; margin-top: 1.6mm; }
  dt { font-weight: 700; margin-top: 4mm; } dd { margin: 1mm 0 0; }
</style></head><body>
<div class="cover"><span class="k">دليل المتدرّب</span><h1>منصة الأسطول</h1>
  <p>خطوة بخطوة لكل دور، مع تمارين على شركة التدريب</p><p>${today}</p>
  <ol class="toc">${sections.map((s) => `<li>${s.title}</li>`).join("")}</ol>
  <p style="margin-top:12mm">بيانات الدخول إلى شركة التدريب في ورقة الحسابات التي يسلّمها المدرّب.</p></div>
${sections.map((s) => `<section><h2>${s.title}</h2>${s.body}${s.practice ? `<div class="practice"><h3>تمارين على شركة التدريب</h3>${tasks(s.practice)}</div>` : ""}</section>`).join("\n")}
</body></html>`;

fs.writeFileSync(path.join(OUT, "guide.html"), html);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(path.join(OUT, "guide.html")).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.pdf({ path: path.join(OUT, "guide.pdf"), format: "A4", printBackground: true, displayHeaderFooter: true,
  headerTemplate: "<span></span>", footerTemplate: '<div style="width:100%;text-align:center;font-size:8pt;color:#8899aa"><span class="pageNumber"></span></div>' });
await browser.close();
const missing = ["admin-onboarding", "ops-dashboard", "fm-approvals", "finance-reports", "driver-home"].filter((k) => !has(k));
console.log(`guide.pdf written${missing.length ? ` (missing shots: ${missing.join(", ")})` : ""}`);
