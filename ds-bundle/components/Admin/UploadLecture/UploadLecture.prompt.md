لوحة الإدارة — رفع محاضرة: شاشة سطح المكتب لرفع محاضرة صوتية وإدراجها في شجرة الأقسام (١٤٤٠×٩٠٠، ويب، RTL).

# UploadLecture — رفع محاضرة (Admin)

Desktop web screen where a content manager uploads a new audio lecture and files it into the section tree. Denser than the student app but the same calm identity. RTL two-pane app shell.

## Shell
- **Sidebar (right, 252px, teal)** — logo + "لوحة الإدارة", nav (لوحة المعلومات، المحاضرات [active], الأقسام والشجرة، المشايخ، التعليقات، الإعدادات), user chip pinned bottom. Active item = `rgba(201,164,99,.16)` bg + brass rhombus bullet; inactive items use a hollow brass-stroke rhombus.
- **Topbar (64px, `#f8f3e8`)** — breadcrumb "المحاضرات / رفع محاضرة جديدة", notifications + avatar.
- **Content (30px padding)** — page title (Amiri 27/700 teal) + subtitle; top-right actions "إلغاء" (outline) + "حفظ المحاضرة" (teal). Two-column grid: `1fr 320px`.

## Left column — three cards
1. **المعلومات الأساسية** — title text input (46px, radius 12, focus → border `#2c6157` + `0 0 0 3px rgba(31,74,66,.1)`); audio uploaded-state row (teal waveform tile, filename, "٢٤٫٨ ميجابايت · ٣٠:١٥ دقيقة · تم الرفع", remove ×).
2. **التصنيف والترتيب** — **searchable nested-tree dropdown** for القسم/العنصر الأب (shown open here): breadcrumb-path chips with the leaf in a teal-tint pill, an overlay with a search input filtering a flat-rendered tree, nodes indented by depth (`padding-right: 12 + depth*20 px`), depth-0 = filled teal rhombus bullet, deeper = brass ring. Plus رقم الترتيب (140px numeric, centered, Arabic numerals) and اسم الشيخ (select-style).
3. **المرفقات** — dashed-brass dropzone + an attached-file row (تفريغ-المحاضرة.pdf).

## Right rail (sticky, 320px)
- **حالة النشر** — segmented control مسودة / منشورة (this card shows **draft** selected = white segment with shadow). Status note + colored dot (`#b0894f` draft / `#1f8a5b` published). Created/modified dates. Primary submit whose label switches "حفظ كمسودة" ↔ "نشر المحاضرة", plus a "معاينة" outline button.
- **Tip card** (dashed brass) about matching the order number to the lesson sequence.
