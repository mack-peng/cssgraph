import { Subgraph, TraversalOptions, Node, Edge, EdgeKind } from '../types';
import { QueryBuilder } from '../db/queries';

const DEFAULT_OPTIONS: Required<TraversalOptions> = {
  maxDepth: Infinity,
  edgeKinds: [],
  nodeKinds: [],
  direction: 'outgoing',
  limit: 1000,
  includeStart: true,
};

export class GraphTraverser {
  private queries: QueryBuilder;

  constructor(queries: QueryBuilder) {
    this.queries = queries;
  }

  traverseBFS(startId: string, options: TraversalOptions = {}): Subgraph {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const startNode = this.queries.getNodeById(startId);
    if (!startNode) return { nodes: new Map(), edges: [], roots: [] };

    const nodes = new Map<string, Node>();
    const edges: Edge[] = [];
    const visited = new Set<string>();
    const enqueued = new Set<string>([startNode.id]);
    const seenEdges = new Set<string>();
    const edgeKey = (e: Edge) => `${e.source}|${e.target}|${e.kind}|${e.line ?? -1}|${e.column ?? -1}`;

    const queue: Array<{ node: Node; depth: number }> = [{ node: startNode, depth: 0 }];

    if (opts.includeStart) {
      nodes.set(startNode.id, startNode);
    }

    while (queue.length > 0 && nodes.size < opts.limit) {
      const { node, depth } = queue.shift()!;
      if (visited.has(node.id)) continue;
      visited.add(node.id);

      if (depth >= opts.maxDepth) continue;

      const outgoing = opts.direction === 'outgoing' || opts.direction === 'both'
        ? this.queries.getOutgoingEdges(node.id) : [];
      const incoming = opts.direction === 'incoming' || opts.direction === 'both'
        ? this.queries.getIncomingEdges(node.id) : [];

      for (const edge of [...outgoing, ...incoming]) {
        if (opts.edgeKinds.length > 0 && !opts.edgeKinds.includes(edge.kind)) continue;

        const neighborId = edge.source === node.id ? edge.target : edge.source;
        if (enqueued.has(neighborId)) continue;

        const neighbor = this.queries.getNodeById(neighborId);
        if (!neighbor) continue;

        if (opts.nodeKinds.length > 0 && !opts.nodeKinds.includes(neighbor.kind)) continue;

        const key = edgeKey(edge);
        if (!seenEdges.has(key)) {
          seenEdges.add(key);
          edges.push(edge);
        }

        enqueued.add(neighborId);
        nodes.set(neighbor.id, neighbor);
        queue.push({ node: neighbor, depth: depth + 1 });
      }
    }

    return { nodes, edges, roots: [startId] };
  }

  getCallers(nodeId: string, maxDepth: number = 1): Array<{ node: Node; edge: Edge }> {
    const result: Array<{ node: Node; edge: Edge }> = [];
    const visited = new Set<string>();
    this.collectCallersRecursive(nodeId, maxDepth, 0, visited, result);
    return result;
  }

  private collectCallersRecursive(
    nodeId: string,
    maxDepth: number,
    currentDepth: number,
    visited: Set<string>,
    result: Array<{ node: Node; edge: Edge }>,
  ): void {
    if (currentDepth >= maxDepth || visited.has(nodeId)) return;
    visited.add(nodeId);

    const incoming = this.queries.getIncomingEdges(nodeId);
    for (const edge of incoming) {
      if (edge.kind !== 'references' && edge.kind !== 'contains') continue;
      const caller = this.queries.getNodeById(edge.source);
      if (caller && !visited.has(caller.id)) {
        result.push({ node: caller, edge });
        this.collectCallersRecursive(caller.id, maxDepth, currentDepth + 1, visited, result);
      }
    }
  }

  getCallees(nodeId: string, maxDepth: number = 1): Array<{ node: Node; edge: Edge }> {
    const result: Array<{ node: Node; edge: Edge }> = [];
    const visited = new Set<string>();
    this.collectCalleesRecursive(nodeId, maxDepth, 0, visited, result);
    return result;
  }

  private collectCalleesRecursive(
    nodeId: string,
    maxDepth: number,
    currentDepth: number,
    visited: Set<string>,
    result: Array<{ node: Node; edge: Edge }>,
  ): void {
    if (currentDepth >= maxDepth || visited.has(nodeId)) return;
    visited.add(nodeId);

    const outgoing = this.queries.getOutgoingEdges(nodeId);
    for (const edge of outgoing) {
      const callee = this.queries.getNodeById(edge.target);
      if (callee && !visited.has(callee.id)) {
        result.push({ node: callee, edge });
        this.collectCalleesRecursive(callee.id, maxDepth, currentDepth + 1, visited, result);
      }
    }
  }

  getImpactRadius(nodeId: string, maxDepth: number = 3): Subgraph {
    return this.traverseBFS(nodeId, { maxDepth, direction: 'both' });
  }

  findPath(fromId: string, toId: string, edgeKinds?: EdgeKind[]): Array<{ node: Node; edge: Edge | null }> | null {
    const fromNode = this.queries.getNodeById(fromId);
    if (!fromNode) return null;

    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; path: Array<{ node: Node; edge: Edge | null }> }> = [
      { nodeId: fromId, path: [{ node: fromNode, edge: null }] },
    ];

    while (queue.length > 0) {
      const { nodeId, path } = queue.shift()!;
      if (nodeId === toId) return path;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const outgoing = this.queries.getOutgoingEdges(nodeId);
      for (const edge of outgoing) {
        if (edgeKinds && edgeKinds.length > 0 && !edgeKinds.includes(edge.kind)) continue;
        const target = this.queries.getNodeById(edge.target);
        if (target && !visited.has(target.id)) {
          queue.push({ nodeId: target.id, path: [...path, { node: target, edge }] });
        }
      }
    }

    return null;
  }

  getAncestors(nodeId: string): Node[] {
    const ancestors: Node[] = [];
    let current = this.queries.getNodeById(nodeId);
    while (current) {
      const incoming = this.queries.getIncomingEdges(current.id).filter(e => e.kind === 'contains');
      if (incoming.length === 0) break;
      const parent = this.queries.getNodeById(incoming[0]!.source);
      if (!parent) break;
      ancestors.push(parent);
      current = parent;
    }
    return ancestors;
  }

  getChildren(nodeId: string): Node[] {
    const outgoing = this.queries.getOutgoingEdges(nodeId).filter(e => e.kind === 'contains');
    return outgoing.map(e => this.queries.getNodeById(e.target)).filter(Boolean) as Node[];
  }
}
