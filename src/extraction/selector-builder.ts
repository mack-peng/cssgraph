import { Rule } from 'postcss';

export interface SelectorContext {
  parentSelectors: string[];
  atRules: { name: string; params: string }[];
}

export function buildFullSelector(rule: Rule, context: SelectorContext): string {
  const resolved: string[] = [];

  for (const sel of rule.selectors) {
    let resolvedSel = sel;

    if (resolvedSel.includes('&') && context.parentSelectors.length > 0) {
      resolvedSel = resolvedSel.replace(/&/g, context.parentSelectors.join(' '));
    } else if (context.parentSelectors.length > 0) {
      resolvedSel = `${context.parentSelectors.join(' ')} ${resolvedSel}`;
    }

    resolved.push(resolvedSel.trim());
  }

  return resolved.join(', ');
}
