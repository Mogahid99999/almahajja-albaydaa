/**
 * Notification phrase bank (PLAN_V3 §4 + §11) — the single source of truth for
 * every notification's wording. Each event maps to a small bank of calm,
 * non-gamified Arabic variants; `pickPhrase` rotates through them round-robin so
 * the same literal sentence never repeats back-to-back.
 *
 * Verbatim from PLAN_V3 §11 — do not paraphrase. Placeholders are bracketed
 * Arabic tokens (`[اسم السلسلة]`, `[عدد]`, `[اسم القسم]`, `[اسم الدرس]`)
 * interpolated at call time via the `vars` map.
 *
 * LOCAL types (resume/*, completion, noncompletion, daily, series, goal_done)
 * are drawn here on-device. PUSH types (new_lecture / new_attachment) each have a
 * single phrase and are resolved server-side in the fan-out SQL / Edge Function;
 * they live here too so the wording has one home.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

/** One bank per notification sub-variant. */
export type PhraseEvent =
  | 'resume_general'
  | 'resume_near'
  | 'resume_longgap'
  | 'completion'
  | 'noncompletion'
  | 'daily'
  | 'series'
  | 'goal_midweek'
  | 'goal_2days'
  | 'goal_done'
  | 'new_lecture'
  | 'new_attachment';

/** Verbatim §11 banks. Order is the rotation order. */
export const PHRASE_BANK: Record<PhraseEvent, string[]> = {
  // استئناف عام (any %)
  resume_general: [
    'أكمل من حيث توقفت، ولك بكل حرف تسمعه أجر',
    'درسك بانتظارك، استكمل واغتنم الأجر',
    'خطوة واحدة تفصلك عن إكمال الدرس وأجره',
    'عد لدرسك، فالقليل المستمر خير من الكثير المنقطع',
  ],
  // استئناف قريب من النهاية (>70%)
  resume_near: [
    'اقتربت من إكمال الدرس، أكمل أجرك',
    'بقي القليل، لا تقطعه الآن وقد أوشكت',
    'أوشكت على الختام، أتمه ولك الأجر كاملًا',
    'خطوات يسيرة وتكتمل لك المحاضرة وأجرها',
  ],
  // استئناف بعد انقطاع طويل (>3 أيام)
  resume_longgap: [
    'ما زال درسك ينتظر استكمالك',
    'عد لدرسك متى ما تيسر، فالقليل المستمر خير من الكثير المنقطع',
    'لم يفتك الأجر بعد، درسك كما تركته',
  ],
  // إكمال الدرس
  completion: [
    'أتممت الدرس، نفعك الله بما تعلمت',
    'ختمت هذا الدرس، تقبل الله منك',
    'أحسنت، أكملت درسًا جديدًا، نفعك الله به وزادك علمًا',
    'تم حفظ تقدمك، نفعك الله بما سمعت',
  ],
  // عدم الإكمال (تذكير لطيف)
  noncompletion: [
    'توقفت قبل أن تكمل، عد إليه حين تستطيع وأجرك محفوظ',
    'لا بأس، أكمل لاحقًا، فالعلم لا يفوته إلا من ترك',
    'احفظ موضعك، ودرسك سينتظرك كما تركته',
  ],
  // تذكير يومي عام
  daily: [
    'ألا تزور درسك اليوم؟ ولو لدقائق يكتب الله لك أجرها',
    'يوم جديد، وفرصة جديدة لطلب العلم وتحصيل أجره',
    'اجعل لهذا اليوم نصيبًا من العلم، ولو يسيرًا',
  ],
  // متابعة سلسلة لم تكتمل ([اسم السلسلة] / [عدد])
  series: [
    'ما زلت في منتصف سلسلة [اسم السلسلة]، أكملها ولا تقطعها',
    'بقي لك [عدد] دروس من سلسلة [اسم السلسلة]، أكملها واغتنم أجرها',
  ],
  // الهدف الأسبوعي — منتصف الأسبوع
  goal_midweek: [
    'أنت في منتصف الطريق نحو هدفك الأسبوعي، واصل ولك الأجر',
    'هدفك الأسبوعي قريب، لا تدعه يفوتك',
  ],
  // الهدف الأسبوعي — قبل يومين
  goal_2days: [
    'بقي القليل من الوقت لإكمال هدف هذا الأسبوع',
    'يومان وينتهي الأسبوع، أكمل ما تبقى من هدفك',
  ],
  // الهدف الأسبوعي — إكمال
  goal_done: ['أكملت هدفك هذا الأسبوع، نفعك الله وبارك في وقتك'],
  // محتوى جديد — درس ([اسم القسم]). "الذي تتابعه" dropped (now a full broadcast).
  new_lecture: ['أُضيف درس جديد في [اسم القسم]'],
  // محتوى جديد — مرفق ([اسم الدرس])
  new_attachment: ['أُضيف مرفق جديد يساعدك في [اسم الدرس]'],
};

/** Round-robin cursor per event, persisted so consecutive picks differ. */
const ROTATION_KEY = 'riwaq-phrase-rotation';

/**
 * Next round-robin index for an event, advancing + persisting the cursor. Falls
 * back to a random index if storage is unavailable (cosmetic — a reset just
 * means the rotation restarts, per §13).
 */
async function nextIndex(event: PhraseEvent, len: number): Promise<number> {
  if (len <= 1) return 0;
  try {
    const raw = await AsyncStorage.getItem(ROTATION_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    const prev = typeof map[event] === 'number' ? map[event] : -1;
    const next = (prev + 1) % len;
    map[event] = next;
    await AsyncStorage.setItem(ROTATION_KEY, JSON.stringify(map));
    return next;
  } catch {
    return Math.floor(Math.random() * len);
  }
}

/**
 * Pick the next variant for an event (round-robin) and interpolate any bracketed
 * placeholders. `vars` keys are the full bracketed tokens, e.g.
 * `{ '[اسم السلسلة]': 'الأصول الثلاثة', '[عدد]': 4 }`.
 */
export async function pickPhrase(
  event: PhraseEvent,
  vars?: Record<string, string | number>,
): Promise<string> {
  const bank = PHRASE_BANK[event];
  const idx = await nextIndex(event, bank.length);
  let phrase = bank[idx];
  if (vars) {
    for (const [token, value] of Object.entries(vars)) {
      phrase = phrase.split(token).join(String(value));
    }
  }
  return phrase;
}
