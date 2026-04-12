/**
 * Publish-results sub-action entry point.
 *
 * Consumes LLM findings + optional static findings, emits outputs in the
 * requested formats (A-SDLC specs / SARIF / inline annotations / JSON),
 * and opens an audit PR on the target repo carrying the new specs and
 * the updated .agents/CONTEXT.md.
 *
 * Format selection is additive — each format that's requested writes
 * its output, and all requested formats run.
 */

import * as core from "@actions/core";
import * as github from "@actions/github";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findingsToSpecs } from "../../../lib/formats/asdlc-spec.js";
import { findingsToSarif } from "../../../lib/formats/sarif.js";
import type { Finding, OutputFormat, Severity } from "../../../lib/types.js";

const CONTEXT_PATH = ".agents/CONTEXT.md";

async function run(): Promise<void> {
  const repoPath = core.getInput("repo-path", { required: true });
  const repoName = core.getInput("repo-name", { required: true });
  const token = core.getInput("github-token", { required: true });
  const findingsPath = core.getInput("findings-path", { required: true });
  const staticFindingsPath = core.getInput("static-findings-path");
  const updatedContextPath = core.getInput("updated-context-path");
  const auditDate = core.getInput("audit-date") || new Date().toISOString().slice(0, 10);
  const formats = parseFormats(core.getInput("output-formats") || "spec");
  const maxSpecs = Number.parseInt(core.getInput("max-specs") || "0", 10);
  const baseBranch = core.getInput("base-branch") || "main";
  const specsDir = core.getInput("specs-dir") || "specs/features";
  const sarifPath = core.getInput("sarif-path") || "rsi-findings.sarif";

  const [owner, repo] = repoName.split("/");
  if (!owner || !repo) throw new Error(`repo-name must be "owner/name", got: ${repoName}`);

  const llmFindings: Finding[] = readFindings(findingsPath);
  const staticFindings: Finding[] = staticFindingsPath ? readFindings(staticFindingsPath) : [];
  core.info(`Publishing: ${llmFindings.length} LLM findings, ${staticFindings.length} static findings, formats=${formats.join(",")}`);

  let specsCreated = 0;
  let sarifAbsPath = "";
  let annotationsCount = 0;
  const filesToCommit: string[] = [];

  // Update CONTEXT.md in target repo if provided
  if (updatedContextPath && existsSync(updatedContextPath)) {
    const dest = join(repoPath, CONTEXT_PATH);
    mkdirSync(join(repoPath, ".agents"), { recursive: true });
    writeFileSync(dest, readFileSync(updatedContextPath, "utf-8"), "utf-8");
    filesToCommit.push(CONTEXT_PATH);
    core.info(`Updated ${CONTEXT_PATH} in target repo.`);
  }

  // ── spec format ────────────────────────────────────────────────────
  if (formats.includes("spec")) {
    const ordered = prioritize(llmFindings);
    const selected = maxSpecs > 0 ? ordered.slice(0, maxSpecs) : ordered;
    const startId = nextSpecId(join(repoPath, specsDir));
    const specs = findingsToSpecs(selected, { startId, auditDate });
    mkdirSync(join(repoPath, specsDir), { recursive: true });
    for (const s of specs) {
      const abs = join(repoPath, specsDir, s.filename);
      writeFileSync(abs, s.content, "utf-8");
      filesToCommit.push(`${specsDir}/${s.filename}`);
    }
    specsCreated = specs.length;
    core.info(`Wrote ${specsCreated} spec files to ${specsDir}.`);
  }

  // ── sarif format ───────────────────────────────────────────────────
  if (formats.includes("sarif")) {
    const all = [...staticFindings, ...llmFindings];
    sarifAbsPath = sarifPath.startsWith("/") ? sarifPath : join(repoPath, sarifPath);
    writeFileSync(sarifAbsPath, findingsToSarif(all), "utf-8");
    core.info(`Wrote SARIF to ${sarifAbsPath}.`);
  }

  // ── annotations format ─────────────────────────────────────────────
  if (formats.includes("annotations")) {
    for (const f of [...staticFindings, ...llmFindings]) {
      if (!f.file || !f.line) continue;
      const cmd = f.severity === "high" ? core.error : f.severity === "medium" ? core.warning : core.notice;
      cmd(`${f.title}\n${f.description}`, { file: f.file, startLine: f.line, endLine: f.endLine ?? f.line });
      annotationsCount++;
    }
    core.info(`Emitted ${annotationsCount} inline annotations.`);
  }

  // ── json format ────────────────────────────────────────────────────
  if (formats.includes("json")) {
    const jsonPath = join(repoPath, `rsi-findings-${auditDate}.json`);
    writeFileSync(jsonPath, JSON.stringify({ auditDate, llm: llmFindings, static: staticFindings }, null, 2), "utf-8");
    filesToCommit.push(`rsi-findings-${auditDate}.json`);
  }

  // ── Open PR if we have committable artifacts ───────────────────────
  let prUrl = "";
  if (filesToCommit.length > 0) {
    prUrl = await openAuditPr({
      repoPath, owner, repo, token, baseBranch, auditDate,
      files: filesToCommit, specsCreated, llmFindingsCount: llmFindings.length,
      staticFindingsCount: staticFindings.length,
    });
  } else {
    core.info("No files to commit — skipping PR creation.");
  }

  core.setOutput("pr-url", prUrl);
  core.setOutput("specs-created", String(specsCreated));
  core.setOutput("sarif-path", sarifAbsPath);
  core.setOutput("annotations-count", String(annotationsCount));
}

// ── Helpers ────────────────────────────────────────────────────────────

function parseFormats(input: string): OutputFormat[] {
  const valid: OutputFormat[] = ["spec", "sarif", "annotations", "json"];
  return input
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is OutputFormat => (valid as string[]).includes(s));
}

function readFindings(path: string): Finding[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    if (Array.isArray(parsed)) return parsed as Finding[];
    if (Array.isArray(parsed?.findings)) return parsed.findings as Finding[];
    return [];
  } catch (e) {
    core.warning(`Could not read findings at ${path}: ${(e as Error).message}`);
    return [];
  }
}

function prioritize(findings: Finding[]): Finding[] {
  const rank: Record<Severity, number> = { high: 3, medium: 2, low: 1 };
  return [...findings].sort((a, b) => rank[b.severity] - rank[a.severity]);
}

function nextSpecId(specsDir: string): number {
  if (!existsSync(specsDir)) return 1;
  let max = 0;
  for (const name of readdirSync(specsDir)) {
    const m = name.match(/^FEAT-(\d{4})/);
    if (m) max = Math.max(max, Number.parseInt(m[1], 10));
  }
  return max + 1;
}

interface OpenPrInput {
  repoPath: string;
  owner: string;
  repo: string;
  token: string;
  baseBranch: string;
  auditDate: string;
  files: string[];
  specsCreated: number;
  llmFindingsCount: number;
  staticFindingsCount: number;
}

async function openAuditPr(input: OpenPrInput): Promise<string> {
  const { repoPath, owner, repo, token, baseBranch, auditDate, files, specsCreated, llmFindingsCount, staticFindingsCount } = input;
  const branch = `rsi/audit-${auditDate}`;

  execSync(`git -C "${repoPath}" checkout -B "${branch}"`, { stdio: "inherit" });
  for (const f of files) {
    execSync(`git -C "${repoPath}" add "${f}"`, { stdio: "inherit" });
  }

  // No-op guard: if there's nothing staged, skip.
  const status = execSync(`git -C "${repoPath}" diff --cached --name-only`, { encoding: "utf-8" }).trim();
  if (!status) {
    core.info("Nothing staged after add — no PR to create.");
    return "";
  }

  const commitMsg = `chore: RSI audit ${auditDate}\n\n${specsCreated} new spec(s), ${llmFindingsCount} LLM finding(s), ${staticFindingsCount} static finding(s).`;
  execSync(`git -C "${repoPath}" -c user.name="rsi-bot" -c user.email="rsi-bot@users.noreply.github.com" commit -m ${JSON.stringify(commitMsg)}`, { stdio: "inherit" });

  const remote = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  execSync(`git -C "${repoPath}" push --force "${remote}" "${branch}"`, { stdio: "inherit" });

  const octokit = github.getOctokit(token);
  const title = `RSI Audit ${auditDate}`;
  const body = buildPrBody({ auditDate, specsCreated, llmFindingsCount, staticFindingsCount });

  const existing = await octokit.rest.pulls.list({ owner, repo, head: `${owner}:${branch}`, state: "open" });
  if (existing.data.length > 0) return existing.data[0].html_url;

  const { data: pr } = await octokit.rest.pulls.create({ owner, repo, title, head: branch, base: baseBranch, body });
  return pr.html_url;
}

function buildPrBody(opts: { auditDate: string; specsCreated: number; llmFindingsCount: number; staticFindingsCount: number }): string {
  return `## RSI Audit — ${opts.auditDate}

Automated audit by [action-rsi](https://github.com/jerryvanheerikhuize/action-rsi).

### Summary
- **${opts.specsCreated}** new spec file(s) under \`specs/features/\`
- **${opts.llmFindingsCount}** LLM finding(s) (prioritized: high → medium → low)
- **${opts.staticFindingsCount}** static-analysis finding(s) cross-referenced
- \`.agents/CONTEXT.md\` refreshed to reflect the current state

### Next steps
Review the specs, assign priority, and let your local agent (or a human) implement them. Per \`.agents/AGENTS.md\`, completed specs should be deleted and \`CONTEXT.md\` updated to reflect any architectural changes.

---
*Generated by RSI multi-pass analysis (security / quality / documentation / innovation).*
`;
}

run().catch((err) => {
  core.setFailed((err as Error).message);
});
