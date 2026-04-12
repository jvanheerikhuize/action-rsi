/**
 * Discover sub-action entry point.
 *
 * Queries the GitHub API for a user's (or org's) repositories, applies
 * test-mode / exclude / fork / archived filters, and emits:
 *   - `matrix`: a JSON object ready for `strategy.matrix: fromJson(...)`
 *   - `repos-json`: full RepoSummary array for downstream actions
 *
 * This is standalone-useful: any workflow can call it for a filtered
 * repo list.
 */

import * as core from "@actions/core";
import * as github from "@actions/github";
import type { RepoSummary } from "../../../lib/types.js";

async function run(): Promise<void> {
  const token = core.getInput("github-token", { required: true });
  const username = core.getInput("username", { required: true });
  const testMode = core.getInput("test-mode") === "true";
  const testRepos = splitCsv(core.getInput("test-repos"));
  const excludeRepos = new Set(splitCsv(core.getInput("exclude-repos")));
  const includeForks = core.getInput("include-forks") === "true";
  const includeArchived = core.getInput("include-archived") === "true";

  const octokit = github.getOctokit(token);

  core.info(`Discovering repos for ${username} (test_mode=${testMode})`);

  // First try as a user; fall back to org listing on 404.
  let rawRepos: Array<Awaited<ReturnType<typeof octokit.rest.repos.listForUser>>["data"][number]>;
  try {
    const pages = await octokit.paginate(octokit.rest.repos.listForUser, {
      username,
      type: "owner",
      per_page: 100,
    });
    rawRepos = pages;
  } catch (e) {
    core.info(`listForUser failed (${(e as Error).message}); trying listForOrg.`);
    rawRepos = await octokit.paginate(octokit.rest.repos.listForOrg, { org: username, per_page: 100 });
  }

  const total = rawRepos.length;
  const filtered = rawRepos.filter((r) => {
    if (excludeRepos.has(r.name)) return false;
    if (!includeForks && r.fork) return false;
    if (!includeArchived && r.archived) return false;
    if (testMode && testRepos.length > 0 && !testRepos.includes(r.name)) return false;
    return true;
  });

  const summaries: RepoSummary[] = filtered.map((r) => ({
    name: r.name,
    description: r.description ?? "",
    languages: r.language ? { [r.language.toLowerCase()]: 100 } : {},
    defaultBranch: r.default_branch ?? "main",
    hasCI: false, // not known without cloning
    hasTests: false,
    fileCount: 0,
    totalLines: 0,
  }));

  const matrix = {
    repo: filtered.map((r) => `${r.owner.login}/${r.name}`),
    include: filtered.map((r) => ({
      repo: `${r.owner.login}/${r.name}`,
      name: r.name,
      default_branch: r.default_branch ?? "main",
    })),
  };

  core.info(`Discovered ${total} repos, ${filtered.length} after filtering: ${matrix.repo.join(", ")}`);

  core.setOutput("matrix", JSON.stringify(matrix));
  core.setOutput("repos-json", JSON.stringify(summaries));
  core.setOutput("total", String(total));
  core.setOutput("filtered", String(filtered.length));
}

function splitCsv(input: string): string[] {
  return input.split(",").map((s) => s.trim()).filter(Boolean);
}

run().catch((err) => {
  core.setFailed((err as Error).message);
});
