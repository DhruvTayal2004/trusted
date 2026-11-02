import { describe, expect, it } from 'vitest';
import { formatPaise, groupIndian, mulPaiseByQty, parseRupees, percentOf, sumPaise } from '../money';

describe('money', () => {
  it('parses rupee input forms', () => {
    expect(parseRupees('120')).toBe(12000);
    expect(parseRupees('120.5')).toBe(12050);
    expect(parseRupees('₹1,250.75')).toBe(125075);
    expect(parseRupees('1250/-')).toBe(125000);
    expect(parseRupees('Rs. 40')).toBe(4000);
    expect(parseRupees('abc')).toBeNull();
    expect(parseRupees('1.234')).toBeNull(); // more than 2 decimals is ambiguous
    expect(parseRupees('')).toBeNull();
    expect(parseRupees(12.345)).toBe(1235);
  });

  it('formats with Indian grouping', () => {
    expect(groupIndian('1234567')).toBe('12,34,567');
    expect(groupIndian('123')).toBe('123');
    expect(groupIndian('1234')).toBe('1,234');
    expect(formatPaise(123456)).toBe('₹1,234.56');
    expect(formatPaise(120000)).toBe('₹1,200');
    expect(formatPaise(120000, { alwaysPaise: true })).toBe('₹1,200.00');
    expect(formatPaise(-2000)).toBe('-₹20');
    expect(formatPaise(5, { sign: true })).toBe('+₹0.05');
  });

  it('multiplies price by decimal quantity exactly', () => {
    expect(mulPaiseByQty(8000, '2')).toBe(16000); // 2 kg @ ₹80
    expect(mulPaiseByQty(8000, '0.5')).toBe(4000);
    expect(mulPaiseByQty(8000, '0.25')).toBe(2000);
    expect(mulPaiseByQty(3333, '0.333')).toBe(1110); // 1109.889 → 1110
    expect(mulPaiseByQty(1, '0.001')).toBe(0); // 0.001 paise → 0
    expect(mulPaiseByQty(1, '0.5')).toBe(1); // half-up
    expect(mulPaiseByQty(9999, '1.5')).toBe(14999); // 14998.5 → 14999
    expect(() => mulPaiseByQty(80.5, '1')).toThrow();
  });

  it('sums and percentages', () => {
    expect(sumPaise([100, 200, 300])).toBe(600);
    expect(percentOf(10000, 5)).toBe(500);
    expect(percentOf(3333, 10)).toBe(333);
    expect(percentOf(1, 50)).toBe(1);
  });
});
