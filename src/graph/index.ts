import { QueryBuilder } from '../db/queries';
import {
  Node, Context, UnusedResult, CascadeResult, CascadeStep,
  PropertySearchOptions, PropertySearchResult, RuleAnalysisResult,
} from '../types';
import { GraphTraverser } from './traversal';
import selectorParser from 'postcss-selector-parser';

export { GraphTraverser } from './traversal';

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

  findUnusedClassSelectors(): UnusedResult[] {
    const candidates = this.queries.getClassSelectorsWithoutReferenceEdges();
    return candidates.map(({ node }) => {
      const incoming = this.queries.getIncomingEdges(node.id);
      const referencesCount = incoming.filter(e => e.kind === 'references').length;
      return { node, referencedBy: referencesCount };
    });
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

  analyzeRule(selector: string): RuleAnalysisResult {
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
