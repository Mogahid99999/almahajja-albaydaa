/**
 * «شهادة إتمام القسم» client layer (0168): the RPC payload parsers and the
 * editor's pre-save validation (mirrors set_section_certificate_settings, whose
 * Arabic messages it reuses). The eligibility math itself is server-side and
 * pinned by tests/contract/certificates.contract.test.ts.
 */
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

import { supabase } from '@/lib/supabase';
import {
  certificateSettingsError,
  getCertificateEligibility,
  parseCertificateEligibility,
  parseCertificateSettings,
  parseMyCertificates,
  saveSectionCertificateSettings,
  type SaveSectionCertificateInput,
} from '@/api/certificates';

const rpc = supabase.rpc as unknown as jest.Mock;

const base: SaveSectionCertificateInput = {
  sectionId: 's1',
  enabled: true,
  contentScope: 'section',
  lectureRule: 'all',
  lecturePct: null,
  quizRule: 'none',
  quizIds: [],
};

beforeEach(() => rpc.mockReset());

describe('certificateSettingsError', () => {
  test('valid settings', () => {
    expect(certificateSettingsError(base)).toBeNull();
    expect(certificateSettingsError({ ...base, lectureRule: 'percent', lecturePct: 70 })).toBeNull();
    expect(certificateSettingsError({ ...base, quizRule: 'selected', quizIds: ['q1'] })).toBeNull();
  });

  test('percentage must be a whole number 1–100', () => {
    for (const p of [null, 0, 101, 70.5]) {
      expect(certificateSettingsError({ ...base, lectureRule: 'percent', lecturePct: p })).toBe(
        'نسبة المحاضرات المطلوبة يجب أن تكون بين ١ و١٠٠',
      );
    }
  });

  test('«اختبارات محددة» needs at least one quiz', () => {
    expect(certificateSettingsError({ ...base, quizRule: 'selected', quizIds: [] })).toBe(
      'اختر اختبارًا واحدًا على الأقل',
    );
  });

  test('a disabled certificate never blocks saving the section', () => {
    expect(certificateSettingsError({ ...base, enabled: false, quizRule: 'selected', quizIds: [] })).toBeNull();
  });
});

describe('saveSectionCertificateSettings', () => {
  test('sends the conditions as set', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await saveSectionCertificateSettings({
      ...base,
      contentScope: 'subtree',
      lectureRule: 'percent',
      lecturePct: 80,
      quizRule: 'selected',
      quizIds: ['q1'],
    });
    expect(rpc).toHaveBeenCalledWith('set_section_certificate_settings', {
      p_section: 's1',
      p_enabled: true,
      p_content_scope: 'subtree',
      p_lecture_rule: 'percent',
      p_lecture_pct: 80,
      p_quiz_rule: 'selected',
      p_quiz_ids: ['q1'],
    });
  });

  test('disabled with incomplete conditions stores the safe defaults instead of failing', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await saveSectionCertificateSettings({ ...base, enabled: false, quizRule: 'selected', quizIds: [] });
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_enabled: false,
      p_lecture_rule: 'all',
      p_lecture_pct: null,
      p_quiz_rule: 'none',
      p_quiz_ids: [],
    });
  });

  test('a server refusal is thrown', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'غير مصرح' } });
    await expect(saveSectionCertificateSettings(base)).rejects.toEqual({ message: 'غير مصرح' });
  });
});

describe('parsers', () => {
  test('my certificates carry the sections above them', () => {
    const [c] = parseMyCertificates([{ section_id: 's', title: 'ق', parent_title: null, ancestor_ids: ['m', 'r'] }]);
    expect(c.ancestorIds).toEqual(['m', 'r']);
    expect(parseMyCertificates([{ section_id: 's' }])[0].ancestorIds).toEqual([]);
  });

  test('settings: defaults for a never-configured section; picker rows', () => {
    const s = parseCertificateSettings(
      {
        section_id: 's1',
        enabled: false,
        content_scope: 'section',
        lecture_rule: 'all',
        lecture_pct: null,
        quiz_rule: 'none',
        quizzes: [
          { id: 'q1', title: 'اختبار', section_id: 's2', section_title: 'فرع', status: 'draft', selected: true },
        ],
      },
      's1',
    );
    expect(s).toEqual({
      sectionId: 's1',
      enabled: false,
      contentScope: 'section',
      lectureRule: 'all',
      lecturePct: null,
      quizRule: 'none',
      quizzes: [
        { id: 'q1', title: 'اختبار', sectionId: 's2', sectionTitle: 'فرع', published: false, selected: true },
      ],
    });
    expect(parseCertificateSettings(null, 's9')).toMatchObject({
      sectionId: 's9',
      enabled: false,
      contentScope: 'section', // the default scope
      quizzes: [],
    });
    expect(parseCertificateSettings({ content_scope: 'subtree' }, 's9').contentScope).toBe('subtree');
  });

  test('eligibility breakdown', async () => {
    rpc.mockResolvedValue({
      data: {
        section_id: 's1',
        user_id: 'u1',
        enabled: true,
        eligible: false,
        lectures: {
          scope: 'subtree',
          rule: 'percent',
          pct: 70,
          total: 10,
          completed: 7,
          required: 7,
          completed_pct: 70,
          met: true,
        },
        quizzes: {
          rule: 'selected',
          required_count: 1,
          passed_count: 0,
          met: false,
          items: [{ quiz_id: 'q1', title: 'اختبار', passed: false, pending_grading: true }],
        },
      },
      error: null,
    });
    const e = await getCertificateEligibility('s1');
    expect(rpc).toHaveBeenCalledWith('certificate_eligibility', { p_section: 's1', p_user: null });
    expect(e).toEqual({
      sectionId: 's1',
      userId: 'u1',
      enabled: true,
      eligible: false,
      lectures: {
        scope: 'subtree',
        rule: 'percent',
        pct: 70,
        total: 10,
        completed: 7,
        required: 7,
        completedPct: 70,
        met: true,
      },
      quizzes: {
        rule: 'selected',
        requiredCount: 1,
        passedCount: 0,
        met: false,
        items: [{ quizId: 'q1', title: 'اختبار', passed: false, pendingGrading: true }],
      },
    });
    expect(parseCertificateEligibility(undefined)).toMatchObject({
      eligible: false,
      lectures: { scope: 'section', completedPct: 0 },
    });
    // PostgREST may serialise numeric as a string
    expect(parseCertificateEligibility({ lectures: { completed_pct: '83.33' } }).lectures.completedPct).toBe(83.33);
  });
});
