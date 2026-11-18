/**
 * «مستمر» / «منتهي» on the section cards (0164): the tag shows the admin's
 * choice in Arabic, and a section the admin left unset shows no tag at all.
 */
import { render, screen } from '@testing-library/react-native';

import type { SectionCard } from '@/api/types';
import { SectionsGrid } from '@/components/home/SectionsGrid';
import { SubsectionsScroller } from '@/components/section/SubsectionsScroller';
import { SectionStatusTag } from '@/components/section/SectionStatusTag';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/hooks/useSections', () => ({ usePrefetchSection: () => () => {} }));
const mockCertificateIds = { current: new Set<string>() };
jest.mock('@/hooks/useCertificates', () => ({ useCertificateCardIds: () => mockCertificateIds.current }));

const card = (id: string, title: string, seriesStatus: SectionCard['seriesStatus']): SectionCard => ({
  id,
  title,
  coverLetter: title[0],
  lectureCount: 3,
  progressPct: 0,
  seriesStatus,
});

const cards = [
  card('a', 'العقيدة', 'completed'),
  card('b', 'الفقه', 'ongoing'),
  card('c', 'الحديث', null),
];

test('home grid: one «منتهي», one «مستمر», nothing for the unset section', async () => {
  await render(<SectionsGrid sections={cards} />);
  expect(screen.getAllByText('منتهي')).toHaveLength(1);
  expect(screen.getAllByText('مستمر')).toHaveLength(1);
  expect(screen.getByLabelText('حالة القسم: منتهي')).toBeTruthy();
});

test('sub-section cards show the same tags', async () => {
  await render(<SubsectionsScroller subsections={cards} />);
  expect(screen.getAllByText('منتهي')).toHaveLength(1);
  expect(screen.getAllByText('مستمر')).toHaveLength(1);
});

test('an unset status renders nothing', async () => {
  await render(<SectionStatusTag status={null} />);
  expect(screen.queryByText('مستمر')).toBeNull();
  expect(screen.queryByText('منتهي')).toBeNull();
});

test('«شهادة إتمام» marks only the cards with a certificate, own or inside (0169)', async () => {
  mockCertificateIds.current = new Set(['b']);
  await render(<SectionsGrid sections={cards} />);
  expect(screen.getAllByLabelText('في هذا القسم شهادة إتمام')).toHaveLength(1);
  await render(<SubsectionsScroller subsections={cards} />);
  expect(screen.getAllByLabelText('في هذا القسم شهادة إتمام')).toHaveLength(1);
  mockCertificateIds.current = new Set();
  await render(<SectionsGrid sections={cards} />);
  expect(screen.queryByLabelText('في هذا القسم شهادة إتمام')).toBeNull();
});
