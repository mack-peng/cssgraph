import { QueryBuilder } from '../db/queries';
import {
  Node, Context, UnusedResult, CascadeResult, CascadeStep,
  PropertySearchOptions, PropertySearchResult, RuleAnalysisResult, RuleMatch,
  DiagnoseResult, AnchorLevel, AnchorConfidence, LayoutRole, SizingStrategy,
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

/** Classify a height/width declaration: absolute unit = DEFINITE; % = INDEFINITE; otherwise = UNVERIFIABLE */
function classifyHeight(declared: string | null): AnchorConfidence {
  if (!declared) return 'UNVERIFIABLE';
  if (/^(0|[1-9]\d*)(\.\d+)?(px|vh|vw|rem|em|pt|cm|mm|in)$/.test(declared)) return 'DEFINITE';
  if (declared.endsWith('%')) return 'INDEFINITE';
  if (/^calc\(/.test(declared)) {
    return /(px|vh|vw|rem|em)/.test(declared) ? 'DEFINITE' : 'UNVERIFIABLE';
  }
  return 'UNVERIFIABLE';
}

/** Classify sizing strategy from a declaration value */
function classifySizing(val: string | null, maxVal: string | null): SizingStrategy {
  if (val) {
    if (/^(0|[1-9]\d*)(\.\d+)?(px|pt|cm|mm|in)$/.test(val)) return 'fixed';
    if (/^(0|[1-9]\d*)(\.\d+)?(vh|vw|vmin|vmax)$/.test(val)) return 'viewport';
    if (val.endsWith('%')) return 'percent';
    if (/^calc\(/.test(val)) return 'calc';
  }
  if (maxVal && maxVal !== 'none' && maxVal !== 'auto') return 'constrained';
  return 'content';
}

/** Classify layout role from display and position declarations */
function classifyRole(display: string | null, position: string | null, flexDir: string | null): LayoutRole {
  if (position === 'fixed') return 'fixed';
  if (position === 'absolute') return 'absolute';
  if (position === 'sticky') return 'sticky';
  if (display === 'grid' || display === 'inline-grid') return 'grid';
  if (display === 'flex' || display === 'inline-flex') {
    return flexDir === 'column' ? 'flex-col' : 'flex-row';
  }
  if (display === 'inline' || display === 'inline-block') return 'inline';
  return 'block';
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
   * Static shape diagnosis: walk the DOM ancestor chain, classify layout role + sizing strategy at each level.
   * The chain is supplied by the caller (e.g. ancestor labels from a DOM Reality Report, like ['div.editor-root', 'div.s-kit-modal', ...]).
   * Each label's classNames are extracted (e.g. 'div.editor-root' → 'editor-root') to look up rules.
   * Limitation: static analysis cannot know the real DOM structure / transform hijacking / runtime resolution.
   */
  diagnoseShape(target: string, chain: string[] = [target]): DiagnoseResult {
    const levels: AnchorLevel[] = [];

    for (const label of chain) {
      const classes = extractClasses(label);
      const level = this.diagnoseLevel(classes, label);
      levels.push(level);
    }

    // Height anchor: first level (root→up) with DEFINITE height
    let anchorLevel: string | null = null;
    for (const lv of levels) {
      if (lv.providesAnchor) {
        anchorLevel = lv.label;
        break;
      }
    }

    // Width anchor: first level with DEFINITE width
    let widthAnchorLevel: string | null = null;
    for (const lv of levels) {
      if (classifyHeight(lv.declaredWidth) === 'DEFINITE') {
        widthAnchorLevel = lv.label;
        break;
      }
    }

    const anchored = anchorLevel !== null;
    const widthAnchored = widthAnchorLevel !== null;
    const allRedFlags = levels.flatMap(l => l.redFlags);

    // Shape chain summary
    const shapeChain = levels.map(l => ({
      label: l.label,
      role: l.role,
      heightStrategy: l.heightStrategy,
      widthStrategy: l.widthStrategy,
    }));

    // Pattern recognition
    const patterns: string[] = [];
    const hasFixedAncestor = levels.some(l => l.role === 'fixed');
    const hasFlexColAncestor = levels.some(l => l.role === 'flex-col');
    const hasScrollContainer = levels.some(l => l.declaredOverflowY === 'auto' || l.declaredOverflowY === 'scroll');
    const allContentSized = levels.every(l => l.heightStrategy === 'content');

    if (hasFixedAncestor && !anchored) {
      patterns.push('fixed ancestor + no height anchor → children % resolve to auto → content-sized overflow');
    }
    if (hasFlexColAncestor) {
      patterns.push('flex-col ancestor → children height governed by flex-grow/shrink/min-height');
    }
    if (hasScrollContainer && !anchored) {
      patterns.push('scroll container exists but no height anchor above → overflow:auto never triggers (content-sized)');
    }
    if (allContentSized) {
      patterns.push('all ancestors are content-sized → height depends entirely on content, no constraints propagate');
    }
    if (!widthAnchored) {
      patterns.push('no absolute width in chain → width depends on parent/content');
    }

    // Recommendations
    const recommendations: string[] = [];
    if (anchored) {
      recommendations.push(`Height anchor found at ${anchorLevel}. If the target still does not scroll, check for overflow clipping or min-height constraints below this level.`);
    } else {
      recommendations.push('No absolute-unit height in the chain → % resolution depends on runtime. Give one level a definite height, e.g. height:100vh.');
    }
    if (!widthAnchored) {
      recommendations.push('No absolute width in chain → width depends on parent/content. If width is unexpected, give one level a definite width.');
    }
    const hasUnverifiable = levels.some(l => l.confidence === 'UNVERIFIABLE');
    if (hasUnverifiable) {
      recommendations.push('UNVERIFIABLE level present → cannot be proven statically; run dom-report.js and trust real rendering.');
    }
    if (allRedFlags.length > 0) {
      recommendations.push('Red flags detected (overflow + large margin / fixed + % / max-height only). See level details.');
    }
    if (patterns.length > 0) {
      recommendations.push(`Patterns detected: ${patterns.join('; ')}`);
    }

    const verdict = anchored
      ? `Chain has a definite height anchor (${anchorLevel})`
      : hasUnverifiable
        ? 'No definite height anchor and UNVERIFIABLE levels → resolution depends on runtime; verify against real rendering'
        : 'No definite height anchor (all INDEFINITE %) → heights depend on parents; walk up until an absolute unit appears';

    return { target, levels, anchored, anchorLevel, widthAnchored, widthAnchorLevel, shapeChain, patterns, verdict, recommendations };
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
    const declaredWidth = merge('width');
    const declaredMaxWidth = merge('max-width');
    const declaredDisplay = merge('display');
    const declaredPosition = merge('position');
    const declaredFlexDir = merge('flex-direction');
    const declaredOverflowY = merge('overflow-y');
    const marginBottom = merge('margin-bottom');

    // Containing block modifiers
    const cbProps = ['transform', 'filter', 'perspective', 'will-change', 'contain'];
    const hasContainingBlockModifier = cbProps.some(p => {
      const v = merge(p);
      return v && v !== 'none' && v !== 'auto' && v !== 'normal';
    });

    const selectors = matched.map(m => m.node.selector ?? m.node.name).filter((v, i, a) => a.indexOf(v) === i);
    const locations = matched.map(m => `${m.node.filePath}:${m.node.startLine}`);

    const confidence: AnchorConfidence = classifyHeight(declaredHeight);
    const providesAnchor = confidence === 'DEFINITE';
    const role: LayoutRole = classifyRole(declaredDisplay, declaredPosition, declaredFlexDir);
    const heightStrategy: SizingStrategy = classifySizing(declaredHeight, declaredMaxHeight);
    const widthStrategy: SizingStrategy = classifySizing(declaredWidth, declaredMaxWidth);

    const flags: string[] = [];
    if (declaredOverflowY === 'auto' || declaredOverflowY === 'scroll') {
      const mb = parsePx(marginBottom);
      if (mb !== null && mb >= 100) {
        flags.push(`RED FLAG: overflow-y:${declaredOverflowY} + margin-bottom:${marginBottom}(${mb}px) → looks like reserving scroll space with margin`);
      }
      if (declaredHeight === null) {
        flags.push(`overflow-y:${declaredOverflowY} without a height declaration → container height depends on parent chain/content`);
      }
    }
    if (declaredPosition === 'fixed' && declaredHeight && declaredHeight.endsWith('%')) {
      flags.push(`position:fixed + height:${declaredHeight} → % resolves against the containing block (a transform ancestor can hijack it), unprovable statically`);
    }
    if (declaredMaxHeight && !declaredHeight) {
      flags.push(`Only max-height:${declaredMaxHeight}, no height → a cap is not an anchor; % children still resolve to auto`);
    }
    if (!declaredHeight && !declaredMaxHeight) {
      flags.push('No height/max-height declaration → height depends on content (auto)');
    }
    if (hasContainingBlockModifier) {
      const cbDeclared = cbProps.filter(p => { const v = merge(p); return v && v !== 'none' && v !== 'auto' && v !== 'normal'; });
      flags.push(`Containing block modifier: ${cbDeclared.join(', ')} → establishes new containing block for fixed/absolute descendants`);
    }

    return {
      label,
      selectors: selectors.slice(0, 5),
      role,
      heightStrategy,
      widthStrategy,
      declaredHeight,
      declaredMaxHeight,
      declaredWidth,
      declaredDisplay,
      declaredPosition,
      declaredOverflowY,
      hasContainingBlockModifier,
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
