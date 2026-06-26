صفحة القسم — قالب عام قابل لإعادة الاستخدام يُعرض في كل مستوى من شجرة الأقسام (٣٩٠×٨٤٤، موبايل، RTL).

# SectionPage — صفحة القسم

A **generic, reusable** node page that renders at every level of the subject tree (top subject, sub-topic, book) — same template for العقيدة, التوحيد, كتاب التوحيد, etc. Data-driven: feed it `{ title, description, sheikh, lectureCount, progress, subsections[], lectures[] }`.

## Layout
- **Nav bar** — back chevron (points right `›`), parent-context label ("العقيدة"), search.
- **Header badge** — vertical teal badge (58px wide, ≥74px tall, radius 18) with the section name in condensed Amiri (`transform: scaleX(.82)`, brass `#c9a463`). The name lives **inside** the badge — no separate letter icon. Description (13px `#6b6253`) beside it.
- **Meta row** — sheikh (rhombus bullet) · lecture count.
- **Progress card** (`#fbf7ed`) — "تقدّمك في القسم" + percentage (teal 700), 7px gradient track (`#1f4a42 → #2c6157`), "أكملت ١٦ من ٤٢ محاضرة".
- **"الأقسام الفرعية"** — horizontal snap scroller of 152px cards (letter tile + left chevron, Amiri name, count). Hidden when the node is a leaf.
- **"محاضرات القسم"** — flat list in one rounded card, rows split by `#ece3cf` hairlines.

## Lecture row states (34px round indicator)
- **not started** — sand bg + ghost dot; label "لم تبدأ".
- **in progress** — teal bg + brass play triangle; brass label "قيد الاستماع · ١٢:٣٠".
- **completed** — teal-tint bg + green check `#1f8a5b`; label "مكتملة"; title dimmed to `#6b6253`; download shows filled/checked variant.
