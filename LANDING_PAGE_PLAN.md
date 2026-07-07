# خطة صفحة الهبوط والتحميل — المَحجّة البَيْضَاء
**Landing & Download Page — Plain HTML + SEO (Plan + Hand-off Prompt)**

> مشروع **HTML ثابت** منفصل تمامًا داخل مجلد `landing/`. لا build، لا dependencies، لا علاقة بتطبيق Expo. قابل للنقل/الحذف دون أي أثر على بناء التطبيق.
> ملف APK جاهز في `landing/downloads/almahajja-albaydaa.apk` ويُخدَم مباشرة من جذر الموقع.

---

## Part A — تحسين الفكرة (Enhanced concept)
صفحة تسويقية دعوية هادئة بنفس روح التطبيق (سكينة، لا منافسة، لا زخرفة صاخبة). تعمل كـ: أول انطباع + محرّك SEO + تعريف بالشيخ والمنهج + تحميل مباشر.

**مزايا إضافية فوق الفكرة الأصلية:**
1. **تعليمات تثبيت APK** واضحة (تفعيل مصادر غير معروفة → تحميل → تثبيت) — لأن التوزيع خارج Google Play.
2. **رمز QR للتحميل** يُولّد من رابط التحميل — ليحمّل الزائر من هاتفه فورًا.
3. **شارات "قريبًا على المتاجر"** (Google Play / App Store) placeholder.
4. **معرض لقطات شاشة** + mockup هاتف في الـ Hero.
5. **قسم الشيخ النذير محمد فرح** (يخدم SEO لاسمه).
6. **معاينة المنهج** (العقيدة / التوحيد / كتاب التوحيد…) كبطاقات تخدم كلمات المتون.
7. **FAQ** مربوط بـ FAQPage schema (نتائج غنية في جوجل).
8. **دعوة للدعاء للمشايخ والقائمين** بنبرة صفحة "عن المنصة".

---

## Part B — الخطة التقنية (Plain HTML)

### 1) التقنية
- **HTML + CSS + JavaScript خام** فقط. لا إطار عمل، لا build step، لا `node_modules`.
- خطوط عربية **مستضافة ذاتيًا** (`woff2`) — مثل Tajawal / IBM Plex Sans Arabic للنص، وReem Kufi/Amiri للعناوين — مع `font-display: swap` و`preload`.
- كل CSS/JS محلي (لا CDN خارجي) لضمان السرعة والخصوصية والعمل دون إنترنت في المعاينة.
- النشر: أي static host (Netlify / Vercel / Cloudflare Pages / GitHub Pages) — فقط ارفع محتوى مجلد `landing/`.

### 2) بنية المشروع
```text
landing/                          ← مشروع HTML مستقل (قابل للنقل/الحذف)
  index.html                      الصفحة كاملة، بنية دلالية سليمة
  config.js                       ← مكان واحد واضح لرابط التحميل والروابط (بديل .env)
  robots.txt
  sitemap.xml
  site.webmanifest
  favicon.ico + favicon-*.png + apple-touch-icon.png
  og-image.png                    1200×630 لمشاركات السوشيال
  downloads/
    almahajja-albaydaa.apk        ← جاهز بالفعل (اسم ثابت بدون رقم إصدار)
  assets/
    css/styles.css                RTL + design tokens + responsive + animations
    js/main.js                    تفاعلات: reveal-on-scroll، FAQ accordion، QR، سنة التذييل
    js/qrcode.min.js              مكتبة QR صغيرة محلية (توليد رمز التحميل)
    fonts/*.woff2                  خطوط عربية مستضافة ذاتيًا
    img/                          لقطات شاشة + شعار + أيقونات المميزات (SVG)
  README.md                       تشغيل/نشر/كيفية استبدال APK للترقية
```

### 3) رابط التحميل (بديل .env)
- لا يوجد `.env` في HTML خام. بدلًا منه `config.js` فيه ثابت واحد واضح:
```js
// config.js — عدّل هذا السطر فقط عند الحاجة
window.APP_CONFIG = {
  DOWNLOAD_URL: "/downloads/almahajja-albaydaa.apk", // ثابت — للترقية استبدل الملف بنفس الاسم
  WHATSAPP_URL: "",   // رابط دعم واتساب (اختياري)
  PLAYSTORE_URL: "",  // لاحقًا
  APPSTORE_URL: "",   // لاحقًا
  SITE_URL: "https://example.com",
  SUPABASE_URL: "",        // لعدّاد التحميلات (مشروع Supabase)
  SUPABASE_ANON_KEY: ""    // مفتاح عام آمن للكشف (محمي بـ RLS)
};
```
- `main.js` يقرأ `APP_CONFIG.DOWNLOAD_URL` ويضبط أزرار التحميل + يولّد QR منه. إن كان فارغًا: أظهِر "قريبًا" وعطّل الزر.

### 3.1) عدّاد التحميلات (بجانب زر التحميل)
- يُعرض رقم «عدد التحميلات» بجانب/تحت زر التحميل في الـHero (وربما في الـCTA النهائي).
- **عدّاد حقيقي عام عبر Supabase** (لأن HTML الثابت وحده لا يخزّن عبر الزوّار):
  - جدول `app_download_stats` (صف واحد) + دالة `increment_app_downloads()` (RPC، SECURITY DEFINER) + سياسة قراءة عامة (RLS). SQL في README.
  - عند تحميل الصفحة: `GET /rest/v1/app_download_stats?select=count&id=eq.1` لعرض العدد الحالي.
  - عند الضغط على زر التحميل: `POST /rest/v1/rpc/increment_app_downloads` ثم بدء التحميل.
  - **مانع تضخيم:** استخدم `localStorage` لعدّ مرة واحدة لكل متصفح كل يوم (لا تكرّر مع كل ضغطة).
  - استدعاءات `fetch` مباشرة (بدون SDK) للحفاظ على المشروع خفيفًا؛ المفتاح anon عام وآمن.
  - عند غياب `SUPABASE_URL`/`SUPABASE_ANON_KEY`: أخفِ العدّاد بلطف (fallback) دون كسر الصفحة.
- عرض رقمي أنيق (تنسيق آلاف عربي/لاتيني + رمز تحميل صغير)، مع أنيميشن عدّ تصاعدي بسيط عند الظهور.

### 4) هوية بصرية + UI/UX + Animations
- الألوان: **تيل داكن `#1e3d2f`** (لون أيقونة التطبيق) + أوف-وايت هادئ + لهجات تيل فاتحة. لا ألوان تنافسية صاخبة.
- `dir="rtl"` و`lang="ar"`، تخطيط مريح واسع المسافات، بطاقات بحواف ناعمة وظلال خفيفة.
- **تصميم عصري إبداعي**: hero بتدرّج تيل هادئ + عنصر زخرفي إسلامي خفيف (نمط هندسي SVG باهت)، mockup هاتف يعرض واجهة التطبيق.
- **حركات راقية وخفيفة** (CSS + IntersectionObserver): ظهور تدريجي عند التمرير (fade/slide up)، عدّاد بسيط للأرقام إن وُجدت، تحويم ناعم على البطاقات والأزرار، header يتقلّص عند التمرير. **كلها تحترم `prefers-reduced-motion`** وتتوقف عنده.
- بلا مكتبات animation ثقيلة — CSS transitions/keyframes + قليل من JS.

### 5) الأقسام (بالترتيب)
1. **Header لاصق** خفيف: شعار + اسم التطبيق + زر تحميل.
2. **Hero**: «المَحجّة البَيْضَاء» + وصف («منصة دروس العلم الشرعي — استمع، تابع تقدّمك، وتعلّم بسكينة») + زر تحميل رئيسي + QR + mockup هاتف.
3. **عن المنصة**: الرسالة والنبرة الهادئة.
4. **المميزات**: أقسام متداخلة، استماع مباشر + مشغّل، استئناف من آخر موضع، تحميل للاستماع دون إنترنت، متابعة تقدّم شخصية.
5. **الشيخ النذير محمد فرح**: تعريف موجز (نص placeholder).
6. **المنهج**: بطاقات (العقيدة، التوحيد، شرح كتاب التوحيد، الفقه، الحديث، التفسير، النحو والمتون…).
7. **كيفية التثبيت (APK)**: خطوات مرقّمة + ملاحظة أمان.
8. **معرض لقطات الشاشة** (placeholders).
9. **FAQ**: 6–10 أسئلة (accordion + FAQPage schema).
10. **دعوة الدعاء + CTA تحميل نهائي**.
11. **Footer**: روابط، دعم واتساب، "قريبًا على المتاجر"، حقوق، سنة تلقائية.

### 6) قائمة SEO (إلزامية — كاملة)
- `<html lang="ar" dir="rtl">`.
- `<title>` فريد ≤ 60 حرفًا يحوي "المحجة البيضاء" + كلمة قيمة.
- `<meta name="description">` ≤ 155 حرفًا جذّاب بكلمات مفتاحية، و`<meta name="keywords">`.
- `<link rel="canonical">`، `<meta name="theme-color" content="#1e3d2f">`.
- **Open Graph** كامل (og:title/description/image/url/type=website/locale=ar_AR) + **Twitter Card** (summary_large_image).
- **JSON-LD Structured Data** (وسوم `<script type="application/ld+json">`):
  - `WebSite` + `SearchAction`.
  - `SoftwareApplication` / `MobileApplication` (name، operatingSystem: Android، applicationCategory: EducationalApplication، offers price=0، downloadUrl).
  - `Organization` (الاسم، الشعار، sameAs للسوشيال).
  - `Person` (الشيخ النذير محمد فرح، jobTitle).
  - `FAQPage` (نفس أسئلة قسم FAQ).
  - `BreadcrumbList`.
- `robots.txt` (يسمح بالكل + يشير إلى sitemap) + `sitemap.xml` (مكتوب يدويًا).
- `site.webmanifest` + مجموعة favicon كاملة + `apple-touch-icon`.
- هيكل عناوين سليم: `h1` واحد فقط ثم `h2/h3`.
- `alt` وصفي بكلمات مفتاحية لكل صورة، صور `webp/avif` بأحجام مناسبة + `loading="lazy"` + `width/height` لتفادي CLS.
- أداء: CSS حرِج مضمّن في `<head>`، خطوط `preload`، لا JS معطِّل للعرض، Lighthouse 95+.
- وصولية: تباين AA، `aria-*`، تنقّل لوحة مفاتيح، `:focus-visible`.

### 7) الكلمات المفتاحية المستهدفة
**أساسية:** المحجة البيضاء، تطبيق المحجة البيضاء، تحميل تطبيق المحجة البيضاء، منصة دروس العلم الشرعي.
**الشيخ:** الشيخ النذير محمد فرح، دروس الشيخ النذير محمد فرح، شرح الشيخ النذير محمد فرح.
**المتون/المحتوى:** شرح كتاب التوحيد، كتاب التوحيد، العقيدة، التوحيد، شرح المتون العلمية، الفقه، الحديث، التفسير، النحو، الأصول.
**النية/الطلب:** علم شرعي، طلب العلم الشرعي، دروس علمية، دورات علمية شرعية، محاضرات إسلامية، دروس صوتية إسلامية، تطبيق إسلامي، تطبيق دروس صوتية، الاستماع للدروس بدون إنترنت، تطبيق تعليم شرعي.
> ابثّها طبيعيًا في العناوين والفقرات وalt (لا حشو)، وضعها في `<meta name="keywords">`.

### 8) العزل عن بناء التطبيق
- كل شيء داخل `landing/` فقط، بلا أي `import` من خارجه.
- أضف سطر `landing/` إلى `.gitignore` الجذري (يمنع رفع APK بحجم 114MB إلى GitHub الذي يحدّ الملف بـ100MB).

---

## Part C — البرومبت الجاهز لـ Sonnet (انسخه كما هو)

```
اقرأ ملف LANDING_PAGE_PLAN.md في جذر المشروع بالكامل ثم نفّذ الخطة كاملة.

المهمة: أنشئ صفحة هبوط وتحميل احترافية لتطبيق «المَحجّة البَيْضَاء» — منصة دروس علم شرعي، عربية RTL، نبرة هادئة غير تنافسية.

قيود إلزامية:
- HTML + CSS + JavaScript خام فقط. لا إطار عمل، لا build step، لا node_modules، لا CDN خارجي (كل شيء محلي).
- مشروع مستقل تمامًا داخل مجلد landing/ فقط. ممنوع أي استيراد أو اعتماد على كود تطبيق Expo (app/ أو src/ أو React Native). قابل للنقل/الحذف دون التأثير على بناء التطبيق. أضف سطر landing/ إلى .gitignore الجذري.
- الهوية البصرية: تيل داكن #1e3d2f + أوف-وايت هادئ، تصميم عصري إبداعي، مع لمسة زخرفة إسلامية هندسية خفيفة. dir="rtl" lang="ar".

مهم — ملف APK جاهز بالفعل في landing/downloads/almahajja-albaydaa.apk. لا تحذفه ولا تعِد تسميته. أزرار التحميل ورمز QR تشير إليه.

رابط التحميل: لا تستخدم .env. أنشئ config.js فيه window.APP_CONFIG = { DOWNLOAD_URL:"/downloads/almahajja-albaydaa.apk", WHATSAPP_URL:"", PLAYSTORE_URL:"", APPSTORE_URL:"", SITE_URL:"https://example.com", SUPABASE_URL:"", SUPABASE_ANON_KEY:"" }. اجعل main.js يقرأ DOWNLOAD_URL لضبط الأزرار وتوليد QR (بمكتبة QR صغيرة محلية). إن كان DOWNLOAD_URL فارغًا اعرض "قريبًا" وعطّل الزر.

عدّاد التحميلات (بجانب زر التحميل في الـHero + الـCTA النهائي): اعرض رقم عدد التحميلات. استخدم Supabase عبر fetch مباشر (بدون SDK): عند تحميل الصفحة اقرأ العدد من GET {SUPABASE_URL}/rest/v1/app_download_stats?select=count&id=eq.1 (ترويسة apikey + Authorization بالـanon key)، وعند الضغط على زر التحميل استدعِ POST {SUPABASE_URL}/rest/v1/rpc/increment_app_downloads ثم ابدأ التحميل. امنع التضخيم بـ localStorage (عدّة مرة واحدة لكل متصفح كل يوم). إن كان SUPABASE_URL أو SUPABASE_ANON_KEY فارغًا فأخفِ العدّاد بلطف دون كسر الصفحة. اعرضه بتنسيق أنيق مع أنيميشن عدّ تصاعدي بسيط عند الظهور. ضع SQL اللازم (جدول app_download_stats + دالة increment_app_downloads + سياسة RLS للقراءة) في README داخل landing/.

UI/UX + حركات: خطوط عربية مستضافة ذاتيًا woff2 مع preload. تصميم واسع المسافات، بطاقات ناعمة، mockup هاتف في الـHero. حركات راقية خفيفة (CSS transitions/keyframes + IntersectionObserver): ظهور تدريجي عند التمرير، تحويم ناعم، header يتقلّص عند التمرير. كلها تحترم prefers-reduced-motion وتتوقف عنده. بلا مكتبات animation ثقيلة.

الأقسام (Part B §5): Header لاصق، Hero (اسم + وصف + زر تحميل + QR + mockup هاتف)، عن المنصة، المميزات (أقسام متداخلة/مشغّل/استئناف/تحميل بلا إنترنت/تقدّم شخصي)، الشيخ النذير محمد فرح (placeholder)، المنهج (بطاقات: العقيدة، التوحيد، شرح كتاب التوحيد، الفقه، الحديث، التفسير…)، كيفية تثبيت APK (خطوات مرقّمة)، معرض لقطات شاشة (placeholders)، FAQ accordion (6–10 أسئلة)، دعوة الدعاء + CTA نهائي، Footer (دعم واتساب + شارات "قريبًا على المتاجر" + سنة تلقائية).

SEO — نفّذ Part B §6 كاملة: title/description/keywords مثاليان، canonical، theme-color، Open Graph + Twitter Card، og-image 1200×630، favicon كامل + site.webmanifest + apple-touch-icon. JSON-LD: WebSite+SearchAction، SoftwareApplication/MobileApplication (Android مجاني + downloadUrl)، Organization، Person (الشيخ)، FAQPage، BreadcrumbList. robots.txt + sitemap.xml مكتوبان يدويًا. h1 واحد، هيكل عناوين سليم، alt وصفي، صور lazy مع width/height، CSS حرِج مضمّن، Lighthouse 95+، وصولية AA مع focus-visible. استهدف كلمات Part B §7 وابثّها طبيعيًا.

المخرجات: مجلد landing/ كامل يفتح مباشرة (index.html يعمل بفتحه في المتصفح أو عبر خادم ثابت)، نصوص عربية واقعية جاهزة (placeholder فقط لسيرة الشيخ ولقطات الشاشة)، وREADME.md داخل landing/ يشرح المعاينة والنشر وكيفية استبدال APK للترقية (نفس الاسم + رفع versionCode + نفس keystore). لا تلمس أي ملف خارج landing/ عدا سطر landing/ في .gitignore الجذري.
```

---

## Part D — بعد الانتهاء (خطواتك أنت)
1. افتح `landing/index.html` مباشرة، أو `npx serve landing` للمعاينة عبر خادم.
2. عدّل `SITE_URL` (وروابط واتساب/المتاجر) في `config.js`. رابط التحميل ثابت وجاهز.
3. انشر محتوى `landing/` على Netlify/Vercel/Cloudflare Pages/GitHub Pages.
4. أضف الموقع إلى **Google Search Console** وأرسل `sitemap.xml`.
5. **للترقية مستقبلًا:** ارفع versionCode + استخدم نفس keystore، ثم استبدل `landing/downloads/almahajja-albaydaa.apk` بنفس الاسم — الرابط يبقى ثابتًا.
6. **تنبيه الحجم:** الملف 114MB. GitHub يحدّ الملف بـ100MB (لذلك landing/ في .gitignore). للنشر يُخدَم من الاستضافة مباشرة؛ أو استضِفه على Supabase Storage وغيّر DOWNLOAD_URL فقط.
