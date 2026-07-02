import type { Specificity } from './types-node';

const WEIGHTS: Record<string, Specificity> = {
  id: [0, 1, 0, 0],
  class: [0, 0, 1, 0],
  attribute: [0, 0, 1, 0],
  pseudo: [0, 0, 1, 0],
  tag: [0, 0, 0, 1],
  universal: [0, 0, 0, 0],
};

export type { Specificity };

export function calculateSpecificity(selector: string): Specificity {
  const spec: Specificity = [0, 0, 0, 0];

  try {
    const parserModule = require('postcss-selector-parser') as
      (cb: (selectors: { walk: (cb: (node: { type: string }) => void) => void }) => void) => { processSync: (s: string) => void };

    parserModule((selectors) => {
      selectors.walk((node) => {
        const weight = WEIGHTS[node.type];
        if (weight) {
          spec[0] += weight[0];
          spec[1] += weight[1];
          spec[2] += weight[2];
          spec[3] += weight[3];
        }
      });
    }).processSync(selector);
  } catch {
    const classCount = (selector.match(/\./g) || []).length;
    const idCount = (selector.match(/#/g) || []).length;
    spec[1] = idCount;
    spec[2] = classCount;
  }

  return spec;
}

export function compareSpecificity(a: Specificity, b: Specificity): number {
  for (let i = 0; i < 4; i++) {
    if (a[i] !== b[i]) return (a[i] ?? 0) - (b[i] ?? 0);
  }
  return 0;
}
