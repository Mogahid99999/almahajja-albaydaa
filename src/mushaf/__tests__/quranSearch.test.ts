import { ar, fold, juzStartPage, pageInfo, searchMushaf, suraStartPage } from '../quran';

describe('mushaf index data', () => {
  it('knows where suras and ajzaa start in the Madinah mushaf', () => {
    expect(suraStartPage(0)).toBe(1); // الفاتحة
    expect(suraStartPage(1)).toBe(2); // البقرة
    expect(suraStartPage(17)).toBe(293); // الكهف
    expect(suraStartPage(113)).toBe(604); // الناس
    expect(juzStartPage(30)).toBe(582);
    expect(pageInfo(604)).toMatchObject({ juz: 30 });
  });
});

describe('live mushaf search (no «انتقال» button)', () => {
  it('a number offers the page, the sura and the juz with that number', () => {
    const hits = searchMushaf('18');
    expect(hits.map((h) => h.kind)).toEqual(['page', 'sura', 'juz']);
    expect(hits[1]).toMatchObject({ sura: 17, page: 293 });
  });

  it('accepts Arabic-Indic digits and stops at the real page range', () => {
    expect(searchMushaf('١٢٠')[0]).toEqual({ kind: 'page', page: 120 });
    expect(searchMushaf('605')).toEqual([]);
  });

  it('matches sura names while typing, ignoring hamza/ta marbuta and «سورة»', () => {
    expect(searchMushaf('البق')[0]).toMatchObject({ kind: 'sura', sura: 1, page: 2 });
    expect(searchMushaf('سورة التوبه')[0]).toMatchObject({ sura: 8 });
    expect(searchMushaf('اسراء')[0]).toMatchObject({ sura: 16 });
  });

  it('fold is for matching only', () => {
    expect(fold('آل عمران')).toBe('ال عمران');
    expect(ar(604)).toBe('٦٠٤');
  });
});
