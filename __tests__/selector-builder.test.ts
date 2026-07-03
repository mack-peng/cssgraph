import { describe, it, expect } from 'vitest';
import { buildFullSelector, SelectorContext } from '../src/extraction/selector-builder';

function makeRule(selectors: string[]): import('postcss').Rule {
  return {
    type: 'rule',
    selectors,
    nodes: [],
    source: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
    raws: {} as any,
  } as unknown as import('postcss').Rule;
}

describe('buildFullSelector', () => {
  const noContext: SelectorContext = { parentSelectors: [], atRules: [] };

  it('returns the selector unchanged when no parents', () => {
    const rule = makeRule(['.btn']);
    expect(buildFullSelector(rule, noContext)).toBe('.btn');
  });

  it('prepends parent selectors without &', () => {
    const rule = makeRule(['.child']);
    const ctx: SelectorContext = { parentSelectors: ['.parent'], atRules: [] };
    expect(buildFullSelector(rule, ctx)).toBe('.parent .child');
  });

  it('expands & with parent selectors', () => {
    const rule = makeRule(['&.active']);
    const ctx: SelectorContext = { parentSelectors: ['.btn'], atRules: [] };
    expect(buildFullSelector(rule, ctx)).toBe('.btn.active');
  });

  it('expands & multiple levels deep', () => {
    const rule = makeRule(['&.gallery .first-row']);
    const ctx: SelectorContext = { parentSelectors: ['.sections.landing', '.section'], atRules: [] };
    expect(buildFullSelector(rule, ctx)).toBe('.sections.landing .section.gallery .first-row');
  });

  it('joins multiple selectors with commas', () => {
    const rule = makeRule(['.a', '.b']);
    expect(buildFullSelector(rule, noContext)).toBe('.a, .b');
  });

  it('expands & for each selector in a multi-selector rule', () => {
    const rule = makeRule(['&.a', '&.b']);
    const ctx: SelectorContext = { parentSelectors: ['.parent'], atRules: [] };
    expect(buildFullSelector(rule, ctx)).toBe('.parent.a, .parent.b');
  });

  it('returns selector as-is when parent has no selectors', () => {
    const rule = makeRule(['.btn']);
    const ctx: SelectorContext = { parentSelectors: [], atRules: [] };
    expect(buildFullSelector(rule, ctx)).toBe('.btn');
  });
});
