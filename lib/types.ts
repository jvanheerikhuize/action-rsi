/**
 * Core types for the RSI audit system.
 * These types are the contract between all sub-actions.
 */

// ── Findings ────────────────────────────────────────────────────────────

export type FindingSource =
  | "shellcheck"
  | "gitleaks"
  | "trivy"
  | "ruff"
  | "eslint"
  | "staticcheck"
  | "clippy"
  | "security_scan"
  | "llm";

export type Dimension =
  | "functional"
  | "non_functional"
  | "documentation"
  | "feature_ideas"
  | "web_insights"
  | "static_analysis";

export type Severity = "high" | "medium" | "low";

export type DimensionPass = "security" | "quality" | "documentation" | "innovation";

export interface Finding {
  id: string;
  source: FindingSource;
  dimension: Dimension;
  severity: Severity;
  category: string;
  title: string;
  description: string;
  file?: string;
  line?: number;
  endLine?: number;
  recommendation: string;
  references?: Reference[];
}

export interface Reference {
  url: string;
  title: string;
}

// ── Persistent Context (.agents/CONTEXT.md) ─────────────────────────────

export interface Module {
  path: string;
  purpose: string;
  dependencies: string[];
}

export interface PersistentContext {
  lastUpdated: string;
  updatedBy: string;
  techStack: {
    primary: string[];
    build: string[];
    ci: string[];
    frameworks: string[];
  };
  architecture: {
    pattern: string;
    description: string;
    entryPoints: string[];
    modules: Module[];
  };
  conventions: Record<string, string>;
  dependencyGraph: Record<string, string[]>;
  knownConcerns: KnownConcern[];
}

export interface KnownConcern {
  date: string;
  description: string;
  severity: Severity;
  resolved?: boolean;
}

// ── Delta Context (computed per audit run) ──────────────────────────────

export interface DeltaContext {
  since: string;
  newCommits: CommitInfo[];
  changedFiles: ChangedFile[];
  newStaticFindings: Finding[];
  contextDrift: DriftItem[];
}

export interface CommitInfo {
  hash: string;
  message: string;
  date: string;
  author: string;
}

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  content?: string;
}

export interface DriftItem {
  type: "missing_module" | "missing_entry_point" | "stale_dependency" | "convention_mismatch";
  description: string;
  reference: string;
}

// ── Context Bundle (assembled for LLM) ──────────────────────────────────

export interface ContextBundle {
  repo: string;
  timestamp: string;
  isBootstrap: boolean;
  persistentContext?: PersistentContext;
  delta?: DeltaContext;
  fileStructure: string;
  keyFiles: KeyFile[];
  staticAnalysis: StaticAnalysisSummary;
  webResearch: WebSearchResult[];
  repoSummary: RepoSummary;
}

export interface KeyFile {
  path: string;
  content: string;
  score: number;
  reason: string;
}

export interface StaticAnalysisSummary {
  total: number;
  bySeverity: Record<Severity, number>;
  bySource: Record<string, number>;
  topFindings: Finding[];
}

export interface WebSearchResult {
  query: string;
  results: Reference[];
}

export interface RepoSummary {
  name: string;
  description: string;
  languages: Record<string, number>;
  defaultBranch: string;
  hasCI: boolean;
  hasTests: boolean;
  fileCount: number;
  totalLines: number;
}

// ── LLM Provider ────────────────────────────────────────────────────────

export interface AnalysisRequest {
  systemPrompt: string;
  userMessage: string;
  maxOutputTokens: number;
  temperature?: number;
}

export interface AnalysisResponse {
  content: string;
  usage: TokenUsage;
  model: string;
  provider: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

// ── Audit Results ───────────────────────────────────────────────────────

export interface AuditResult {
  repo: string;
  date: string;
  passes: PassResult[];
  staticFindings: Finding[];
  llmFindings: Finding[];
  cost: AuditCost;
  summary: string;
  contextUpdated: boolean;
  bootstrapped: boolean;
}

export interface PassResult {
  pass: DimensionPass;
  findings: Finding[];
  usage: TokenUsage;
  costUsd: number;
  duration: number;
}

export interface AuditCost {
  totalUsd: number;
  perPass: Record<DimensionPass, number>;
  inputTokens: number;
  outputTokens: number;
}

// ── Configuration ───────────────────────────────────────────────────────

export interface RsiConfig {
  githubUsername: string;
  testMode: boolean;
  testRepos: string[];
  excludeRepos: string[];
  budgetUsd: number;
  llmProvider: string;
  model: string;
  maxSpecsPerRepo: number;
  searxngUrl?: string;
  outputFormats: OutputFormat[];
  forceFullAudit: boolean;
}

export type OutputFormat = "spec" | "sarif" | "annotations" | "json";

// ── Sub-action I/O contracts ────────────────────────────────────────────

export interface DiscoverOutput {
  repos: RepoSummary[];
  total: number;
  filtered: number;
}

export interface StaticAnalysisOutput {
  findings: Finding[];
  metrics: RepoMetrics;
  languages: LanguageProfile[];
}

export interface RepoMetrics {
  fileCount: number;
  totalLines: number;
  largestFiles: { path: string; lines: number }[];
  functionCount: number;
}

export interface LanguageProfile {
  language: string;
  percentage: number;
  fileCount: number;
  entryPoints: string[];
}

export interface ContextBuildOutput {
  bundle: ContextBundle;
  updatedContextMd?: string;
  agentsMd?: string;
  isBootstrap: boolean;
  tokenEstimate: number;
}

export interface LlmAnalyzeOutput {
  findings: Finding[];
  passes: PassResult[];
  totalCost: AuditCost;
  summary: string;
}

export interface PublishOutput {
  specsCreated: number;
  prUrl?: string;
  sarifPath?: string;
  annotationsCount: number;
}

export interface BootstrapOutput {
  prUrl: string;
  contextMdPath: string;
  agentsMdPath: string;
}
