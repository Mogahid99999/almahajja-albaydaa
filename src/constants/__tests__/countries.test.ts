import { findCountry, splitPhone } from '../countries';

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
