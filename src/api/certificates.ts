/**
 * «شهادة إتمام القسم» — phase 1: the section's certificate settings (admin) and
 * the central eligibility check (migration 0168). Issuing, the certificate
 * itself and the student's certificates screen come in the next phase; they
 * will call {@link getCertificateEligibility} — the one definition of
 * "is this student eligible", computed server-side (certificate_eligibility).
 *
 * `as never`: the 0168 RPCs are not in database.generated.ts until the types
 * are regenerated after the production deploy.
 */
import { supabase } from '@/lib/supabase';

/** «نطاق محتوى الشهادة»: this section's own lectures, or the whole path below it. */
export type CertificateContentScope = 'section' | 'subtree';
export type CertificateLectureRule = 'all' | 'percent';
export type CertificateQuizRule = 'none' | 'selected';

/** A quiz of the section's subtree, as offered in the settings picker. */
export type CertificateQuizOption = {
  id: string;
  title: string;
  sectionId: string;
  sectionTitle: string;
  published: boolean;
  selected: boolean;
};

export type SectionCertificateSettings = {
  sectionId: string;
  enabled: boolean;
  contentScope: CertificateContentScope;
  lectureRule: CertificateLectureRule;
  /** Required share of the lectures (1–100) when lectureRule = 'percent'; else null. */
  lecturePct: number | null;
  quizRule: CertificateQuizRule;
  quizzes: CertificateQuizOption[];
};

export type SaveSectionCertificateInput = {
  sectionId: string;
  enabled: boolean;
  contentScope: CertificateContentScope;
  lectureRule: CertificateLectureRule;
  lecturePct: number | null;
  quizRule: CertificateQuizRule;
  quizIds: string[];
};

export type CertificateEligibility = {
  sectionId: string;
  userId: string;
  enabled: boolean;
  eligible: boolean;
  lectures: {
    /** Which lectures are counted: this section only, or its whole subtree. */
    scope: CertificateContentScope;
    rule: CertificateLectureRule;
    pct: number | null;
    total: number;
    completed: number;
    /** Lectures the student must complete (all of them, or ⌈total × pct ⁄ 100⌉). */
    required: number;
    /** completed ⁄ total × 100 (two decimals; 0 when there is no lecture). */
    completedPct: number;
    met: boolean;
  };
  quizzes: {
    rule: CertificateQuizRule;
    requiredCount: number;
    passedCount: number;
    met: boolean;
    items: { quizId: string; title: string; passed: boolean; pendingGrading: boolean }[];
  };
};

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const contentScope = (v: unknown): CertificateContentScope => (v === 'subtree' ? 'subtree' : 'section');
const lectureRule = (v: unknown): CertificateLectureRule => (v === 'percent' ? 'percent' : 'all');
const quizRule = (v: unknown): CertificateQuizRule => (v === 'selected' ? 'selected' : 'none');

/** get_section_certificate_settings jsonb → client shape. Exported for tests. */
export function parseCertificateSettings(raw: unknown, sectionId: string): SectionCertificateSettings {
  const r = (raw ?? {}) as Record<string, any>;
  const rule = lectureRule(r.lecture_rule);
  return {
    sectionId: typeof r.section_id === 'string' ? r.section_id : sectionId,
    enabled: r.enabled === true,
    contentScope: contentScope(r.content_scope),
    lectureRule: rule,
    lecturePct: rule === 'percent' && typeof r.lecture_pct === 'number' ? r.lecture_pct : null,
    quizRule: quizRule(r.quiz_rule),
    quizzes: Array.isArray(r.quizzes)
      ? r.quizzes.map((q: Record<string, any>) => ({
          id: String(q.id),
          title: String(q.title ?? ''),
          sectionId: String(q.section_id ?? ''),
          sectionTitle: String(q.section_title ?? ''),
          published: q.status === 'published',
          selected: q.selected === true,
        }))
      : [],
  };
}

/** certificate_eligibility jsonb → client shape. Exported for tests. */
export function parseCertificateEligibility(raw: unknown): CertificateEligibility {
  const r = (raw ?? {}) as Record<string, any>;
  const l = (r.lectures ?? {}) as Record<string, any>;
  const q = (r.quizzes ?? {}) as Record<string, any>;
  return {
    sectionId: String(r.section_id ?? ''),
    userId: String(r.user_id ?? ''),
    enabled: r.enabled === true,
    eligible: r.eligible === true,
    lectures: {
      scope: contentScope(l.scope),
      rule: lectureRule(l.rule),
      pct: typeof l.pct === 'number' ? l.pct : null,
      total: num(l.total),
      completed: num(l.completed),
      required: num(l.required),
      completedPct: num(Number(l.completed_pct)),
      met: l.met === true,
    },
    quizzes: {
      rule: quizRule(q.rule),
      requiredCount: num(q.required_count),
      passedCount: num(q.passed_count),
      met: q.met === true,
      items: Array.isArray(q.items)
        ? q.items.map((i: Record<string, any>) => ({
            quizId: String(i.quiz_id),
            title: String(i.title ?? ''),
            passed: i.passed === true,
            pendingGrading: i.pending_grading === true,
          }))
        : [],
    },
  };
}

/**
 * Client-side validation mirroring set_section_certificate_settings, so the
 * editor can explain the problem before saving. Null = valid. (The server stays
 * authoritative.)
 */
export function certificateSettingsError(input: SaveSectionCertificateInput): string | null {
  if (!input.enabled) return null; // turning it off never blocks saving the section
  if (input.lectureRule === 'percent') {
    const p = input.lecturePct;
    if (p === null || !Number.isInteger(p) || p < 1 || p > 100) {
      return 'نسبة المحاضرات المطلوبة يجب أن تكون بين ١ و١٠٠';
    }
  }
  if (input.quizRule === 'selected' && input.quizIds.length === 0) {
    return 'اختر اختبارًا واحدًا على الأقل';
  }
  return null;
}

export async function getSectionCertificateSettings(sectionId: string): Promise<SectionCertificateSettings> {
  const { data, error } = await supabase.rpc(
    'get_section_certificate_settings' as never,
    { p_section: sectionId } as never,
  );
  if (error) throw error;
  return parseCertificateSettings(data, sectionId);
}

export async function saveSectionCertificateSettings(input: SaveSectionCertificateInput): Promise<void> {
  // A disabled certificate keeps its conditions; if they are incomplete, store
  // the safe defaults instead of failing the section save.
  const valid = certificateSettingsError({ ...input, enabled: true }) === null;
  const keep = input.enabled || valid;
  const { error } = await supabase.rpc(
    'set_section_certificate_settings' as never,
    {
      p_section: input.sectionId,
      p_enabled: input.enabled,
      p_content_scope: input.contentScope,
      p_lecture_rule: keep ? input.lectureRule : 'all',
      p_lecture_pct: keep && input.lectureRule === 'percent' ? input.lecturePct : null,
      p_quiz_rule: keep ? input.quizRule : 'none',
      p_quiz_ids: keep && input.quizRule === 'selected' ? input.quizIds : [],
    } as never,
  );
  if (error) throw error;
}

/**
 * Is the student eligible for the section's certificate? `userId` omitted = the
 * signed-in user; another user needs a content manager (enforced server-side).
 */
export async function getCertificateEligibility(
  sectionId: string,
  userId?: string,
): Promise<CertificateEligibility> {
  const { data, error } = await supabase.rpc(
    'certificate_eligibility' as never,
    { p_section: sectionId, p_user: userId ?? null } as never,
  );
  if (error) throw error;
  return parseCertificateEligibility(data);
}
