import { describe, expect, it } from 'vitest';
import { isPossibleDuplicate, normaliseName, similarity, suggestParties } from '../notebook/dedupe';
import { parseAndMatch, parseFragment, parseOrder, type MatchableProduct } from '../voice/parse';

const products: MatchableProduct[] = [
  { id: 'rice-b', name: 'Basmati Rice', name_hi: 'बासमती चावल', aliases: ['chawal', 'basmati'], unit: 'kg', is_loose: true },
  { id: 'rice-s', name: 'Sona Masoori Rice', name_hi: null, aliases: ['chawal', 'sona masoori'], unit: 'kg', is_loose: true },
  { id: 'sugar', name: 'Sugar', name_hi: 'चीनी', aliases: ['chini', 'cheeni', 'shakkar'], unit: 'kg', is_loose: true },
  { id: 'dal', name: 'Toor Dal', name_hi: null, aliases: ['dal', 'arhar'], unit: 'kg', is_loose: true },
  { id: 'parle', name: 'Parle-G', name_hi: null, aliases: ['biscuit', 'parle'], unit: 'pkt', is_loose: false },
];

describe('voice parse', () => {
  it('splits and parses Hinglish quantities', () => {
    const f = parseOrder('Do kilo chawal, ek kilo chini aur aadha kilo dal');
    expect(f).toHaveLength(3);
    expect(f[0]).toMatchObject({ qty: '2', unit: 'kg', words: 'chawal' });
    expect(f[1]).toMatchObject({ qty: '1', unit: 'kg', words: 'chini' });
    expect(f[2]).toMatchObject({ qty: '0.5', unit: 'kg', words: 'dal' });
  });
  it('handles glued units, grams, packets and "sau"', () => {
    expect(parseFragment('500g chini')).toMatchObject({ qty: '500', unit: 'g', words: 'chini' });
    expect(parseFragment('dedh sau gram dal')).toMatchObject({ qty: '150', unit: 'g' });
    expect(parseFragment('2 packet parle')).toMatchObject({ qty: '2', unit: 'pkt', words: 'parle' });
    expect(parseFragment('biscuit do')).toMatchObject({ qty: null, words: 'biscuit do' });
  });
  it('matches products, asks when ambiguous, defaults packaged qty to 1', () => {
    const r = parseAndMatch('ek kilo chini, biscuit, 2 kilo chawal', products);
    expect(r[0].product?.id).toBe('sugar');
    expect(r[0].qty).toBe('1');
    expect(r[1].product?.id).toBe('parle');
    expect(r[1].qty).toBe('1');
    expect(r[1].unit).toBe('pkt');
    expect(r[2].product).toBeNull(); // two kinds of chawal
    expect(r[2].needsClarification).toMatch(/ya/);
    expect(r[2].candidates.map((c) => c.id).sort()).toEqual(['rice-b', 'rice-s']);
  });
  it('asks for weight when a loose item has no quantity', () => {
    const r = parseAndMatch('dal', products);
    expect(r[0].product?.id).toBe('dal');
    expect(r[0].needsClarification).toMatch(/kitna/);
  });
  it('flags unknown products', () => {
    const r = parseAndMatch('teen kilo pyaaz', products);
    expect(r[0].product).toBeNull();
    expect(r[0].candidates).toHaveLength(0);
  });
});

describe('notebook dedupe', () => {
  it('normalises names and ranks suggestions', () => {
    expect(normaliseName('Ramesh ji')).toBe('ramesh');
    expect(similarity('Ramesh Kumar', 'ramesh kumar')).toBe(1);
    const s = suggestParties('Ramesh', [{ id: '1', name: 'Ramesh Kumar' }, { id: '2', name: 'Suresh' }, { id: '3', name: 'Mahesh' }]);
    expect(s[0].party.id).toBe('1');
  });
  it('detects possible duplicates within ±1 day', () => {
    const existing = [{ party_id: 'c1', amount_paise: 15000, entry_date: '2026-10-01' }];
    expect(isPossibleDuplicate({ party_id: 'c1', amount_paise: 15000, entry_date: '2026-10-02' }, existing)).not.toBeNull();
    expect(isPossibleDuplicate({ party_id: 'c1', amount_paise: 15000, entry_date: '2026-10-05' }, existing)).toBeNull();
    expect(isPossibleDuplicate({ party_id: 'c2', amount_paise: 15000, entry_date: '2026-10-01' }, existing)).toBeNull();
    expect(isPossibleDuplicate({ party_id: 'c1', amount_paise: null, entry_date: '2026-10-01' }, existing)).toBeNull();
  });
});
