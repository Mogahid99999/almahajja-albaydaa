import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import type { IssuedCertificate } from '@/api/certificates';
import { CertificateShareActions } from '@/components/certificates/CertificateShareActions';

const mockFiles = jest.fn();
const mockShare = jest.fn();
const mockCopy = jest.fn();
jest.mock('@/api/certificates', () => ({ getCertificateFiles: (id: string) => mockFiles(id) }));
jest.mock('@/lib/certificateShare', () => ({
  shareCertificateImage: (u: string, id: string, c: string | null) => mockShare(u, id, c),
  copyCertificateShareText: (t: string) => mockCopy(t),
}));

const certificate = (ready: boolean) => ({ id: 'MAH-1', ready }) as IssuedCertificate;
const links = { pdfUrl: 'p', previewUrl: 'https://x/certificate.jpg', shareText: 'الحمد لله' };

describe('CertificateShareActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFiles.mockResolvedValue(links);
    mockShare.mockResolvedValue(undefined);
  });

  test('says the certificate is being prepared and does not share yet', async () => {
    await render(<CertificateShareActions certificate={certificate(false)} />);
    await fireEvent.press(screen.getByText('جارٍ تجهيز الشهادة'));
    expect(mockShare).not.toHaveBeenCalled();
  });

  test('shares the official server image with the server wording, also on the clipboard', async () => {
    await render(<CertificateShareActions certificate={certificate(true)} />);
    await fireEvent.press(screen.getByText('مشاركة الشهادة'));
    await waitFor(() => expect(mockShare).toHaveBeenCalledWith(links.previewUrl, 'MAH-1', 'الحمد لله'));
    expect(mockCopy).toHaveBeenCalledWith('الحمد لله');
    expect(screen.getByText('نسخنا نص المشاركة، فإن لم يظهر مع الصورة فألصقه.')).toBeTruthy();
  });

  test('copy button only copies', async () => {
    await render(<CertificateShareActions certificate={certificate(true)} />);
    await fireEvent.press(screen.getByText('نسخ نص المشاركة'));
    await waitFor(() => expect(mockCopy).toHaveBeenCalledWith('الحمد لله'));
    expect(mockShare).not.toHaveBeenCalled();
    expect(screen.getByText('تم نسخ نص المشاركة.')).toBeTruthy();
  });

  test('shows the wording under the buttons and copies it without a request', async () => {
    await render(<CertificateShareActions certificate={certificate(true)} shareText="نص جاهز" />);
    expect(screen.getByText('نص جاهز')).toBeTruthy();
    await fireEvent.press(screen.getByText('نسخ نص المشاركة'));
    await waitFor(() => expect(mockCopy).toHaveBeenCalledWith('نص جاهز'));
    expect(mockFiles).not.toHaveBeenCalled();
  });

  test('a failed download explains itself in Arabic', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation();
    mockFiles.mockRejectedValue(new Error('offline'));
    await render(<CertificateShareActions certificate={certificate(true)} />);
    await fireEvent.press(screen.getByText('مشاركة الشهادة'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith('تعذّرت المشاركة', expect.any(String)));
  });
});
