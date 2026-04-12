/**
 * Bootstrap sub-action entry point.
 *
 * Generates .agents/CONTEXT.md and .agents/AGENTS.md for a target repo
 * that has never been audited, then opens a PR to introduce them.
 *
 * This is a separate concern from audit findings: the bootstrap PR lands
 * the agent-context scaffolding; the audit PR (a separate action) lands
 * spec files. Splitting them keeps the first-run diff reviewable.
 */

import * as core from "@actions/core";
import * as github from "@actions/github";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildPersistentContext, computeImportGraph } from "../../../lib/context/builder.js";
import { generateContextMd } from "../../../lib/context/persistent.js";
import { detectLanguages } from "../../../lib/language-detect.js";
import { AGENTS_MD_TEMPLATE } from "../../../lib/templates/agents-md.js";
import type { RepoSummary } from "../../../lib/types.js";

const CONTEXT_PATH = ".agents/CONTEXT.md";
const AGENTS_PATH = ".agents/AGENTS.md";

async function run(): Promise<void> {
  const repoPath = core.getInput("repo-path", { required: true });
  const repoFullName = core.getInput("repo-name", { required: true });
  const token = core.getInput("github-token", { required: true });
  const auditDate = core.getInput("audit-date") || new Date().toISOString().slice(0, 10);
  const updatedBy = core.getInput("updated-by") || "RSI audit (bootstrap)";
  const baseBranch = core.getInput("base-branch") || "main";

  const contextFile = join(repoPath, CONTEXT_PATH);
  const agentsFile = join(repoPath, AGENTS_PATH);

  if (existsSync(contextFile) && existsSync(agentsFile)) {
    core.info(`${CONTEXT_PATH} and ${AGENTS_PATH} already exist — skipping bootstrap.`);
    core.setOutput("created", "false");
    core.setOutput("context-md-path", CONTEXT_PATH);
    core.setOutput("agents-md-path", AGENTS_PATH);
    return;
  }

  // ── Discover repo state ───────────────────────────────────────────────
  const filePaths = listTrackedFiles(repoPath);
  const languages = detectLanguages(filePaths);
  const repoSummary = summarizeRepo(repoPath, repoFullName, filePaths, languages);
  const importGraph = computeImportGraph(repoPath, filePaths);

  // ── Generate context ──────────────────────────────────────────────────
  const persistent = buildPersistentContext(
    { repoDir: repoPath, repoName: repoSummary.name, filePaths, languages, repoSummary, importGraph },
    auditDate,
  );
  persistent.updatedBy = updatedBy;

  const contextMd = generateContextMd(persistent);
  const agentsMd = AGENTS_MD_TEMPLATE;

  // ── Write files ───────────────────────────────────────────────────────
  mkdirSync(dirname(contextFile), { recursive: true });
  writeFileSync(contextFile, contextMd, "utf-8");
  writeFileSync(agentsFile, agentsMd, "utf-8");
  core.info(`Wrote ${CONTEXT_PATH} (${contextMd.length} bytes) and ${AGENTS_PATH} (${agentsMd.length} bytes).`);

  // ── Open PR ───────────────────────────────────────────────────────────
  const prUrl = await openBootstrapPr({
    repoPath,
    repoFullName,
    token,
    baseBranch,
    auditDate,
    languages: persistent.techStack.primary,
  });

  core.setOutput("pr-url", prUrl);
  core.setOutput("context-md-path", CONTEXT_PATH);
  core.setOutput("agents-md-path", AGENTS_PATH);
  core.setOutput("created", "true");
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
    existsSync(join(repoPath, ".gitlab-ci.yml")) ||
    existsSync(join(repoPath, ".circleci/config.yml"));
  const hasTests = filePaths.some((p) => /(^|\/)(test|tests|__tests__|spec)(\/|_)/i.test(p));

  let totalLines = 0;
  for (const p of filePaths.slice(0, 1000)) {
    try {
      const stat = readFileSync(join(repoPath, p), "utf-8");
      totalLines += stat.split("\n").length;
    } catch {
      // skip binary / unreadable
    }
  }

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
    totalLines,
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

interface OpenPrInput {
  repoPath: string;
  repoFullName: string;
  token: string;
  baseBranch: string;
  auditDate: string;
  languages: string[];
}

async function openBootstrapPr(input: OpenPrInput): Promise<string> {
  const { repoPath, repoFullName, token, baseBranch, auditDate, languages } = input;
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) throw new Error(`repo-name must be "owner/name", got: ${repoFullName}`);

  const branch = `rsi/bootstrap-${auditDate}`;
  execSync(`git -C "${repoPath}" checkout -B "${branch}"`, { stdio: "inherit" });
  execSync(`git -C "${repoPath}" add ${CONTEXT_PATH} ${AGENTS_PATH}`, { stdio: "inherit" });

  const commitMsg = `chore: add agent context infrastructure\n\nAdds .agents/CONTEXT.md and .agents/AGENTS.md so local AI agents\nhave persistent context and instructions for this repository.`;
  execSync(`git -C "${repoPath}" -c user.name="rsi-bot" -c user.email="rsi-bot@users.noreply.github.com" commit -m ${JSON.stringify(commitMsg)}`, { stdio: "inherit" });

  const remoteUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  execSync(`git -C "${repoPath}" push --force "${remoteUrl}" "${branch}"`, { stdio: "inherit" });

  const octokit = github.getOctokit(token);
  const title = "Add agent context infrastructure (RSI bootstrap)";
  const body = buildPrBody(languages);

  // Reuse an existing open PR if present; otherwise create.
  const existing = await octokit.rest.pulls.list({ owner, repo, head: `${owner}:${branch}`, state: "open" });
  if (existing.data.length > 0) {
    return existing.data[0].html_url;
  }

  const { data: pr } = await octokit.rest.pulls.create({ owner, repo, title, head: branch, base: baseBranch, body });
  return pr.html_url;
}

function buildPrBody(languages: string[]): string {
  return `## What this PR adds

- **\`.agents/CONTEXT.md\`** — persistent architectural context for this repository: tech stack, entry points, key modules, conventions, dependency graph, and known concerns. Maintained by the RSI audit system and by local agents.
- **\`.agents/AGENTS.md\`** — instructions for any AI agent (Claude Code, Cursor, Copilot, Aider, etc.) working in this repo: how to read context before starting, and how to update it after completing a spec.

## Why

This repo hasn't been audited by RSI before. Before RSI files any audit findings, it first lands this scaffolding so that:

1. **RSI's own subsequent audits can be cheaper and more focused** — by reading the persistent context and computing a delta instead of re-deriving the architecture every run.
2. **Any AI agent you use locally** (not just RSI) has immediate, authoritative context about the repo.
3. **The context stays current** — local agents are instructed (via \`AGENTS.md\`) to update \`CONTEXT.md\` whenever they complete a spec that changes the architecture.

## Detected

${languages.length > 0 ? `- Primary languages: ${languages.join(", ")}` : "- (No source languages detected — context is minimal.)"}

## Next

After this PR merges, a follow-up **RSI Audit PR** will file spec files under \`specs/features/\` based on the initial audit findings.

---
*Generated by [action-rsi](https://github.com/jerryvanheerikhuize/action-rsi) bootstrap.*
`;
}

run().catch((err) => {
  core.setFailed((err as Error).message);
});
