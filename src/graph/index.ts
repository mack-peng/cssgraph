import { QueryBuilder } from '../db/queries';
import { Node, Context, UnusedResult, CascadeResult, CascadeStep, PropertySearchOptions, PropertySearchResult } from '../types';
import { GraphTraverser } from './traversal';

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
