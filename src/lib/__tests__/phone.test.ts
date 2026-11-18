import { isPhoneEntryValid, phoneLoginCandidates, toInternationalPhone } from '../phone';

describe('toInternationalPhone', () => {
  test.each([
    ['السودان', '912345678', '249', '+249912345678'],
    ['السعودية', '512345678', '966', '+966512345678'],
    ['مصر', '1012345678', '20', '+201012345678'],
    ['نيجيريا', '8031234567', '234', '+2348031234567'],
    ['باكستان', '3001234567', '92', '+923001234567'],
    ['مالي (8)', '70123456', '223', '+22370123456'],
    ['غامبيا (7)', '3012345', '220', '+2203012345'],
    ['ألمانيا', '15123456789', '49', '+4915123456789'],
    ['الولايات المتحدة', '2025550123', '1', '+12025550123'],
  ])('%s', (_n, local, code, expected) => {
    expect(toInternationalPhone(local, code)).toBe(expected);
  });

  test('a leading national zero is dropped', () => {
    expect(toInternationalPhone('08031234567', '234')).toBe('+2348031234567');
    expect(toInternationalPhone('01012345678', '20')).toBe('+201012345678');
    expect(toInternationalPhone('0912345678', '249')).toBe('+249912345678');
  });

  test('the same number typed locally and internationally gives one result', () => {
    const forms = ['08031234567', '8031234567', '2348031234567', '+2348031234567', '002348031234567'];
    expect(new Set(forms.map((f) => toInternationalPhone(f, '234')))).toEqual(new Set(['+2348031234567']));
  });

  test('a number whose national digits begin like the code stays national', () => {
    expect(toInternationalPhone('9198765432', '91')).toBe('+919198765432');
  });

  test('Arabic-Indic digits are accepted', () => {
    expect(toInternationalPhone('٠٨٠٣١٢٣٤٥٦٧', '234')).toBe('+2348031234567');
  });

  test('an impossible length is refused; an empty field is not a number', () => {
    expect(toInternationalPhone('123', '249')).toBeNull();
    expect(toInternationalPhone('', '249')).toBeNull();
    expect(isPhoneEntryValid('123', '249')).toBe(false);
    expect(isPhoneEntryValid('912345678', '249')).toBe(true);
  });
});

describe('phoneLoginCandidates', () => {
  test('a new Nigerian account first, then the old stored form', () => {
    expect(phoneLoginCandidates('08031234567', '234')).toEqual(['2348031234567', '8031234567']);
  });

  test('old Egyptian account with no country chosen still reaches its row, and new ones too', () => {
    expect(phoneLoginCandidates('01012345678', '249')).toEqual(['1012345678', '201012345678']);
  });

  test('Sudan keeps its one form', () => {
    expect(phoneLoginCandidates('0912345678')).toEqual(['249912345678']);
  });

  test('a full international entry needs no country', () => {
    expect(phoneLoginCandidates('+966512345678', '249')).toEqual(['966512345678']);
  });
});
