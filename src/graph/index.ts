import { QueryBuilder } from '../db/queries';
import {
  Node, Context, UnusedResult, CascadeResult, CascadeStep,
  PropertySearchOptions, PropertySearchResult, RuleAnalysisResult, RuleMatch,
  DiagnoseResult, AnchorLevel, AnchorConfidence,
} from '../types';
import { GraphTraverser } from './traversal';
import selectorParser from 'postcss-selector-parser';

export { GraphTraverser } from './traversal';

export interface SelectorImpactResult {
  selector: string;
  classes: string[];
  definition: Array<{ filePath: string; line: number; selector: string }>;
  strict: string[];
  loose: string[];
}

export function normalizeSelector(selector: string): string {
  return selector.trim().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ');
}

/** Replace hashed CSS Module class names with original names using the hash map. */
export function resolveHashedSelector(selector: string, hashMap?: Map<string, string>): string {
  if (!hashMap || hashMap.size === 0) return selector;
  let result = selector;
  for (const [hashed, original] of hashMap) {
    if (hashed !== original) {
      result = result.replace(new RegExp(`\\.${escapeRegex(hashed)}\\b`, 'g'), `.${original}`);
    }
  }
  return result;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Extract className list from a chain label (e.g. 'div.s-kit-modal.site-version-history-dialog-wrapper' or '.s-kit-modal') */
function extractClasses(label: string): string[] {
  const classes: string[] = [];
  for (const part of label.split(/[\s>+~]/)) {
    const m = part.match(/\.([A-Za-z0-9_-]+)/g);
    if (m) classes.push(...m.map(c => c.slice(1)));
  }
  // Keep tag-only labels (e.g. 'html') so callers can pass tag names
  return classes.length > 0 ? classes : [label.replace(/^[.#]/, '')];
}

/** Classify a height declaration: absolute unit = DEFINITE (usable as anchor); % = INDEFINITE (depends on parent); otherwise = UNVERIFIABLE */
function classifyHeight(declared: string | null): AnchorConfidence {
  if (!declared) return 'UNVERIFIABLE';
  if (/^(0|[1-9]\d*)(\.\d+)?(px|vh|vw|rem|em|pt|cm|mm|in)$/.test(declared)) return 'DEFINITE';
  if (declared.endsWith('%')) return 'INDEFINITE';
  if (/^calc\(/.test(declared)) {
    return /(px|vh|vw|rem|em)/.test(declared) ? 'DEFINITE' : 'UNVERIFIABLE';
  }
  return 'UNVERIFIABLE';
}

/** Parse a pure px value; return null if not parseable */
function parsePx(value: string | null): number | null {
  if (!value) return null;
  const m = value.trim().match(/^(\d+(\.\d+)?)px$/);
  return m ? Number(m[1]) : null;
}

export class GraphQueryManager {
  private queries: QueryBuilder;
  private traverser: GraphTraverser;

  constructor(queries: QueryBuilder) {
    this.queries = queries;
    this.traverser = new GraphTraverser(queries);
  }

  getContext(nodeId: string): Context {
    const focal = this.queries.getNodeById(nodeId)!;
    const ancestors = this.traverser.getAncestors(nodeId);
    const children = this.traverser.getChildren(nodeId);

    const incoming = this.queries.getIncomingEdges(nodeId);
    const outgoing = this.queries.getOutgoingEdges(nodeId);

    const incomingRefs = incoming.map(e => ({ node: this.queries.getNodeById(e.source)!, edge: e })).filter(r => r.node);
    const outgoingRefs = outgoing.map(e => ({ node: this.queries.getNodeById(e.target)!, edge: e })).filter(r => r.node);

    return {
      focal,
      ancestors,
      children,
      incomingRefs,
      outgoingRefs,
      types: [],
      imports: [],
    };
  }

  getFileDependencies(filePath: string): string[] {
    return this.queries.getFileDependencies(filePath);
  }

  getFileDependents(filePath: string): string[] {
    return this.queries.getFileDependents(filePath);
  }

  findCircularDependencies(): string[][] {
    return [];
  }

  findDeadCode(kinds?: Node['kind'][]): Node[] {
    const allNodes = kinds
      ? kinds.flatMap(k => this.queries.getNodesByKind(k))
      : [];

    return allNodes.filter(n => {
      const incoming = this.queries.getIncomingEdges(n.id);
      return incoming.length === 0;
    });
  }

  findUnusedClassSelectors(limit: number): UnusedResult[] {
    return this.queries.getClassSelectorsWithoutReferenceEdges(limit);
  }

  getCascade(className: string): CascadeResult {
    const selectors = this.queries.getClassSelectorsByName(className);

    const steps: CascadeStep[] = selectors.map(node => {
      const outgoing = this.queries.getOutgoingEdges(node.id);
      const incoming = this.queries.getIncomingEdges(node.id);

      const propertyNodes = outgoing
        .filter(e => e.kind === 'contains')
        .map(e => this.queries.getNodeById(e.target))
        .filter((n): n is Node => n?.kind === 'css_property');

      const properties = propertyNodes.map(n => ({
        property: n.name,
        value: n.value ?? '',
      }));

      const overrides = outgoing
        .filter(e => e.kind === 'overrides')
        .map(e => this.queries.getNodeById(e.target))
        .filter((n): n is Node => !!n);

      const overriddenBy = incoming
        .filter(e => e.kind === 'overrides')
        .map(e => this.queries.getNodeById(e.source))
        .filter((n): n is Node => !!n);

      return {
        node,
        specificity: node.specificity,
        properties,
        overrides,
        overriddenBy,
      };
    });

    steps.sort((a, b) => cmpSpecificityDesc(a.specificity, b.specificity));

    return { className, steps };
  }

  searchByPropertyValue(options: PropertySearchOptions): PropertySearchResult[] {
    const results = this.queries.searchNodesByPropertyValue(options);
    return results.map(({ node }) => {
      const incoming = this.queries.getIncomingEdges(node.id);
      const selectorNode = incoming
        .filter(e => e.kind === 'contains')
        .map(e => this.queries.getNodeById(e.source))
        .find((n): n is Node => n?.kind === 'class_selector') ?? undefined;
      return { node, selectorNode };
    });
  }

  analyzeRule(rawSelector: string, hashMap?: Map<string, string>): RuleAnalysisResult {
    const selector = normalizeSelector(resolveHashedSelector(rawSelector, hashMap));
    const parsed = parseSelector(selector);

    const makeKey = (n: Node) => `${n.filePath}:${n.startLine}:${n.selector ?? n.name}`;
    const dedupeNodes = (nodes: Node[]): Node[] => {
      const seen = new Set<string>();
      return nodes.filter(n => {
        const key = makeKey(n);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    const exactNodes = dedupeNodes(this.queries.getClassSelectorsBySelector(selector));
    const exactMatches = exactNodes.map(n => ({
      node: n,
      properties: n.properties ?? this.getPropertiesForNode(n.id),
    }));

    const containsNodes = dedupeNodes(this.queries.getClassSelectorsContainingClasses(parsed.classes));
    const containsMatches = containsNodes.map(n => ({
      node: n,
      properties: n.properties ?? this.getPropertiesForNode(n.id),
    }));

    const classUsage: RuleAnalysisResult['classUsage'] = [];
    const classToFiles = new Map<string, Set<string>>();

    for (const cls of parsed.classes) {
      const files = new Set<string>();
      const nodes = this.queries.getClassSelectorsByName(cls);
      for (const node of nodes) {
        const incoming = this.queries.getIncomingEdges(node.id);
        for (const edge of incoming) {
          if (edge.kind !== 'references') continue;
          const source = this.queries.getNodeById(edge.source);
          if (source) files.add(source.filePath);
        }
      }
      classToFiles.set(cls, files);
      classUsage.push({ className: cls, files: Array.from(files).sort(), nodeCount: nodes.length });
    }

    const allFiles = new Set<string>();
    const intersection = new Set<string>();
    let first = true;

    for (const [, files] of classToFiles) {
      for (const f of files) allFiles.add(f);
      if (first) {
        for (const f of files) intersection.add(f);
        first = false;
      } else {
        for (const f of Array.from(intersection)) {
          if (!files.has(f)) intersection.delete(f);
        }
      }
    }

    // Files that define the selector itself are always in the loose impact set.
    for (const m of exactMatches) allFiles.add(m.node.filePath);
    for (const m of containsMatches) allFiles.add(m.node.filePath);

    return {
      selector,
      classes: parsed.classes,
      ids: parsed.ids,
      tags: parsed.tags,
      exactMatches,
      containsMatches,
      classUsage,
      looseFiles: Array.from(allFiles).sort(),
      strictFiles: Array.from(intersection).sort(),
    };
  }

  getSelectorDetails(rawSelector: string, hashMap?: Map<string, string>): RuleMatch[] {
    const selector = normalizeSelector(resolveHashedSelector(rawSelector, hashMap));
    const nodes = this.queries.getClassSelectorsBySelector(selector);
    const seen = new Set<string>();
    const results: RuleMatch[] = [];
    for (const n of nodes) {
      const key = `${n.filePath}:${n.startLine}:${n.selector ?? n.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        node: n,
        properties: n.properties ?? this.getPropertiesForNode(n.id),
      });
    }
    return results;
  }

  /**
   * Static anchor diagnosis: walk the DOM ancestor chain, classify each level's height as DEFINITE / INDEFINITE / UNVERIFIABLE.
   * The chain is supplied by the caller (e.g. ancestor labels from a DOM Reality Report, like ['div.editor-root', 'div.s-kit-modal', ...]).
   * Each label's classNames are extracted (e.g. 'div.editor-root' → 'editor-root') to look up rules.
   * Limitation: static analysis cannot know the real DOM structure / transform hijacking / runtime resolution; UNVERIFIABLE is the fallback confidence.
   */
  diagnoseHeightAnchor(target: string, chain: string[] = [target]): DiagnoseResult {
    const levels: AnchorLevel[] = [];
    const redFlags: string[] = [];

    for (const label of chain) {
      const classes = extractClasses(label);
      const level = this.diagnoseLevel(classes, label);
      levels.push(level);
      redFlags.push(...level.redFlags);
    }

    // Find the first level (root→up) that provides a definite height
    let anchorLevel: string | null = null;
    for (const lv of levels) {
      if (lv.providesAnchor) {
        anchorLevel = lv.label;
        break;
      }
    }

    const hasUnverifiable = levels.some(l => l.confidence === 'UNVERIFIABLE');
    const anchored = anchorLevel !== null;

    const recommendations: string[] = [];
    if (anchored) {
      recommendations.push(`Anchor found at ${anchorLevel} (absolute-unit height). If the target still does not scroll, check for overflow clipping or min-height constraints below this level.`);
    } else {
      recommendations.push('No absolute-unit height in the chain → % resolution depends on runtime (parent auto or containing block hijack). Give one level a definite height, e.g. height:100vh.');
    }
    if (hasUnverifiable) {
      recommendations.push('UNVERIFIABLE level present (auto/none/%) → cannot be proven statically; run the DOM Reality Report (browser-agent scripts/dom-report.js) and trust real rendering.');
    }
    if (redFlags.length > 0) {
      recommendations.push('Compensation red flags detected (overflow + large margin / fixed + %). These usually reserve scroll space with margins; prefer a constrained height + overflow:auto instead.');
    }

    const verdict = anchored
      ? `Chain has a definite anchor (${anchorLevel})`
      : hasUnverifiable
        ? 'No definite anchor and UNVERIFIABLE levels present → resolution depends on runtime; static proof impossible, verify against real rendering'
        : 'No definite anchor (all INDEFINITE %) → heights depend on parents; walk up until an absolute unit appears';

    return { target, levels, anchored, anchorLevel, verdict, recommendations };
  }

  private diagnoseLevel(classes: string[], label: string): AnchorLevel {
    const matched: Array<{ node: Node; props: Array<{ property: string; value: string }> }> = [];
    for (const cls of classes) {
      const nodes = this.queries.getClassSelectorsByName(cls);
      for (const node of nodes) {
        matched.push({ node, props: node.properties ?? this.getPropertiesForNode(node.id) });
      }
    }

    // Sort by specificity desc (approximate effective chain); nodes without specificity go last
    matched.sort((a, b) => cmpSpecificityDesc(a.node.specificity, b.node.specificity));

    const merge = (prop: string): string | null => {
      for (const m of matched) {
        const found = m.props.find(p => p.property === prop && p.value && p.value !== 'auto');
        if (found) return found.value;
      }
      return null;
    };

    const declaredHeight = merge('height');
    const declaredMaxHeight = merge('max-height');
    const overflowY = merge('overflow-y');
    const marginBottom = merge('margin-bottom');
    const position = merge('position');

    const selectors = matched.map(m => m.node.selector ?? m.node.name).filter((v, i, a) => a.indexOf(v) === i);
    const locations = matched.map(m => `${m.node.filePath}:${m.node.startLine}`);

    const confidence: AnchorConfidence = classifyHeight(declaredHeight);
    const providesAnchor = confidence === 'DEFINITE';

    const flags: string[] = [];
    if (overflowY === 'auto' || overflowY === 'scroll') {
      const mb = parsePx(marginBottom);
      if (mb !== null && mb >= 100) {
        flags.push(`RED FLAG: overflow-y:${overflowY} + margin-bottom:${marginBottom}(${mb}px) → looks like reserving scroll space with margin`);
      }
      if (declaredHeight === null) {
        flags.push(`overflow-y:${overflowY} without a height declaration → container height depends on parent chain/content`);
      }
    }
    if (position === 'fixed' && declaredHeight && declaredHeight.endsWith('%')) {
      flags.push(`position:fixed + height:${declaredHeight} → % resolves against the containing block (a transform ancestor can hijack it), unprovable statically`);
    }
    if (declaredMaxHeight && !declaredHeight) {
      flags.push(`Only max-height:${declaredMaxHeight}, no height → a cap is not an anchor; % children still resolve to auto`);
    }
    if (!declaredHeight && !declaredMaxHeight) {
      flags.push('No height/max-height declaration → height depends on content (auto)');
    }

    return {
      label,
      selectors: selectors.slice(0, 5),
      declaredHeight,
      declaredMaxHeight,
      confidence,
      providesAnchor,
      redFlags: flags,
      locations: locations.slice(0, 5),
    };
  }

  private getPropertiesForNode(nodeId: string): Array<{ property: string; value: string }> {
    const outgoing = this.queries.getOutgoingEdges(nodeId);
    const props: Array<{ property: string; value: string }> = [];
    for (const edge of outgoing) {
      if (edge.kind !== 'contains') continue;
      const child = this.queries.getNodeById(edge.target);
      if (child?.kind === 'css_property' && child.value !== undefined) {
        props.push({ property: child.name, value: child.value });
      }
    }
    return props;
  }

  selectorImpact(rawSelector: string, hashMap?: Map<string, string>): SelectorImpactResult {
    const analysis = this.analyzeRule(rawSelector, hashMap);

    const isCodeFile = (f: string) => {
      const ext = f.split('.').pop()?.toLowerCase();
      return ext === 'js' || ext === 'jsx' || ext === 'ts' || ext === 'tsx' || ext === 'es6';
    };

    const strict = analysis.strictFiles.filter(isCodeFile);
    const loose = analysis.looseFiles.filter(isCodeFile);

    const definition = analysis.exactMatches.map(m => ({
      filePath: m.node.filePath,
      line: m.node.startLine,
      selector: m.node.selector ?? analysis.selector,
    }));

    return {
      selector: analysis.selector,
      classes: analysis.classes,
      definition,
      strict,
      loose,
    };
  }

  getNodeMetrics(nodeId: string): {
    incomingEdgeCount: number;
    outgoingEdgeCount: number;
    callCount: number;
    callerCount: number;
    childCount: number;
    depth: number;
  } {
    const incoming = this.queries.getIncomingEdges(nodeId);
    const outgoing = this.queries.getOutgoingEdges(nodeId);
    const children = this.traverser.getChildren(nodeId);
    const ancestors = this.traverser.getAncestors(nodeId);

    return {
      incomingEdgeCount: incoming.length,
      outgoingEdgeCount: outgoing.length,
      callCount: outgoing.length,
      callerCount: incoming.length,
      childCount: children.length,
      depth: ancestors.length,
    };
  }
}

function parseSelector(selector: string): { classes: string[]; ids: string[]; tags: string[] } {
  const classes = new Set<string>();
  const ids = new Set<string>();
  const tags = new Set<string>();

  try {
    const root = selectorParser().astSync(selector);
    root.walk((node) => {
      if (node.type === 'class') {
        classes.add(node.value);
      } else if (node.type === 'id') {
        ids.add(node.value);
      } else if (node.type === 'tag') {
        tags.add(node.value);
      }
    });
  } catch {
    // Fall back to regex extraction if parsing fails
    const classMatches = selector.match(/\.([a-zA-Z0-9_\-]+)/g);
    classMatches?.forEach(m => classes.add(m.slice(1)));
    const idMatches = selector.match(/#([a-zA-Z0-9_\-]+)/g);
    idMatches?.forEach(m => ids.add(m.slice(1)));
  }

  return {
    classes: Array.from(classes),
    ids: Array.from(ids),
    tags: Array.from(tags),
  };
}

function cmpSpecificityDesc(
  a?: [number, number, number, number],
  b?: [number, number, number, number],
): number {
  const aa = a ?? [0, 0, 0, 0];
  const bb = b ?? [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    if (aa[i] !== bb[i]) return (bb[i] ?? 0) - (aa[i] ?? 0);
  }
  return 0;
}
