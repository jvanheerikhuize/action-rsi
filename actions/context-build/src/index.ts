/**
 * Context-build sub-action entry point.
 *
 * Reads `.agents/CONTEXT.md` from the target repo (or flags for bootstrap),
 * computes delta since last audit, scores files for relevance, and writes
 * a ContextBundle JSON for the downstream LLM-analyze action.
 *
 * Adaptive by design: for small repos or bootstrap, loads everything.
 * For delta runs, loads only changed files + their immediate imports + a
 * few high-relevance anchors (entry points, static-finding files).
 */

import * as core from "@actions/core";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPersistentContext, computeImportGraph } from "../../../lib/context/builder.js";
import { computeDelta, hasChanges, needsFullReaudit } from "../../../lib/context/delta.js";
import { generateContextMd, parseContextMd } from "../../../lib/context/persistent.js";
import { detectLanguages } from "../../../lib/language-detect.js";
import type {
  ContextBundle,
  DeltaContext,
  Finding,
  KeyFile,
  PersistentContext,
  RepoSummary,
  Severity,
  StaticAnalysisSummary,
} from "../../../lib/types.js";

const CONTEXT_MD_PATH = ".agents/CONTEXT.md";
const MAX_FILE_BYTES = 32_000;

async function run(): Promise<void> {
  const repoPath = core.getInput("repo-path", { required: true });
  const repoFullName = core.getInput("repo-name", { required: true });
  const staticFindingsPath = core.getInput("static-findings");
  const auditDate = core.getInput("audit-date") || new Date().toISOString().slice(0, 10);
  const forceFull = core.getInput("force-full") === "true";
  const maxKeyFiles = Number.parseInt(core.getInput("max-key-files") || "0", 10);
  const bundleOut = core.getInput("output-path") || "context-bundle.json";
  const contextOut = core.getInput("updated-context-path") || "updated-context.md";

  const contextFile = join(repoPath, CONTEXT_MD_PATH);
  const isBootstrap = !existsSync(contextFile);

  if (isBootstrap) {
    core.info(`No ${CONTEXT_MD_PATH} — flagging for bootstrap. Caller should run actions/bootstrap first.`);
    core.setOutput("is-bootstrap", "true");
    core.setOutput("needs-full-reaudit", "true");
    core.setOutput("has-changes", "true");
    core.setOutput("bundle-path", "");
    core.setOutput("updated-context-path", "");
    core.setOutput("token-estimate", "0");
    return;
  }

  // ── Load existing persistent context ──────────────────────────────────
  const existingMd = readFileSync(contextFile, "utf-8");
  const persistent = parseContextMd(existingMd);

  const fullReaudit = forceFull || needsFullReaudit(persistent.lastUpdated);
  const changes = hasChanges(repoPath, persistent.lastUpdated);
  core.setOutput("needs-full-reaudit", fullReaudit ? "true" : "false");
  core.setOutput("has-changes", changes ? "true" : "false");
  core.setOutput("is-bootstrap", "false");

  // ── Discover repo state ───────────────────────────────────────────────
  const filePaths = listTrackedFiles(repoPath);
  const languages = detectLanguages(filePaths);
  const repoSummary = summarizeRepo(repoPath, repoFullName, filePaths, languages);

  // ── Load static findings (optional) ───────────────────────────────────
  const staticFindings: Finding[] = staticFindingsPath && existsSync(staticFindingsPath)
    ? safeParseFindings(staticFindingsPath)
    : [];

  // ── Compute delta ─────────────────────────────────────────────────────
  const delta = computeDelta(repoPath, persistent);
  delta.newStaticFindings = dedupeAgainstKnownConcerns(staticFindings, persistent);

  // ── Refresh persistent context (drift-corrected) ──────────────────────
  // On full re-audit we rebuild architecture heuristics fresh; otherwise
  // we keep existing persistent context and let the LLM pass mutate it.
  let updatedPersistent = persistent;
  if (fullReaudit) {
    const importGraph = computeImportGraph(repoPath, filePaths);
    const refreshed = buildPersistentContext(
      { repoDir: repoPath, repoName: repoSummary.name, filePaths, languages, repoSummary, importGraph },
      auditDate,
    );
    // Preserve carried-over concerns — the LLM pass will reconcile them.
    refreshed.knownConcerns = persistent.knownConcerns;
    updatedPersistent = refreshed;
  }

  // ── Select key files ──────────────────────────────────────────────────
  const keyFiles = selectKeyFiles({
    repoPath,
    filePaths,
    persistent: updatedPersistent,
    delta,
    staticFindings,
    isFullReaudit: fullReaudit,
    maxFiles: maxKeyFiles,
  });

  // ── Assemble bundle ───────────────────────────────────────────────────
  const bundle: ContextBundle = {
    repo: repoFullName,
    timestamp: new Date().toISOString(),
    isBootstrap: false,
    persistentContext: updatedPersistent,
    delta,
    fileStructure: buildFileStructure(filePaths),
    keyFiles,
    staticAnalysis: summarizeStatic(staticFindings),
    webResearch: [],
    repoSummary,
  };

  writeFileSync(bundleOut, JSON.stringify(bundle, null, 2), "utf-8");
  writeFileSync(contextOut, generateContextMd(updatedPersistent), "utf-8");

  const tokenEstimate = estimateTokens(bundle);
  core.info(`Bundle: ${keyFiles.length} key files, ${delta.changedFiles.length} changed, ${delta.contextDrift.length} drift items, ~${tokenEstimate} tokens.`);

  core.setOutput("bundle-path", bundleOut);
  core.setOutput("updated-context-path", contextOut);
  core.setOutput("token-estimate", String(tokenEstimate));
}

// ── File selection ─────────────────────────────────────────────────────

interface SelectInput {
  repoPath: string;
  filePaths: string[];
  persistent: PersistentContext;
  delta: DeltaContext;
  staticFindings: Finding[];
  isFullReaudit: boolean;
  maxFiles: number;
}

function selectKeyFiles(input: SelectInput): KeyFile[] {
  const { repoPath, filePaths, persistent, delta, staticFindings, isFullReaudit, maxFiles } = input;

  const scores = new Map<string, { score: number; reason: string }>();
  const bump = (path: string, score: number, reason: string) => {
    const existing = scores.get(path);
    if (!existing || existing.score < score) scores.set(path, { score, reason });
  };

  // Anchors: entry points, documented modules
  for (const ep of persistent.architecture.entryPoints) bump(ep, 100, "entry point");
  for (const mod of persistent.architecture.modules) bump(mod.path, 90, `module: ${mod.purpose}`);

  // Changed files (delta focus)
  for (const cf of delta.changedFiles) {
    if (cf.status !== "deleted") bump(cf.path, 85, `${cf.status} since last audit`);
  }

  // Files with static findings
  for (const f of staticFindings) {
    if (f.file) bump(f.file, 80, `static finding: ${f.source}`);
  }

  // README / top-level docs
  for (const p of ["README.md", "README.rst", "README.txt", "CONTRIBUTING.md"]) {
    if (filePaths.includes(p)) bump(p, 60, "project documentation");
  }

  // Config / manifests
  const configPatterns = ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "pom.xml", "Gemfile", "Makefile"];
  for (const cfg of configPatterns) {
    if (filePaths.includes(cfg)) bump(cfg, 50, "project manifest");
  }

  // Bootstrap / full re-audit: pull in more source files
  if (isFullReaudit) {
    for (const p of filePaths) {
      if (isSourceFile(p) && !scores.has(p)) bump(p, 20, "source (full re-audit)");
    }
  }

  // Sort and trim
  const ranked = Array.from(scores.entries())
    .filter(([p]) => existsSync(join(repoPath, p)))
    .sort(([, a], [, b]) => b.score - a.score);

  const limited = maxFiles > 0 ? ranked.slice(0, maxFiles) : ranked;

  const keyFiles: KeyFile[] = [];
  for (const [path, { score, reason }] of limited) {
    const content = readFileCapped(join(repoPath, path));
    if (content === null) continue;
    keyFiles.push({ path, content, score, reason });
  }
  return keyFiles;
}

function isSourceFile(path: string): boolean {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return [".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".go", ".rs", ".sh", ".bash", ".rb", ".java", ".kt", ".c", ".cpp", ".h", ".hpp"].includes(ext);
}

function readFileCapped(path: string): string | null {
  try {
    const buf = readFileSync(path);
    if (buf.length > MAX_FILE_BYTES) {
      return buf.subarray(0, MAX_FILE_BYTES).toString("utf-8") + `\n\n[... truncated, ${buf.length} bytes total]`;
    }
    return buf.toString("utf-8");
  } catch {
    return null;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function listTrackedFiles(repoPath: string): string[] {
  try {
    const out = execSync(`git -C "${repoPath}" ls-files`, { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 });
    return out.split("\n").filter(Boolean);
  } catch (e) {
    core.warning(`git ls-files failed: ${(e as Error).message}`);
    return [];
  }
}

function summarizeRepo(
  repoPath: string,
  fullName: string,
  filePaths: string[],
  languages: ReturnType<typeof detectLanguages>,
): RepoSummary {
  const langMap: Record<string, number> = {};
  for (const lang of languages) langMap[lang.language] = lang.percentage;

  const defaultBranch = safeExec(`git -C "${repoPath}" symbolic-ref --short HEAD`) || "main";
  const hasCI = existsSync(join(repoPath, ".github/workflows")) ||
    existsSync(join(repoPath, ".gitlab-ci.yml"));
  const hasTests = filePaths.some((p) => /(^|\/)(test|tests|__tests__|spec)(\/|_)/i.test(p));
  const description = readDescription(repoPath);
  const name = fullName.includes("/") ? fullName.split("/")[1] : fullName;

  return {
    name,
    description,
    languages: langMap,
    defaultBranch,
    hasCI,
    hasTests,
    fileCount: filePaths.length,
    totalLines: 0, // computed elsewhere if needed
  };
}

function readDescription(repoPath: string): string {
  for (const readme of ["README.md", "README.rst", "README.txt"]) {
    const p = join(repoPath, readme);
    if (existsSync(p)) {
      const first = readFileSync(p, "utf-8").split("\n").find((l) => l.trim() && !l.startsWith("#"));
      if (first) return first.trim().slice(0, 300);
    }
  }
  return "";
}

function safeExec(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 5000 }).trim();
  } catch {
    return "";
  }
}

function safeParseFindings(path: string): Finding[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    if (Array.isArray(parsed)) return parsed as Finding[];
    if (Array.isArray(parsed?.findings)) return parsed.findings as Finding[];
    return [];
  } catch (e) {
    core.warning(`Could not parse static findings at ${path}: ${(e as Error).message}`);
    return [];
  }
}

/**
 * Remove findings that duplicate existing known concerns so the LLM
 * focuses on genuinely new issues.
 */
function dedupeAgainstKnownConcerns(findings: Finding[], persistent: PersistentContext): Finding[] {
  const concernText = persistent.knownConcerns
    .filter((c) => !c.resolved)
    .map((c) => c.description.toLowerCase());
  return findings.filter((f) => {
    const sig = `${f.title} ${f.description}`.toLowerCase();
    return !concernText.some((ct) => sig.includes(ct) || ct.includes(f.title.toLowerCase()));
  });
}

function summarizeStatic(findings: Finding[]): StaticAnalysisSummary {
  const bySeverity: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  const bySource: Record<string, number> = {};
  for (const f of findings) {
    bySeverity[f.severity]++;
    bySource[f.source] = (bySource[f.source] ?? 0) + 1;
  }
  const top = [...findings]
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .slice(0, 20);
  return { total: findings.length, bySeverity, bySource, topFindings: top };
}

function severityRank(s: Severity): number {
  return s === "high" ? 3 : s === "medium" ? 2 : 1;
}

function buildFileStructure(filePaths: string[]): string {
  // Compact tree: group by top-level dir, list counts and a sample of files.
  const byDir: Record<string, string[]> = {};
  for (const p of filePaths) {
    const top = p.includes("/") ? p.slice(0, p.indexOf("/")) : "(root)";
    (byDir[top] ??= []).push(p);
  }
  const lines: string[] = [];
  for (const [dir, files] of Object.entries(byDir).sort()) {
    lines.push(`${dir}/ (${files.length} files)`);
    for (const f of files.slice(0, 10)) lines.push(`  ${f}`);
    if (files.length > 10) lines.push(`  ... +${files.length - 10} more`);
  }
  return lines.join("\n");
}

function estimateTokens(bundle: ContextBundle): number {
  const json = JSON.stringify(bundle);
  return Math.ceil(json.length / 4);
}

run().catch((err) => {
  core.setFailed((err as Error).message);
});
