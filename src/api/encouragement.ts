/**
 * «تشجيع رفيقك» — canned buddy encouragement (V20 · §14). Fixed phrases only, no
 * free text, one per buddy per 24h (server-enforced, migration 0113). Sending
 * delivers a notification to the buddy; there's no message thread.
 */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';

/** The 8 fixed phrases (mirror of encouragement_phrase in SQL). */
export const ENCOURAGEMENT_PHRASES: { key: string; text: string }[] = [
  { key: 'p1', text: 'بارك الله في سعيك ونفعك بما تعلمت.' },
  { key: 'p2', text: 'نفعنا الله بهذه الرفقة وأعاننا على الاستمرار.' },
  { key: 'p3', text: 'نسأل الله أن يجمعنا على الخير وفي الجنة.' },
  { key: 'p4', text: 'أعانك الله على مواصلة طلب العلم.' },
  { key: 'p5', text: 'بقي القليل على هدفنا، بارك الله في همتك.' },
  { key: 'p6', text: 'هيا نواصل رحلتنا ولو بالقليل.' },
  { key: 'p7', text: 'زادك الله علماً نافعاً وعملاً صالحاً.' },
  { key: 'p8', text: 'أسأل الله أن يثبتنا وإياك على طريق العلم.' },
];

/** Send a canned encouragement to a buddy. Throws the Arabic reason on the 24h cap. */
export async function sendEncouragement(toUserId: string, phraseKey: string): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('send_encouragement', {
    p_to_user_id: toUserId,
    p_phrase_key: phraseKey,
  });
  if (error) throw error;
}
