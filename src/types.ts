export const NODE_KINDS = [
  'file',
  'class_selector',
  'css_property',
  'css_variable',
  'at_rule',
  'styled_component',
  'jsx_component',
] as const;

export type NodeKind = (typeof NODE_KINDS)[number];

export type EdgeKind =
  | 'contains'
  | 'nests'
  | 'overrides'
  | 'imports'
  | 'references'
  | 'exports';

export const LANGUAGES = [
  'css',
  'scss',
  'less',
  'sass',
  'pcss',
  'js',
  'ts',
  'jsx',
  'tsx',
  'es6',
  'erb',
  'haml',
  'html',
  'unknown',
] as const;

export type Language = (typeof LANGUAGES)[number];

export interface Node {
  id: string;
  kind: NodeKind;
  name: string;
  qualifiedName: string;
  filePath: string;
  language: Language;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  signature?: string;
  specificity?: [number, number, number, number];
  properties?: Array<{ property: string; value: string }>;
  selector?: string;
  params?: string;
  value?: string;
  updatedAt: number;
}

export interface Edge {
  id?: number;
  source: string;
  target: string;
  kind: EdgeKind;
  metadata?: Record<string, unknown>;
  line?: number;
  column?: number;
  provenance?: 'postcss' | 'heuristic';
}

export interface FileRecord {
  path: string;
  contentHash: string;
  language: Language;
  size: number;
  modifiedAt: number;
  indexedAt: number;
  nodeCount: number;
  errors?: ExtractionError[];
}

export interface ExtractionResult {
  nodes: Node[];
  edges: Edge[];
  errors: ExtractionError[];
  durationMs: number;
}

export interface ExtractionError {
  message: string;
  filePath?: string;
  line?: number;
  column?: number;
  severity: 'error' | 'warning';
  code?: string;
}

export interface IndexProgress {
  phase: 'scanning' | 'parsing' | 'storing' | 'resolving';
  current: number;
  total: number;
  currentFile?: string;
}

export interface IndexResult {
  success: boolean;
  filesIndexed: number;
  filesSkipped: number;
  filesErrored: number;
  nodesCreated: number;
  edgesCreated: number;
  errors: ExtractionError[];
  durationMs: number;
}

export interface SyncResult {
  filesChecked: number;
  filesAdded: number;
  filesModified: number;
  filesRemoved: number;
  nodesUpdated: number;
  durationMs: number;
  changedFilePaths?: string[];
}

export interface Subgraph {
  nodes: Map<string, Node>;
  edges: Edge[];
  roots: string[];
}

export interface TraversalOptions {
  maxDepth?: number;
  edgeKinds?: EdgeKind[];
  nodeKinds?: NodeKind[];
  direction?: 'outgoing' | 'incoming' | 'both';
  limit?: number;
  includeStart?: boolean;
}

export interface SearchOptions {
  kinds?: NodeKind[];
  languages?: Language[];
  limit?: number;
  offset?: number;
  caseSensitive?: boolean;
}

export interface SearchResult {
  node: Node;
  score: number;
}

export interface PropertySearchOptions {
  property?: string;
  value: string;
  exact?: boolean;
  limit?: number;
}

export interface PropertySearchResult {
  node: Node;
  selectorNode?: Node;
}

export interface RuleMatch {
  node: Node;
  properties: Array<{ property: string; value: string }>;
}

export interface RuleAnalysisResult {
  selector: string;
  classes: string[];
  ids: string[];
  tags: string[];
  exactMatches: RuleMatch[];
  containsMatches: RuleMatch[];
  classUsage: Array<{ className: string; files: string[]; nodeCount: number }>;
  looseFiles: string[];
  strictFiles: string[];
}

export interface CascadeStep {
  node: Node;
  specificity?: [number, number, number, number];
  properties: Array<{ property: string; value: string }>;
  overrides: Node[];
  overriddenBy: Node[];
}

export interface CascadeResult {
  className: string;
  steps: CascadeStep[];
}

// Static anchor diagnosis: classify height declarations level by level along the DOM ancestor chain (supplied by the caller)
export type AnchorConfidence = 'DEFINITE' | 'INDEFINITE' | 'UNVERIFIABLE';

export interface AnchorLevel {
  /** Chain level label, e.g. 'div.s-kit-modal' or '.s-kit-modal' */
  label: string;
  /** Matching rule selectors (may be multiple; highest-specificity effective) */
  selectors: string[];
  /** Declared height value (raw string), null when not declared */
  declaredHeight: string | null;
  /** Declared max-height value (raw string), null when not declared */
  declaredMaxHeight: string | null;
  /** Confidence classification of the height declaration */
  confidence: AnchorConfidence;
  /** Whether this level's declaration gives % children a definite height (DEFINITE absolute units only) */
  providesAnchor: boolean;
  /** Compensation red flags: overflow-y:auto/scroll + large margin patterns that reserve scroll space */
  redFlags: string[];
  /** Rule locations as filePath:startLine */
  locations: string[];
}

export interface DiagnoseResult {
  /** Diagnostic target className (scroll container or dialog root) */
  target: string;
  /** Per-level diagnosis along the chain */
  levels: AnchorLevel[];
  /** Whether the chain contains a definite anchor */
  anchored: boolean;
  /** Label of the level holding the anchor, null when none */
  anchorLevel: string | null;
  /** Verdict summary */
  verdict: string;
  /** Fix recommendations */
  recommendations: string[];
}

export interface UnusedResult {
  node: Node;
  referencedBy: number;
}

export interface Context {
  focal: Node;
  ancestors: Node[];
  children: Node[];
  incomingRefs: Array<{ node: Node; edge: Edge }>;
  outgoingRefs: Array<{ node: Node; edge: Edge }>;
  types: Node[];
  imports: Node[];
}

export interface FindRelevantContextOptions {
  searchLimit?: number;
  traversalDepth?: number;
  maxNodes?: number;
  edgeKinds?: EdgeKind[];
  nodeKinds?: NodeKind[];
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  fileCount: number;
  nodesByKind: Record<string, number>;
  edgesByKind: Record<string, number>;
  filesByLanguage: Record<string, number>;
  dbSizeBytes: number;
  lastUpdated: number;
}
