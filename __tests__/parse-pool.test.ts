import { describe, it, expect } from 'vitest';
import { resolveParsePoolSize } from '../src/extraction/parse-pool';

describe('resolveParsePoolSize', () => {
  it('returns at least 1', () => {
    expect(resolveParsePoolSize('0')).toBe(1);
    expect(resolveParsePoolSize('1')).toBe(1);
  });

  it('returns explicit value when valid', () => {
    expect(resolveParsePoolSize('3')).toBe(3);
    expect(resolveParsePoolSize('8')).toBe(8);
  });

  it('clamps to MAX_POOL_SIZE (16)', () => {
    expect(resolveParsePoolSize('32')).toBe(16);
    expect(resolveParsePoolSize('100')).toBe(16);
  });

  it('returns default when env is undefined', () => {
    const result = resolveParsePoolSize(undefined);
    expect(result).toBeGreaterThanOrEqual(1);
    expect(result).toBeLessThanOrEqual(8);
  });

  it('returns default when env is empty string', () => {
    const result = resolveParsePoolSize('');
    expect(result).toBeGreaterThanOrEqual(1);
  });

  it('returns default when env is non-numeric', () => {
    const result = resolveParsePoolSize('abc');
    expect(result).toBeGreaterThanOrEqual(1);
  });

  it('handles negative values by returning default', () => {
    const result = resolveParsePoolSize('-1');
    expect(result).toBeGreaterThanOrEqual(1);
    expect(result).toBeLessThanOrEqual(8);
  });
});
