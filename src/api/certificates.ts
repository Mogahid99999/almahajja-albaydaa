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
/** 'none': lectures are no condition at all; the certificate rests on its quizzes (0173). */
export type CertificateLectureRule = 'none' | 'all' | 'percent';
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
} & CertificateDetails;

/** What the certificate prints (0170). Blank title = the section's title; no author = no line. */
export type CertificateDetails = {
  certificateTitle: string;
  author: string;
  presenterName: string;
  /** «بشرح» / «تقديم» / any other wording. */
  presentationForm: string;
  customText: string;
};

export type SaveSectionCertificateInput = {
  sectionId: string;
  enabled: boolean;
  contentScope: CertificateContentScope;
  lectureRule: CertificateLectureRule;
  lecturePct: number | null;
  quizRule: CertificateQuizRule;
  quizIds: string[];
} & CertificateDetails;

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
const lectureRule = (v: unknown): CertificateLectureRule => (v === 'percent' || v === 'none' ? v : 'all');
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
    certificateTitle: typeof r.certificate_title === 'string' ? r.certificate_title : '',
    author: typeof r.author === 'string' ? r.author : '',
    presenterName: typeof r.presenter_name === 'string' ? r.presenter_name : '',
    presentationForm: typeof r.presentation_form === 'string' && r.presentation_form ? r.presentation_form : 'بشرح',
    customText: typeof r.custom_text === 'string' ? r.custom_text : '',
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
export function certificateSettingsError(
  input: SaveSectionCertificateInput,
  quizzes?: Pick<CertificateQuizOption, 'id' | 'published'>[],
): string | null {
  if (!input.enabled) return null; // turning it off never blocks saving the section
  if (!input.presenterName?.trim()) return 'اكتب اسم مقدم المادة كما يظهر على الشهادة';
  if (input.lectureRule === 'percent') {
    const p = input.lecturePct;
    if (p === null || !Number.isInteger(p) || p < 1 || p > 100) {
      return 'نسبة المحاضرات المطلوبة يجب أن تكون بين ١ و١٠٠';
    }
  }
  if (input.quizRule === 'selected' && input.quizIds.length === 0) {
    return 'اختر اختبارًا واحدًا على الأقل';
  }
  if (input.lectureRule === 'none') {
    if (input.quizRule === 'none') {
      return 'الشهادة تحتاج شرطًا واحدًا على الأقل: حدّد شرطًا للمحاضرات أو اختبارًا مطلوبًا';
    }
    if (quizzes && !quizzes.some((q) => q.published && input.quizIds.includes(q.id))) {
      return 'اختر اختبارًا منشورًا واحدًا على الأقل، فالشهادة بلا شرط للمحاضرات تعتمد على الاختبارات';
    }
  }
  return null;
}

export async function getSectionCertificateSettings(sectionId: string): Promise<SectionCertificateSettings> {
  const [settings, details] = await Promise.all([
    supabase.rpc('get_section_certificate_settings' as never, { p_section: sectionId } as never),
    supabase.rpc('get_section_certificate_details' as never, { p_section: sectionId } as never),
  ]);
  if (settings.error) throw settings.error;
  if (details.error) throw details.error;
  return parseCertificateSettings(
    { ...(settings.data as object), ...(details.data as object) },
    sectionId,
  );
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
  const { error: detailsError } = await supabase.rpc(
    'set_section_certificate_details' as never,
    {
      p_section: input.sectionId,
      p_certificate_title: input.certificateTitle,
      p_author: input.author,
      p_presenter_name: input.presenterName,
      p_presentation_form: input.presentationForm,
      p_custom_text: input.customText,
    } as never,
  );
  if (detailsError) throw detailsError;
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

/** One certificate section of «شهاداتي» (0169 get_my_certificates). */
export type MyCertificate = {
  sectionId: string;
  title: string;
  /** The parent section's title (context for a sub-section); null at the top level. */
  parentTitle: string | null;
  /** Every section above this one: they carry the «شهادة إتمام» mark on their cards. */
  ancestorIds: string[];
  eligibility: CertificateEligibility;
  /** The certificate already issued for this section, if any (0170). */
  issued: IssuedCertificate | null;
};

/** An issued certificate, as the server describes it. The app never draws it. */
export type IssuedCertificate = {
  id: string;
  status: 'valid' | 'revoked' | 'void';
  sectionId: string | null;
  title: string;
  authorLine: string | null;
  presenterLine: string | null;
  studentName: string | null;
  issuedAt: string;
  issueDateText: string | null;
  /** The PDF has been rendered on the server. */
  ready: boolean;
};

export function parseIssuedCertificate(raw: unknown): IssuedCertificate | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  if (typeof r.id !== 'string') return null;
  return {
    id: r.id,
    status: r.status === 'revoked' ? 'revoked' : r.status === 'void' ? 'void' : 'valid',
    sectionId: typeof r.section_id === 'string' ? r.section_id : null,
    title: String(r.title ?? ''),
    authorLine: typeof r.author_line === 'string' ? r.author_line : null,
    presenterLine: typeof r.presenter_line === 'string' ? r.presenter_line : null,
    studentName: typeof r.student_name === 'string' ? r.student_name : null,
    issuedAt: String(r.issued_at ?? ''),
    issueDateText: typeof r.issue_date_text === 'string' ? r.issue_date_text : null,
    ready: r.ready === true,
  };
}

/** get_my_certificates jsonb → client rows. Exported for tests. */
export function parseMyCertificates(raw: unknown): MyCertificate[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r: Record<string, any>) => ({
    sectionId: String(r.section_id ?? ''),
    title: String(r.title ?? ''),
    parentTitle: typeof r.parent_title === 'string' && r.parent_title ? r.parent_title : null,
    ancestorIds: Array.isArray(r.ancestor_ids) ? r.ancestor_ids.map(String) : [],
    eligibility: parseCertificateEligibility(r.eligibility),
    issued: parseIssuedCertificate(r.issued),
  }));
}

/**
 * The signed-in student's certificate sections: enabled, visible to him, with
 * at least one lecture to complete — each with its certificate_eligibility.
 * Earned first. Also the source of the «شهادة إتمام» marks on section cards.
 */
export async function getMyCertificates(): Promise<MyCertificate[]> {
  const { data, error } = await supabase.rpc('get_my_certificates' as never);
  if (error) throw error;
  return parseMyCertificates(data);
}

/** One of the signed-in student's own certificates; null when it is not theirs. */
export async function getMyCertificate(id: string): Promise<IssuedCertificate | null> {
  const { data, error } = await supabase.rpc('get_my_certificate' as never, { p_id: id } as never);
  if (error) throw error;
  return parseIssuedCertificate(data);
}

export type CertificateFiles = {
  pdfUrl: string;
  previewUrl: string;
  /** The server's wording for sharing, with the verification link in it. */
  shareText: string | null;
};

/** Short-lived links to the server-rendered files (owner or content staff only). */
export async function getCertificateFiles(id: string): Promise<CertificateFiles> {
  const { data, error } = await supabase.functions.invoke('certificate-files', { body: { id } });
  if (error) throw error;
  return {
    pdfUrl: String(data.pdf_url),
    previewUrl: String(data.preview_url),
    shareText: typeof data.share_text === 'string' ? data.share_text : null,
  };
}
