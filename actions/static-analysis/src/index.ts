/**
 * Static-analysis sub-action entry point.
 *
 * Detects languages, runs the matching analyzers, aggregates into a
 * single normalized Finding[] JSON plus a RepoMetrics JSON.
 *
 * Standalone-usable: any repo can call this for free CI static analysis
 * without the LLM stack. Outputs are stable types (lib/types.ts).
 */

import * as core from "@actions/core";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_RUNNERS, type Runner, type RunnerContext } from "../../../lib/analyzers/runners.js";
import { detectLanguages } from "../../../lib/language-detect.js";
import type { Finding, LanguageProfile, RepoMetrics, Severity, StaticAnalysisOutput } from "../../../lib/types.js";

async function run(): Promise<void> {
  const repoPath = core.getInput("repo-path", { required: true });
  const findingsOut = core.getInput("output-path") || "static-findings.json";
  const metricsOut = core.getInput("metrics-path") || "static-metrics.json";

  const filePaths = listTrackedFiles(repoPath);
  const languages = detectLanguages(filePaths);

  core.info(`Detected languages: ${languages.map((l) => `${l.language} (${l.percentage}%)`).join(", ") || "(none)"}`);

  const ctx: RunnerContext = {
    repoPath,
    filePaths,
    warn: (msg: string) => core.warning(msg),
  };

  // Run analyzers in parallel — they're independent subprocess calls.
  const results = await Promise.all(ALL_RUNNERS.map((r: Runner) => runSafely(r, ctx)));
  const findings: Finding[] = results.flat();

  const metrics = computeMetrics(repoPath, filePaths);

  const output: StaticAnalysisOutput = { findings, metrics, languages };

  writeFileSync(findingsOut, JSON.stringify(findings, null, 2), "utf-8");
  writeFileSync(metricsOut, JSON.stringify(output, null, 2), "utf-8");

  const counts = countBySeverity(findings);
  core.info(`Static findings: ${findings.length} total — high=${counts.high} medium=${counts.medium} low=${counts.low}`);

  core.setOutput("findings-path", findingsOut);
  core.setOutput("metrics-path", metricsOut);
  core.setOutput("total", String(findings.length));
  core.setOutput("high", String(counts.high));
  core.setOutput("medium", String(counts.medium));
  core.setOutput("low", String(counts.low));
  core.setOutput("languages", languages.map((l) => l.language).join(","));
}

async function runSafely(runner: Runner, ctx: RunnerContext): Promise<Finding[]> {
  try {
    return await runner(ctx);
  } catch (e) {
    core.warning(`Runner failed: ${(e as Error).message}`);
    return [];
  }
}

function listTrackedFiles(repoPath: string): string[] {
  try {
    const out = execSync(`git -C "${repoPath}" ls-files`, { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 });
    return out.split("\n").filter(Boolean);
  } catch (e) {
    core.warning(`git ls-files failed: ${(e as Error).message}`);
    return [];
  }
}

function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const out: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  for (const f of findings) out[f.severity]++;
  return out;
}

function computeMetrics(repoPath: string, filePaths: string[]): RepoMetrics {
  const sizes: { path: string; lines: number }[] = [];
  let total = 0;
  let functions = 0;

  const funcRe = /\b(function\s+\w+|def\s+\w+|func\s+\w+|fn\s+\w+|\w+\s*\(\s*\)\s*\{)/g;

  for (const p of filePaths) {
    try {
      const content = readFileSync(join(repoPath, p), "utf-8");
      const lines = content.split("\n").length;
      sizes.push({ path: p, lines });
      total += lines;
      const matches = content.match(funcRe);
      if (matches) functions += matches.length;
    } catch {
      // skip binary / unreadable
    }
  }

  sizes.sort((a, b) => b.lines - a.lines);
  return {
    fileCount: filePaths.length,
    totalLines: total,
    largestFiles: sizes.slice(0, 10),
    functionCount: functions,
  };
}

run().catch((err) => {
  core.setFailed((err as Error).message);
});
