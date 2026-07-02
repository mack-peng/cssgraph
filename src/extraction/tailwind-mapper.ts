import * as fs from 'fs';
import * as path from 'path';
import postcss, { AtRule } from 'postcss';

interface UtilityMap {
  [className: string]: Array<{ property: string; value: string }>;
}

const DEFAULT_UTILITIES: UtilityMap = {
  'flex': [{ property: 'display', value: 'flex' }],
  'block': [{ property: 'display', value: 'block' }],
  'inline': [{ property: 'display', value: 'inline' }],
  'inline-block': [{ property: 'display', value: 'inline-block' }],
  'hidden': [{ property: 'display', value: 'none' }],
  'grid': [{ property: 'display', value: 'grid' }],
  'text-left': [{ property: 'text-align', value: 'left' }],
  'text-center': [{ property: 'text-align', value: 'center' }],
  'text-right': [{ property: 'text-align', value: 'right' }],
  'font-bold': [{ property: 'font-weight', value: '700' }],
  'font-normal': [{ property: 'font-weight', value: '400' }],
  'uppercase': [{ property: 'text-transform', value: 'uppercase' }],
  'lowercase': [{ property: 'text-transform', value: 'lowercase' }],
  'capitalize': [{ property: 'text-transform', value: 'capitalize' }],
  'underline': [{ property: 'text-decoration', value: 'underline' }],
  'no-underline': [{ property: 'text-decoration', value: 'none' }],
  'relative': [{ property: 'position', value: 'relative' }],
  'absolute': [{ property: 'position', value: 'absolute' }],
  'fixed': [{ property: 'position', value: 'fixed' }],
  'sticky': [{ property: 'position', value: 'sticky' }],
  'w-full': [{ property: 'width', value: '100%' }],
  'h-full': [{ property: 'height', value: '100%' }],
  'w-screen': [{ property: 'width', value: '100vw' }],
  'h-screen': [{ property: 'height', value: '100vh' }],
  'overflow-hidden': [{ property: 'overflow', value: 'hidden' }],
  'overflow-auto': [{ property: 'overflow', value: 'auto' }],
  'overflow-scroll': [{ property: 'overflow', value: 'scroll' }],
  'cursor-pointer': [{ property: 'cursor', value: 'pointer' }],
  'opacity-0': [{ property: 'opacity', value: '0' }],
  'opacity-50': [{ property: 'opacity', value: '0.5' }],
  'opacity-100': [{ property: 'opacity', value: '1' }],
  'px-0': [{ property: 'padding-left', value: '0' }, { property: 'padding-right', value: '0' }],
  'px-1': [{ property: 'padding-left', value: '0.25rem' }, { property: 'padding-right', value: '0.25rem' }],
  'px-2': [{ property: 'padding-left', value: '0.5rem' }, { property: 'padding-right', value: '0.5rem' }],
  'px-3': [{ property: 'padding-left', value: '0.75rem' }, { property: 'padding-right', value: '0.75rem' }],
  'px-4': [{ property: 'padding-left', value: '1rem' }, { property: 'padding-right', value: '1rem' }],
  'px-6': [{ property: 'padding-left', value: '1.5rem' }, { property: 'padding-right', value: '1.5rem' }],
  'px-8': [{ property: 'padding-left', value: '2rem' }, { property: 'padding-right', value: '2rem' }],
  'py-0': [{ property: 'padding-top', value: '0' }, { property: 'padding-bottom', value: '0' }],
  'py-1': [{ property: 'padding-top', value: '0.25rem' }, { property: 'padding-bottom', value: '0.25rem' }],
  'py-2': [{ property: 'padding-top', value: '0.5rem' }, { property: 'padding-bottom', value: '0.5rem' }],
  'py-4': [{ property: 'padding-top', value: '1rem' }, { property: 'padding-bottom', value: '1rem' }],
  'm-0': [{ property: 'margin', value: '0' }],
  'm-1': [{ property: 'margin', value: '0.25rem' }],
  'm-2': [{ property: 'margin', value: '0.5rem' }],
  'm-4': [{ property: 'margin', value: '1rem' }],
  'mt-0': [{ property: 'margin-top', value: '0' }],
  'mt-1': [{ property: 'margin-top', value: '0.25rem' }],
  'mt-2': [{ property: 'margin-top', value: '0.5rem' }],
  'mt-4': [{ property: 'margin-top', value: '1rem' }],
  'mb-0': [{ property: 'margin-bottom', value: '0' }],
  'mb-2': [{ property: 'margin-bottom', value: '0.5rem' }],
  'mb-4': [{ property: 'margin-bottom', value: '1rem' }],
  'bg-white': [{ property: 'background-color', value: 'rgb(255, 255, 255)' }],
  'bg-black': [{ property: 'background-color', value: 'rgb(0, 0, 0)' }],
  'bg-gray-100': [{ property: 'background-color', value: 'rgb(243, 244, 246)' }],
  'bg-gray-200': [{ property: 'background-color', value: 'rgb(229, 231, 235)' }],
  'bg-gray-500': [{ property: 'background-color', value: 'rgb(107, 114, 128)' }],
  'bg-blue-500': [{ property: 'background-color', value: 'rgb(59, 130, 246)' }],
  'bg-red-500': [{ property: 'background-color', value: 'rgb(239, 68, 68)' }],
  'bg-green-500': [{ property: 'background-color', value: 'rgb(34, 197, 94)' }],
  'text-white': [{ property: 'color', value: 'rgb(255, 255, 255)' }],
  'text-black': [{ property: 'color', value: 'rgb(0, 0, 0)' }],
  'text-gray-500': [{ property: 'color', value: 'rgb(107, 114, 128)' }],
  'text-blue-500': [{ property: 'color', value: 'rgb(59, 130, 246)' }],
  'text-red-500': [{ property: 'color', value: 'rgb(239, 68, 68)' }],
  'rounded': [{ property: 'border-radius', value: '0.25rem' }],
  'rounded-md': [{ property: 'border-radius', value: '0.375rem' }],
  'rounded-lg': [{ property: 'border-radius', value: '0.5rem' }],
  'rounded-full': [{ property: 'border-radius', value: '9999px' }],
  'border': [{ property: 'border-width', value: '1px' }],
  'shadow': [{ property: 'box-shadow', value: '0 1px 3px rgba(0,0,0,0.1)' }],
  'shadow-md': [{ property: 'box-shadow', value: '0 4px 6px rgba(0,0,0,0.1)' }],
  'shadow-lg': [{ property: 'box-shadow', value: '0 10px 15px rgba(0,0,0,0.1)' }],
  'z-0': [{ property: 'z-index', value: '0' }],
  'z-10': [{ property: 'z-index', value: '10' }],
  'z-50': [{ property: 'z-index', value: '50' }],
};

export function loadTailwindMapping(projectRoot: string): UtilityMap {
  const merged = { ...DEFAULT_UTILITIES };

  const jsConfigPath = path.join(projectRoot, 'tailwind.config.js');
  if (fs.existsSync(jsConfigPath)) {
    try {
      const raw = fs.readFileSync(jsConfigPath, 'utf-8');
      const themeMatch = raw.match(/\btheme\s*:\s*(\{[\s\S]*?\})\s*(?:,\s*|$)/);
      if (themeMatch) {
        const themeStr = themeMatch[1]!;
        const extendMatch = themeStr.match(/\bextend\s*:\s*(\{[\s\S]*?\})\s*(?:,\s*|$)/);
        const spacingMatch = (extendMatch ?? themeMatch)[1]?.match(/\bspacing\s*:\s*(\{[\s\S]*?\})\s*(?:,\s*|$)/);

        if (spacingMatch?.[1]) {
          const spacingStr = spacingMatch[1];
          const keyValues = spacingStr.match(/(\w+)\s*:\s*['"]?([^'"},\s]+)['"]?/g);
          if (keyValues) {
            for (const kv of keyValues) {
              const [key, value] = kv.split(':').map(s => s.trim().replace(/['"]/g, ''));
              if (key && value) {
                merged[`px-${key}`] = [
                  { property: 'padding-left', value },
                  { property: 'padding-right', value },
                ];
                merged[`m-${key}`] = [{ property: 'margin', value }];
              }
            }
          }
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  const v4Map = loadTailwindV4Mapping(projectRoot);
  for (const [key, props] of Object.entries(v4Map)) {
    if (!merged[key]) {
      merged[key] = props;
    }
  }

  return merged;
}

function loadTailwindV4Mapping(projectRoot: string): UtilityMap {
  const merged: UtilityMap = {};

  const candidates = ['app.css', 'globals.css', 'index.css', 'styles.css'];
  let themeSource: string | null = null;

  for (const name of candidates) {
    const candidatePath = path.join(projectRoot, name);
    if (fs.existsSync(candidatePath)) {
      try {
        themeSource = fs.readFileSync(candidatePath, 'utf-8');
        break;
      } catch { /* continue */ }
    }
  }

  if (!themeSource) return merged;

  try {
    const root = postcss.parse(themeSource);

    root.walkAtRules('theme', (atRule: AtRule) => {
      if (!atRule.nodes) return;

      atRule.walkDecls((decl) => {
        if (!decl.prop.startsWith('--')) return;

        const tokenName = decl.prop.replace(/^--/, '');
        const value = decl.value;

        if (tokenName.startsWith('color-') || tokenName.startsWith('colors-')) {
          const suffix = tokenName.replace(/^colors?[-.]/, '').replace(/\./g, '-');
          merged[`bg-${suffix}`] = [{ property: 'background-color', value }];
          merged[`text-${suffix}`] = [{ property: 'color', value }];
          merged[`border-${suffix}`] = [{ property: 'border-color', value }];
          merged[`ring-${suffix}`] = [{ property: '--tw-ring-color', value }];
        } else if (tokenName.startsWith('spacing-') || tokenName.startsWith('spacing.')) {
          const suffix = tokenName.replace(/^spacing[.-]/, '');
          merged[`p-${suffix}`] = [{ property: 'padding', value }];
          merged[`px-${suffix}`] = [
            { property: 'padding-left', value },
            { property: 'padding-right', value },
          ];
          merged[`py-${suffix}`] = [
            { property: 'padding-top', value },
            { property: 'padding-bottom', value },
          ];
          merged[`m-${suffix}`] = [{ property: 'margin', value }];
          merged[`mx-${suffix}`] = [
            { property: 'margin-left', value },
            { property: 'margin-right', value },
          ];
          merged[`gap-${suffix}`] = [{ property: 'gap', value }];
        } else if (tokenName.startsWith('font-size-') || tokenName.startsWith('fontSize-')) {
          const suffix = tokenName.replace(/^font[sS]ize[-.]/, '').replace(/\./g, '-');
          merged[`text-${suffix}`] = [{ property: 'font-size', value }];
        } else if (tokenName.startsWith('font-weight-') || tokenName.startsWith('fontWeight-')) {
          const suffix = tokenName.replace(/^font[sS]?[wW]eight[-.]/, '').replace(/\./g, '-');
          merged[`font-${suffix}`] = [{ property: 'font-weight', value }];
        } else if (tokenName.startsWith('border-radius-') || tokenName.startsWith('borderRadius-')) {
          const suffix = tokenName.replace(/^border[sS]?[rR]adius[-.]/, '').replace(/\./g, '-');
          merged[`rounded-${suffix}`] = [{ property: 'border-radius', value }];
        }
      });
    });
  } catch {
    // Ignore parse errors
  }

  return merged;
}
