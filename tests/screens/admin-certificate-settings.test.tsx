/**
 * «شهادة الإتمام» block of the admin section editor (0168 —
 * CertificateSettingsFields). Pins the Arabic copy and the controlled flow:
 * conditions appear only when the toggle is on; «نطاق محتوى الشهادة» defaults to
 * «هذا القسم فقط» and switches to the whole subtree; «نسبة من المحاضرات» reveals the
 * percentage (presets + Arabic digits accepted); «اختبارات محددة» lists the
 * subtree quizzes (sub-section / draft flagged) and toggles picks.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import React, { useState } from 'react';

import type { CertificateQuizOption } from '@/api/certificates';
import {
  CertificateSettingsFields,
  parsePct,
  type CertificateFormValue,
} from '@/components/admin/CertificateSettingsFields';

const quizzes: CertificateQuizOption[] = [
  {
    id: 'q1',
    title: 'اختبار الباب الأول',
    sectionId: 'root',
    sectionTitle: 'كتاب التوحيد',
    published: true,
    selected: false,
  },
  { id: 'q2', title: 'اختبار الفرع', sectionId: 'sub', sectionTitle: 'الباب الثاني', published: false, selected: false },
];

let mockLast: CertificateFormValue | null = null;

function Harness({ initial, error = null }: { initial: CertificateFormValue; error?: string | null }) {
  const [v, setV] = useState(initial);
  return (
    <CertificateSettingsFields
      value={v}
      onChange={(n) => {
        mockLast = n;
        setV(n);
      }}
      quizzes={quizzes}
      sectionId="root"
      loading={false}
      loadError={false}
      validationError={error}
    />
  );
}

const off: CertificateFormValue = {
  enabled: false,
  contentScope: 'section',
  lectureRule: 'all',
  lecturePct: null,
  quizRule: 'none',
  quizIds: [],
};

beforeEach(() => {
  mockLast = null;
});

test('off: only the toggle is shown', async () => {
  await render(<Harness initial={off} />);
  expect(screen.getByText('يمنح هذا القسم شهادة إتمام')).toBeTruthy();
  expect(screen.queryByText('شرط إكمال المحاضرات')).toBeNull();
  expect(screen.queryByText('نطاق محتوى الشهادة')).toBeNull();
});

test('«نطاق محتوى الشهادة»: «هذا القسم فقط» by default, or the section with all its sub-sections', async () => {
  await render(<Harness initial={{ ...off, enabled: true }} />);
  expect(screen.getByText('نطاق محتوى الشهادة')).toBeTruthy();
  expect(screen.getByText('هذا القسم فقط')).toBeTruthy();
  expect(screen.getByText('تُحتسب المحاضرات المنشورة الموجودة مباشرة في هذا القسم')).toBeTruthy();
  await fireEvent.press(screen.getByText('هذا القسم وأقسامه الفرعية'));
  expect(mockLast).toMatchObject({ contentScope: 'subtree' });
  expect(screen.getByText('تُحتسب المحاضرات المنشورة في هذا القسم وفي كل الأقسام الفرعية تحته')).toBeTruthy();
  await fireEvent.press(screen.getByText('هذا القسم فقط'));
  expect(mockLast).toMatchObject({ contentScope: 'section' });
});

test('turning it on shows both conditions with the defaults', async () => {
  await render(<Harness initial={off} />);
  await fireEvent(screen.getByLabelText('يمنح هذا القسم شهادة إتمام'), 'valueChange', true);
  expect(screen.getByText('شرط إكمال المحاضرات')).toBeTruthy();
  expect(screen.getByText('إكمال جميع المحاضرات')).toBeTruthy();
  expect(screen.getByText('شرط الاختبارات')).toBeTruthy();
  expect(screen.getByText('لا يشترط اختبارات')).toBeTruthy();
  expect(
    screen.getByText('المحاضرة المكتملة تُحتسب سواء أُكملت من التسجيل أو بحضور البث المباشر'),
  ).toBeTruthy();
  expect(mockLast).toMatchObject({ enabled: true });
});

test('«نسبة من المحاضرات»: 80 by default, presets and typed Arabic digits', async () => {
  await render(<Harness initial={{ ...off, enabled: true }} />);
  await fireEvent.press(screen.getByText('نسبة من المحاضرات'));
  expect(mockLast).toMatchObject({ lectureRule: 'percent', lecturePct: 80 });
  await fireEvent.press(screen.getByText('٩٠٪'));
  expect(mockLast!.lecturePct).toBe(90);
  await fireEvent.changeText(screen.getByLabelText('النسبة المطلوبة من المحاضرات'), '٧٥');
  expect(mockLast!.lecturePct).toBe(75);
  await fireEvent.press(screen.getByText('إكمال جميع المحاضرات'));
  expect(mockLast).toMatchObject({ lectureRule: 'all', lecturePct: null });
});

test('«اختبارات محددة» lists the quizzes and toggles picks', async () => {
  await render(<Harness initial={{ ...off, enabled: true }} />);
  await fireEvent.press(screen.getByText('اختبارات محددة'));
  expect(screen.getByText('اختبار الباب الأول')).toBeTruthy();
  expect(screen.getByText('الباب الثاني · مسودة')).toBeTruthy();
  expect(
    screen.getByText('يُعتمد نجاح كل اختبار بدرجة نجاحه، والاختبار الذي ينتظر التصحيح لا يُحتسب حتى يُعتمد'),
  ).toBeTruthy();
  await fireEvent.press(screen.getByText('اختبار الباب الأول'));
  expect(mockLast!.quizIds).toEqual(['q1']);
  await fireEvent.press(screen.getByText('اختبار الفرع'));
  expect(mockLast!.quizIds).toEqual(['q1', 'q2']);
  await fireEvent.press(screen.getByText('اختبار الباب الأول'));
  expect(mockLast!.quizIds).toEqual(['q2']);
});

test('the validation message is shown', async () => {
  await render(
    <Harness initial={{ ...off, enabled: true, quizRule: 'selected' }} error="اختر اختبارًا واحدًا على الأقل" />,
  );
  expect(screen.getByText('اختر اختبارًا واحدًا على الأقل')).toBeTruthy();
});

test('parsePct', () => {
  expect(parsePct('٨٠')).toBe(80);
  expect(parsePct('70%')).toBe(70);
  expect(parsePct('')).toBeNull();
});
