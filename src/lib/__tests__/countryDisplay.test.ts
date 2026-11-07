import { countryFlag, countryLabel, countryName, parseCountryParam, UNKNOWN_COUNTRY } from '../countryDisplay';

describe('countryName', () => {
  test('Arabic names for the registration list countries', () => {
    expect(countryName('SD')).toBe('السودان');
    expect(countryName('SA')).toBe('السعودية');
    expect(countryName('EG')).toBe('مصر');
    expect(countryName('AE')).toBe('الإمارات');
  });

  test('a country outside the registration list still gets an Arabic name', () => {
    expect(countryName('KZ')).toMatch(/[؀-ۿ]/);
  });

  test('ZZ (no recognisable calling code) reads «غير محدد», never a guessed country', () => {
    expect(countryName(UNKNOWN_COUNTRY)).toBe('غير محدد');
  });

  test('garbage never crashes', () => {
    expect(() => countryName('')).not.toThrow();
    expect(() => countryName('1x')).not.toThrow();
  });
});

describe('countryFlag', () => {
  test('flag emoji from the ISO code', () => {
    expect(countryFlag('SD')).toBe('🇸🇩');
    expect(countryFlag('sa')).toBe('🇸🇦');
  });

  test('unknown / invalid codes get a neutral globe', () => {
    expect(countryFlag(UNKNOWN_COUNTRY)).toBe('🌐');
    expect(countryFlag('')).toBe('🌐');
    expect(countryFlag('123')).toBe('🌐');
  });
});

test('countryLabel = flag + Arabic name', () => {
  expect(countryLabel('SD')).toBe('🇸🇩 السودان');
});

describe('parseCountryParam (users page ?country=)', () => {
  test('accepts a 2-letter code, any case', () => {
    expect(parseCountryParam('SD')).toBe('SD');
    expect(parseCountryParam(' sa ')).toBe('SA');
    expect(parseCountryParam(['EG', 'SD'])).toBe('EG');
  });
  test('anything else means no country filter (never a crash, never a guess)', () => {
    expect(parseCountryParam(undefined)).toBeUndefined();
    expect(parseCountryParam('')).toBeUndefined();
    expect(parseCountryParam('SDN')).toBeUndefined();
    expect(parseCountryParam('249')).toBeUndefined();
  });
});
