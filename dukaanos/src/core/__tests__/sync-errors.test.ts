import { describe, expect, it } from 'vitest';
import { isPermanentRpcError, rpcErrorMessage } from '../sync/errors';

describe('outbox error classification', () => {
  it('treats validation and permission errors as permanent (never retried, never dropped)', () => {
    expect(isPermanentRpcError({ code: '42501', message: 'Discount not permitted for this employee' })).toBe(true);
    expect(isPermanentRpcError({ code: 'P0001', message: 'Payments 5000 do not cover total 10000' })).toBe(true);
    expect(isPermanentRpcError({ code: '23503', message: 'foreign key' })).toBe(true);
    expect(isPermanentRpcError({ message: 'new row violates row-level security policy' })).toBe(true);
    expect(isPermanentRpcError({ status: 400, message: 'Bad Request' })).toBe(true);
  });
  it('treats network / server failures as transient (retry later)', () => {
    expect(isPermanentRpcError({ message: 'TypeError: Network request failed' })).toBe(false);
    expect(isPermanentRpcError({ message: 'fetch failed' })).toBe(false);
    expect(isPermanentRpcError({ status: 503, message: 'Service Unavailable' })).toBe(false);
    expect(isPermanentRpcError({ status: 429, message: 'rate limited' })).toBe(false);
    expect(isPermanentRpcError(null)).toBe(false);
    expect(isPermanentRpcError({ message: 'something odd' })).toBe(false);
  });
  it('extracts a readable message', () => {
    expect(rpcErrorMessage({ message: 'x' })).toBe('x');
    expect(rpcErrorMessage({ details: 'd' })).toBe('d');
    expect(rpcErrorMessage('plain')).toBe('plain');
    expect(rpcErrorMessage(undefined)).toBe('Unknown error');
  });
});
