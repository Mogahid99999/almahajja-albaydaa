/**
 * Idempotent seed: writes the «التعريف بالشيخ» bio text (Item 8) onto the
 * existing sheikh row for فضيلة الشيخ النذير محمد فرح — matched by its known
 * id (it already has 3 lectures attached; matching by id, not by upserting on
 * name, avoids ever creating a duplicate row and splitting his lectures).
 *
 * Run:  node scripts/seed-sheikh-bio.mjs
 * Needs (from .env or shell env): EXPO_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const out = {};
  try {
    const raw = readFileSync(join(root, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2];
    }
  } catch {}
  return out;
}

const env = { ...loadEnv(), ...process.env };
const URL = env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SECRET_KEY;
if (!URL || !KEY) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env');
  process.exit(1);
}

const SHEIKH_ID = '7d14315d-1211-4f72-a8ca-8308ed78e1f8'; // فضيلة الشيخ النذير محمد فرح

const BIO = `## الاسم والميلاد
الشيخ النذير محمد فرح عثمان، وُلد عام 1984م.

## من رحلته العلمية
درس علوم المختبرات الطبية، وتخصّص في أمراض الدم والمناعة، ثم شرح الله صدره لطلب العلم الشرعي، فالتحق بالمعهد العالي للدراسات الإسلامية، ودرس فيه عددًا من العلوم الشرعية، ثم واصل التلقي والجلوس بين يدي جماعة من العلماء والمشايخ، في السودان أولًا، ثم في المدينة المنورة على ساكنها أفضل الصلاة والسلام.

## من أبرز مشايخه في السودان
- الشيخ الدكتور علي أبو الفتح — التجويد (1996م)
- الشيخ الدكتور عبد الرحمن حسن فرح — متفرقات (1998م)
- الشيخ الدكتور خالد عبد اللطيف محمد نور، من طلاب العلامة ابن عثيمين رحمه الله — العقيدة: كتاب التوحيد، القواعد المثلى في أسماء الله وصفاته الحسنى، شرح اعتقاد أهل السنة والجماعة للالكائي، شرح السنة للإمام أحمد بن حنبل، كتاب الشريعة للآجري، شرح العقيدتين الواسطية والطحاوية، وغيرها من كتب العقيدة
- الشيخ الدكتور محمد إبراهيم البَلّه — أصول الدعوة والعقيدة
- الشيخ الدكتور أنور حسب الرسول — مصطلح الحديث: نخبة الفكر لابن حجر العسقلاني، نزهة النظر، والمنظومة البيقونية
- الشيخ الدكتور علي القدّال — الفرائض (الميراث)
- الشيخ الدكتور عماد خلف الله — أصول الفقه
- الشيخ حسين الجيلاني رحمه الله، تلميذ العلامة ابن باز رحمه الله — الفقه على المذاهب الأربعة
- الشيخ أحمد الحاج — علوم القرآن
- الشيخ لقمان — التفسير
- الشيخ الدكتور شمس المعارف البدري — مناهج البحث العلمي
- الشيخ الدكتور عثمان بابكر — شرح السنة
- الشيخ الدكتور آدم كدفور — الآجرومية وألفية ابن مالك

وغيرهم من مشايخ السودان، جزاهم الله عنه كل خير، وذلك عبر دروس منتظمة ودورات متفرقة.

## مشايخه في المدينة المنورة
جلس الشيخ لعدد من علماء المدينة المنورة، وما يزال بفضل الله، منذ عام 2018م وإلى الآن، منهم:

- الشيخ العلامة الدكتور عبد المحسن العباد البدر، محدّث المدينة النبوية حفظه الله — فقه العبادات
- الشيخ الدكتور عبد الرزاق بن العلامة عبد المحسن البدر حفظه الله — العقيدة بمستوياتها، وأحاديث الأحكام، ودراسة الحديث، وشرح رياض الصالحين
- الشيخ الدكتور سليمان الرحيلي، إمام وخطيب مسجد قباء بالمدينة المنورة — شرح صحيح الترغيب والترهيب
- الشيخ الدكتور صالح العصيمي — برنامج مهمات العلم، والسرد المجرّد لصحيح البخاري
- الشيخ الدكتور سليمان الشويعر — شرح منظومة القواعد الفقهية للعلامة السعدي

## ختامًا
وما ذُكر هنا هو من باب التعريف لا من باب التزكية، نسأل الله تعالى أن يرزقه الإخلاص والسداد، وأن يجزي مشايخه عنه خير الجزاء، وأن ينفعنا بما علّمنا، ويجعلنا من أهل الاتباع والأثر.`;

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

try {
  const res = await fetch(`${URL}/rest/v1/sheikhs?id=eq.${SHEIKH_ID}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({ bio: BIO }),
  });
  if (!res.ok) throw new Error(`sheikhs patch ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  if (!rows.length) throw new Error(`no sheikh row found with id=${SHEIKH_ID}`);
  console.log(`✓ bio saved for «${rows[0].name}» (id=${rows[0].id})`);
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exitCode = 1;
}
