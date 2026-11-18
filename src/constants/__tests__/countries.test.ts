import { COUNTRIES, findCountry, searchCountries, splitPhone } from '../countries';

describe('splitPhone', () => {
  test('splits a stored Saudi number back into its country code + local digits', () => {
    expect(splitPhone('966512345678')).toEqual({ countryCode: '966', local: '512345678' });
  });

  test('splits a stored Sudanese number', () => {
    expect(splitPhone('249912345678')).toEqual({ countryCode: '249', local: '912345678' });
  });

  test('longest-code-first: a UAE (971) number is not shadowed by a shorter prefix match', () => {
    expect(splitPhone('971501234567')).toEqual({ countryCode: '971', local: '501234567' });
  });

  test('falls back to Sudan with the whole string as local when no known code matches', () => {
    expect(splitPhone('5551234')).toEqual({ countryCode: '249', local: '5551234' });
  });

  test('empty input', () => {
    expect(splitPhone('')).toEqual({ countryCode: '249', local: '' });
  });
});

describe('findCountry', () => {
  test('returns the matching country', () => {
    expect(findCountry('966').name).toBe('السعودية');
  });

  test('falls back to the first country (Sudan) for an unknown code', () => {
    expect(findCountry('000').code).toBe('249');
  });
});

describe('the full list', () => {
  // African Union member states plus Western Sahara.
  const AFRICA = 'DZ AO BJ BW BF BI CV CM CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU MA MZ NA NE NG RW ST SN SC SL SO ZA SS SD TZ TG TN UG ZM ZW EH'.split(' ');

  test('every African country is present with an Arabic name and flag', () => {
    expect(AFRICA).toHaveLength(55);
    for (const iso of AFRICA) {
      const c = COUNTRIES.find((x) => x.iso === iso);
      expect(c).toBeDefined();
      expect(c!.name).toMatch(/[؀-ۿ]/);
      expect(c!.flag.length).toBe(4);
      expect(c!.code).toMatch(/^[1-9]\d{0,2}$/);
    }
  });

  test('rows are unique and the main audience comes first', () => {
    expect(new Set(COUNTRIES.map((c) => c.iso)).size).toBe(COUNTRIES.length);
    expect(COUNTRIES.length).toBeGreaterThanOrEqual(240);
    expect(COUNTRIES[0]).toMatchObject({ iso: 'SD', code: '249', name: 'السودان', flag: '🇸🇩' });
    expect(COUNTRIES.slice(1, 3).map((c) => c.iso)).toEqual(['SA', 'AE']);
  });

  test('a shared calling code resolves to its main country', () => {
    expect(findCountry('1').iso).toBe('US');
    expect(findCountry('44').iso).toBe('GB');
    expect(findCountry('7').iso).toBe('RU');
  });

  const isos = (q: string) => searchCountries(q).map((c) => c.iso);

  test('search by Arabic name ignores hamza, ta marbuta and the article', () => {
    expect(isos('نيجيريا')).toContain('NG');
    expect(isos('اثيوبيا')).toContain('ET');
    expect(isos('السنغال')).toContain('SN');
    expect(isos('سنغال')).toContain('SN');
    expect(isos('عمان')).toContain('OM');
  });

  test('search by English name, by code in either digit style, with or without +', () => {
    expect(isos('Nigeria')).toContain('NG');
    expect(isos('234')).toEqual(['NG']);
    expect(isos('+249')).toContain('SD');
    expect(isos('٢٤٩')).toContain('SD');
    expect(isos('zzzz')).toEqual([]);
    expect(searchCountries('  ')).toHaveLength(COUNTRIES.length);
  });

  test('a code-less stored number is not mistaken for +1 (Egyptian national form)', () => {
    expect(splitPhone('1012345678')).toEqual({ countryCode: '20', local: '1012345678' });
  });

  test('a Nigerian number splits correctly', () => {
    expect(splitPhone('2348012345678')).toEqual({ countryCode: '234', local: '8012345678' });
  });
});
