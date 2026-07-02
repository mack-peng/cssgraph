import { QueryBuilder } from '../db/queries';
import { Node, Context } from '../types';
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
