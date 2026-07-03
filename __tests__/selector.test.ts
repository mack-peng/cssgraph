import { describe, it, expect } from 'vitest';
import { normalizeSelector, resolveHashedSelector } from '../src/graph/index';

describe('normalizeSelector', () => {
  it('trims whitespace', () => {
    expect(normalizeSelector('  .foo  ')).toBe('.foo');
  });

  it('collapses multiple spaces', () => {
    expect(normalizeSelector('.a   .b  .c')).toBe('.a .b .c');
  });

  it('normalizes commas — no space after comma', () => {
    expect(normalizeSelector('.a,.b')).toBe('.a, .b');
  });

  it('normalizes commas — extra spaces around comma', () => {
    expect(normalizeSelector('.a  ,  .b ,.c')).toBe('.a, .b, .c');
  });

  it('handles complex selectors with combinators', () => {
    expect(normalizeSelector('.a  > .b  +  .c')).toBe('.a > .b + .c');
  });

  it('handles multi-selector with commas and spaces', () => {
    expect(normalizeSelector('.a .b,  .c.d, .e>.f')).toBe('.a .b, .c.d, .e>.f');
  });
});

describe('resolveHashedSelector', () => {
  it('returns unchanged when no hashMap provided', () => {
    expect(resolveHashedSelector('._abc123 ._def456')).toBe('._abc123 ._def456');
  });

  it('returns unchanged when hashMap is empty', () => {
    expect(resolveHashedSelector('._abc123', new Map())).toBe('._abc123');
  });

  it('replaces hashed names with original names', () => {
    const map = new Map([['_abc123', 'foo']]);
    expect(resolveHashedSelector('._abc123', map)).toBe('.foo');
  });

  it('replaces multiple hashed names', () => {
    const map = new Map([['_abc123', 'foo'], ['_def456', 'bar']]);
    expect(resolveHashedSelector('._abc123 ._def456', map)).toBe('.foo .bar');
  });

  it('does not replace identity mappings', () => {
    const map = new Map([['foo', 'foo']]);
    expect(resolveHashedSelector('.foo', map)).toBe('.foo');
  });

  it('replaces hashed names globally in selector', () => {
    const map = new Map([['_abc123', 'foo']]);
    expect(resolveHashedSelector('._abc123._abc123', map)).toBe('.foo.foo');
  });
});
