/**
 * Editable «عن المنصة» content + Telegram live link (Feature 6), stored in the
 * world-readable `app_config` table (migration 0021/0023). Reads fall back to
 * the original hard-coded copy when a key is empty, so the page never looks
 * broken. Writes go through the admin-only DEFINER `set_app_config`.
 */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';
import type { AboutContent } from './types';

/** The original hard-coded About copy — mirrors the 0023 seed exactly. */
export const ABOUT_FALLBACK: AboutContent = {
  intro:
    '«هذه المنصة تهدف إلى تنظيم دروس العلم الشرعي وتيسير الوصول إليها، وجمع التسجيلات المتفرقة في مكان واحد مرتب يعين الطالب على المتابعة والمراجعة.»',
  dua: '«نسأل الله أن يجعل هذا العمل خالصًا لوجهه الكريم، وأن ينفع به طلاب العلم.»',
  thanks:
    '«لا تنسوا من ساهم في هذا العمل من دعائكم: المشايخ، ومن جمع المادة، ومن راجعها، ومن طوّر المنصة، ومن نشرها وساهم فيها.»',
  closing: '«نفع الله بكم، وبارك في علمكم ووقتكم.»',
  telegramIntro: 'تُبثّ الدروس مباشرة على قناتنا في تلجرام، فتابِع الحلقة أولًا بأول.',
  telegramUrl: '',
  telegramLabel: 'فتح قناة تلجرام',
};

const ABOUT_KEYS = [
  'about_intro',
  'about_dua',
  'about_thanks',
  'about_closing',
  'telegram_intro',
  'telegram_url',
  'telegram_label',
];

export async function getAboutContent(): Promise<AboutContent> {
  if (USE_MOCK) return ABOUT_FALLBACK;
  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('key, value')
      .in('key', ABOUT_KEYS);
    if (error || !data) return ABOUT_FALLBACK;
    const m = new Map(data.map((r) => [r.key, r.value]));
    return {
      intro: m.get('about_intro') || ABOUT_FALLBACK.intro,
      dua: m.get('about_dua') || ABOUT_FALLBACK.dua,
      thanks: m.get('about_thanks') || ABOUT_FALLBACK.thanks,
      closing: m.get('about_closing') || ABOUT_FALLBACK.closing,
      telegramIntro: m.get('telegram_intro') || ABOUT_FALLBACK.telegramIntro,
      // Empty URL = hide the button; never fall back to a non-empty default.
      telegramUrl: m.get('telegram_url') ?? '',
      telegramLabel: m.get('telegram_label') || ABOUT_FALLBACK.telegramLabel,
    };
  } catch {
    return ABOUT_FALLBACK;
  }
}

/** Support contact keys (V8 · Feature A). */
const SUPPORT_KEYS = ['support_whatsapp_url'];

/**
 * WhatsApp support link shown on the sign-in screen. Empty = the line stays
 * hidden (same "empty = hidden" convention as the About Telegram button). Falls
 * back to empty on any error so sign-in never looks broken.
 */
export async function getSupportContact(): Promise<{ whatsappUrl: string }> {
  if (USE_MOCK) return { whatsappUrl: '' };
  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('key, value')
      .in('key', SUPPORT_KEYS);
    if (error || !data) return { whatsappUrl: '' };
    const m = new Map(data.map((r) => [r.key, r.value]));
    return { whatsappUrl: m.get('support_whatsapp_url') ?? '' };
  } catch {
    return { whatsappUrl: '' };
  }
}

/** Q&A notice keys (V12 · Item 7). */
const QNA_KEYS = ['qna_notice_text'];
const QNA_NOTICE_FALLBACK =
  'سيتم الإجابة عن جميع الأسئلة بإذن الله من قِبل الشيخ خلال فترة قصيرة';

/**
 * Small notice shown above the Q&A boards ("answers may take a little
 * while"). Falls back to the original copy so the page never looks broken.
 */
export async function getQnaNotice(): Promise<{ text: string }> {
  if (USE_MOCK) return { text: QNA_NOTICE_FALLBACK };
  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('key, value')
      .in('key', QNA_KEYS);
    if (error || !data) return { text: QNA_NOTICE_FALLBACK };
    const m = new Map(data.map((r) => [r.key, r.value]));
    return { text: m.get('qna_notice_text') || QNA_NOTICE_FALLBACK };
  } catch {
    return { text: QNA_NOTICE_FALLBACK };
  }
}

/** Share-the-app keys — admin-editable link + phrase for the native share sheet. */
const SHARE_KEYS = ['share_app_url', 'share_app_message'];
const SHARE_FALLBACK = {
  url: 'https://almahajja.app',
  message: 'جرّب تطبيق المحجة البيضاء لدروس العلم الشرعي',
};

/**
 * Share-the-app link + phrase (Feather "share-2" row on Profile). Falls back
 * to a hardcoded default so Share never looks broken before an admin sets it.
 */
export async function getShareContent(): Promise<{ url: string; message: string }> {
  if (USE_MOCK) return SHARE_FALLBACK;
  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('key, value')
      .in('key', SHARE_KEYS);
    if (error || !data) return SHARE_FALLBACK;
    const m = new Map(data.map((r) => [r.key, r.value]));
    return {
      url: m.get('share_app_url') || SHARE_FALLBACK.url,
      message: m.get('share_app_message') || SHARE_FALLBACK.message,
    };
  } catch {
    return SHARE_FALLBACK;
  }
}

/** «ابدأ من هنا» key — the lecture recommended right after the first-time tour. */
const START_HERE_KEYS = ['start_here_lecture_id'];

/**
 * The lecture the post-tour «ابدأ من هنا» popup (StartHereCard) recommends to a
 * newly registered student. Resolves the `start_here_lecture_id` config key to
 * the actual published lecture; null (key empty, lecture deleted/unpublished,
 * or any error) = the popup simply never shows — same "empty = hidden"
 * convention as telegram_url.
 */
export async function getStartHereLecture(): Promise<{ id: string; title: string } | null> {
  if (USE_MOCK) return null;
  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('value')
      .in('key', START_HERE_KEYS)
      .maybeSingle();
    if (error) return null;
    const id = data?.value?.trim();
    if (!id) return null;
    const { data: lecture, error: lectureError } = await supabase
      .from('lectures')
      .select('id, title')
      .eq('id', id)
      .eq('status', 'published')
      .maybeSingle();
    if (lectureError) return null;
    return lecture ?? null;
  } catch {
    return null;
  }
}

/** All config keys the admin Settings screen edits (About + Telegram + V4 gate). */
export type AppConfigMap = Record<string, string>;

const SETTINGS_KEYS = [
  ...ABOUT_KEYS,
  ...SUPPORT_KEYS,
  ...QNA_KEYS,
  ...SHARE_KEYS,
  ...START_HERE_KEYS,
  'min_app_version',
  'app_download_url',
  'latest_app_version',
  'latest_released_at',
  'admin_notify_email',
];

export async function getAppConfigForAdmin(): Promise<AppConfigMap> {
  if (USE_MOCK) return {};
  const { data, error } = await supabase
    .from('app_config')
    .select('key, value')
    .in('key', SETTINGS_KEYS);
  if (error) throw error;
  const out: AppConfigMap = {};
  for (const r of data ?? []) out[r.key] = r.value ?? '';
  return out;
}

export async function setAppConfig(key: string, value: string): Promise<void> {
  const { error } = await supabase.rpc('set_app_config', { p_key: key, p_value: value });
  if (error) throw error;
}
