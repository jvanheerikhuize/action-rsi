/**
 * Analyzer runners.
 *
 * Each runner invokes a static analysis tool via subprocess, parses its
 * output, and normalizes results into the unified `Finding` shape.
 *
 * Runners never throw on tool errors — they log a warning and return an
 * empty array so a single missing tool doesn't kill the whole audit.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  PATTERN_IGNORE_DIRS,
  PATTERN_IGNORE_FILES,
  SECURITY_PATTERNS,
  type SecurityPattern,
} from "../rules/security-patterns.js";
import type { Finding, Severity } from "../types.js";

export interface RunnerContext {
  repoPath: string;
  filePaths: string[];
  warn: (msg: string) => void;
}

export type Runner = (ctx: RunnerContext) => Promise<Finding[]>;

// ── Pattern scanner ────────────────────────────────────────────────────

export const patternScanner: Runner = async (ctx) => {
  const findings: Finding[] = [];
  let nextId = 0;

  const scannable = ctx.filePaths.filter((p) => {
    if (PATTERN_IGNORE_FILES.some((f) => p.endsWith(f))) return false;
    if (PATTERN_IGNORE_DIRS.some((d) => p.startsWith(`${d}/`) || p.includes(`/${d}/`))) return false;
    return true;
  });

  const byExt = new Map<string, string[]>();
  for (const p of scannable) {
    const ext = extOf(p);
    if (!ext) continue;
    (byExt.get(ext) ?? byExt.set(ext, []).get(ext)!).push(p);
  }

  for (const rule of SECURITY_PATTERNS) {
    const candidates = new Set<string>();
    for (const ext of rule.extensions) {
      for (const f of byExt.get(ext) ?? []) candidates.add(f);
    }
    for (const rel of candidates) {
      const abs = join(ctx.repoPath, rel);
      const content = readText(abs);
      if (content === null) continue;
      matchRule(rule, rel, content, findings, () => `pattern-${rule.id}-${nextId++}`);
    }
  }

  return findings;
};

function matchRule(
  rule: SecurityPattern,
  path: string,
  content: string,
  out: Finding[],
  mkId: () => string,
): void {
  const lines = content.split("\n");
  const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : rule.pattern.flags + "g");
  for (let i = 0; i < lines.length; i++) {
    re.lastIndex = 0;
    if (!re.test(lines[i])) continue;
    out.push({
      id: mkId(),
      source: "security_scan",
      dimension: "static_analysis",
      severity: rule.severity,
      category: rule.category,
      title: rule.title,
      description: `${rule.description}\n\nAt ${path}:${i + 1}: \`${lines[i].trim().slice(0, 160)}\``,
      file: path,
      line: i + 1,
      recommendation: rule.recommendation,
    });
  }
}

// ── External tool runners ──────────────────────────────────────────────

export const shellcheckRunner: Runner = async (ctx) => {
  const shellFiles = ctx.filePaths.filter((p) => /\.(sh|bash)$/.test(p));
  if (shellFiles.length === 0) return [];
  if (!hasBinary("shellcheck")) {
    ctx.warn("shellcheck not installed — skipping shell lint.");
    return [];
  }

  const out = tryExec("shellcheck", ["-f", "json", "-x", ...shellFiles], ctx.repoPath);
  if (!out) return [];
  try {
    const parsed = JSON.parse(out) as Array<{
      file: string;
      line: number;
      endLine?: number;
      level: string;
      code: number;
      message: string;
    }>;
    return parsed.map((r, i) => ({
      id: `shellcheck-${i}`,
      source: "shellcheck" as const,
      dimension: "static_analysis" as const,
      severity: mapShellcheckLevel(r.level),
      category: "shell_lint",
      title: `SC${r.code}: ${r.message.slice(0, 80)}`,
      description: r.message,
      file: relative(ctx.repoPath, r.file),
      line: r.line,
      endLine: r.endLine,
      recommendation: `See https://www.shellcheck.net/wiki/SC${r.code}`,
    }));
  } catch (e) {
    ctx.warn(`shellcheck output parse failed: ${(e as Error).message}`);
    return [];
  }
};

export const gitleaksRunner: Runner = async (ctx) => {
  if (!hasBinary("gitleaks")) {
    ctx.warn("gitleaks not installed — skipping secret scan.");
    return [];
  }
  const reportPath = join(ctx.repoPath, ".rsi-gitleaks.json");
  tryExec("gitleaks", ["detect", "--no-git", "--report-format", "json", "--report-path", reportPath, "--exit-code", "0"], ctx.repoPath);
  if (!existsSync(reportPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(reportPath, "utf-8")) as Array<{
      Description: string;
      File: string;
      StartLine: number;
      Match: string;
      RuleID: string;
    }>;
    return parsed.map((r, i) => ({
      id: `gitleaks-${i}`,
      source: "gitleaks" as const,
      dimension: "static_analysis" as const,
      severity: "high" as Severity,
      category: "secrets",
      title: `Leaked secret: ${r.Description}`,
      description: `Rule ${r.RuleID} matched at ${r.File}:${r.StartLine}.`,
      file: r.File,
      line: r.StartLine,
      recommendation: "Rotate the credential immediately and purge it from git history (e.g. `git filter-repo`).",
    }));
  } catch (e) {
    ctx.warn(`gitleaks output parse failed: ${(e as Error).message}`);
    return [];
  }
};

export const trivyRunner: Runner = async (ctx) => {
  if (!hasBinary("trivy")) {
    ctx.warn("trivy not installed — skipping dependency scan.");
    return [];
  }
  const out = tryExec("trivy", ["fs", "--scanners", "vuln", "--format", "json", "--quiet", ctx.repoPath], ctx.repoPath);
  if (!out) return [];
  try {
    const parsed = JSON.parse(out) as { Results?: Array<{ Target: string; Vulnerabilities?: Array<{
      VulnerabilityID: string;
      PkgName: string;
      Severity: string;
      Title?: string;
      Description?: string;
      FixedVersion?: string;
    }> }> };
    const findings: Finding[] = [];
    let i = 0;
    for (const result of parsed.Results ?? []) {
      for (const v of result.Vulnerabilities ?? []) {
        findings.push({
          id: `trivy-${i++}`,
          source: "trivy",
          dimension: "static_analysis",
          severity: mapCvss(v.Severity),
          category: "dependency_vulnerability",
          title: `${v.VulnerabilityID}: ${v.PkgName}`,
          description: (v.Title ?? v.Description ?? "").slice(0, 400),
          file: result.Target,
          recommendation: v.FixedVersion ? `Upgrade ${v.PkgName} to >= ${v.FixedVersion}.` : `Monitor ${v.VulnerabilityID}; no fixed version yet.`,
        });
      }
    }
    return findings;
  } catch (e) {
    ctx.warn(`trivy output parse failed: ${(e as Error).message}`);
    return [];
  }
};

export const ruffRunner: Runner = async (ctx) => {
  const hasPython = ctx.filePaths.some((p) => p.endsWith(".py"));
  if (!hasPython || !hasBinary("ruff")) {
    if (hasPython) ctx.warn("ruff not installed — skipping Python lint.");
    return [];
  }
  const out = tryExec("ruff", ["check", "--output-format=json", "."], ctx.repoPath);
  if (!out) return [];
  try {
    const parsed = JSON.parse(out) as Array<{ filename: string; location: { row: number }; code: string; message: string }>;
    return parsed.map((r, i) => ({
      id: `ruff-${i}`,
      source: "ruff" as const,
      dimension: "static_analysis" as const,
      severity: ruffSeverity(r.code),
      category: "python_lint",
      title: `${r.code}: ${r.message.slice(0, 80)}`,
      description: r.message,
      file: relative(ctx.repoPath, r.filename),
      line: r.location.row,
      recommendation: `Ruff rule ${r.code} — see https://docs.astral.sh/ruff/rules/`,
    }));
  } catch (e) {
    ctx.warn(`ruff output parse failed: ${(e as Error).message}`);
    return [];
  }
};

export const eslintRunner: Runner = async (ctx) => {
  const hasJs = ctx.filePaths.some((p) => /\.(js|mjs|cjs|ts|tsx|jsx)$/.test(p));
  if (!hasJs || !hasBinary("eslint")) {
    if (hasJs) ctx.warn("eslint not installed — skipping JS/TS lint.");
    return [];
  }
  const out = tryExec("eslint", ["--format=json", "."], ctx.repoPath);
  if (!out) return [];
  try {
    const parsed = JSON.parse(out) as Array<{
      filePath: string;
      messages: Array<{ line: number; severity: number; ruleId: string | null; message: string }>;
    }>;
    const findings: Finding[] = [];
    let i = 0;
    for (const file of parsed) {
      for (const m of file.messages) {
        findings.push({
          id: `eslint-${i++}`,
          source: "eslint",
          dimension: "static_analysis",
          severity: m.severity === 2 ? "medium" : "low",
          category: "js_ts_lint",
          title: `${m.ruleId ?? "eslint"}: ${m.message.slice(0, 80)}`,
          description: m.message,
          file: relative(ctx.repoPath, file.filePath),
          line: m.line,
          recommendation: m.ruleId ? `See eslint rule ${m.ruleId}.` : "Fix per eslint output.",
        });
      }
    }
    return findings;
  } catch (e) {
    ctx.warn(`eslint output parse failed: ${(e as Error).message}`);
    return [];
  }
};

export const ALL_RUNNERS: Runner[] = [
  patternScanner,
  shellcheckRunner,
  gitleaksRunner,
  trivyRunner,
  ruffRunner,
  eslintRunner,
];

// ── Helpers ────────────────────────────────────────────────────────────

function hasBinary(name: string): boolean {
  try {
    execFileSync("which", [name], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function tryExec(cmd: string, args: string[], cwd: string): string | null {
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    // Tools like eslint exit non-zero on findings — capture stdout anyway.
    const err = e as { stdout?: Buffer | string; status?: number };
    if (err.stdout) return Buffer.isBuffer(err.stdout) ? err.stdout.toString("utf-8") : err.stdout;
    return null;
  }
}

function readText(path: string): string | null {
  try {
    if (!statSync(path).isFile()) return null;
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function extOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  if (base === "Dockerfile" || base.startsWith("Dockerfile.")) return ".Dockerfile";
  const i = base.lastIndexOf(".");
  return i === -1 ? "" : base.slice(i);
}

function mapShellcheckLevel(level: string): Severity {
  if (level === "error") return "high";
  if (level === "warning") return "medium";
  return "low";
}

function mapCvss(sev: string): Severity {
  const s = sev.toUpperCase();
  if (s === "CRITICAL" || s === "HIGH") return "high";
  if (s === "MEDIUM") return "medium";
  return "low";
}

function ruffSeverity(code: string): Severity {
  // S-prefix = bandit (security), E9 = syntax — both high.
  if (code.startsWith("S") || code.startsWith("E9")) return "high";
  return "low";
}
