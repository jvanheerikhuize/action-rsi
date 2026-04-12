/**
 * Delta context computation.
 *
 * Given a persistent context and the current repo state, computes what
 * changed since the persistent context was last updated.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import type { ChangedFile, CommitInfo, DeltaContext, DriftItem, PersistentContext } from "../types.js";

/**
 * Compute the delta between the persistent context and current repo state.
 */
export function computeDelta(
  repoDir: string,
  persistent: PersistentContext,
): DeltaContext {
  const since = persistent.lastUpdated;

  return {
    since,
    newCommits: getNewCommits(repoDir, since),
    changedFiles: getChangedFiles(repoDir, since),
    newStaticFindings: [], // filled in by the caller after static analysis
    contextDrift: detectDrift(repoDir, persistent),
  };
}

/**
 * Check if anything has changed since the last audit.
 */
export function hasChanges(repoDir: string, since: string): boolean {
  try {
    const output = execSync(`git -C "${repoDir}" log --oneline --since="${since}" 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 10_000,
    }).trim();
    return output.length > 0;
  } catch {
    return true; // assume changes if we can't check
  }
}

/**
 * Check if a full re-audit is needed (monthly refresh).
 */
export function needsFullReaudit(lastUpdated: string): boolean {
  const last = new Date(lastUpdated);
  const now = new Date();
  const daysSince = (now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24);
  return daysSince >= 30;
}

function getNewCommits(repoDir: string, since: string): CommitInfo[] {
  try {
    const format = "%H|%s|%aI|%an";
    const output = execSync(
      `git -C "${repoDir}" log --format="${format}" --since="${since}" 2>/dev/null`,
      { encoding: "utf-8", timeout: 10_000 },
    ).trim();

    if (!output) return [];

    return output.split("\n").map((line) => {
      const [hash, message, date, author] = line.split("|");
      return { hash, message, date, author };
    });
  } catch {
    return [];
  }
}

function getChangedFiles(repoDir: string, since: string): ChangedFile[] {
  try {
    const output = execSync(
      `git -C "${repoDir}" diff --name-status HEAD@{${since}} HEAD 2>/dev/null || git -C "${repoDir}" diff --name-status --diff-filter=AMDRT HEAD~10 HEAD 2>/dev/null`,
      { encoding: "utf-8", timeout: 10_000 },
    ).trim();

    if (!output) return [];

    return output.split("\n").map((line) => {
      const [statusChar, ...pathParts] = line.split("\t");
      const path = pathParts.join("\t"); // handle paths with tabs
      const status = parseGitStatus(statusChar);
      const content = status !== "deleted" ? readFileSafe(`${repoDir}/${path}`) : undefined;
      return { path, status, content };
    });
  } catch {
    return [];
  }
}

function detectDrift(repoDir: string, persistent: PersistentContext): DriftItem[] {
  const drift: DriftItem[] = [];

  // Check if documented entry points still exist
  for (const ep of persistent.architecture.entryPoints) {
    if (!existsSync(`${repoDir}/${ep}`)) {
      drift.push({
        type: "missing_entry_point",
        description: `Entry point \`${ep}\` is documented but does not exist`,
        reference: ep,
      });
    }
  }

  // Check if documented modules still exist
  for (const mod of persistent.architecture.modules) {
    if (!existsSync(`${repoDir}/${mod.path}`)) {
      drift.push({
        type: "missing_module",
        description: `Module \`${mod.path}\` (${mod.purpose}) is documented but does not exist`,
        reference: mod.path,
      });
    }
  }

  // Check if dependency graph references still exist
  for (const [file, deps] of Object.entries(persistent.dependencyGraph)) {
    if (!existsSync(`${repoDir}/${file}`)) {
      drift.push({
        type: "stale_dependency",
        description: `Dependency graph references \`${file}\` which does not exist`,
        reference: file,
      });
    }
    for (const dep of deps) {
      if (!existsSync(`${repoDir}/${dep}`)) {
        drift.push({
          type: "stale_dependency",
          description: `\`${file}\` depends on \`${dep}\` which does not exist`,
          reference: dep,
        });
      }
    }
  }

  return drift;
}

function parseGitStatus(status: string): ChangedFile["status"] {
  switch (status.charAt(0)) {
    case "A": return "added";
    case "M": return "modified";
    case "D": return "deleted";
    case "R": return "renamed";
    default: return "modified";
  }
}

function readFileSafe(path: string, maxBytes = 32_000): string | undefined {
  try {
    if (!existsSync(path)) return undefined;
    const buf = readFileSync(path);
    if (buf.length > maxBytes) {
      return buf.subarray(0, maxBytes).toString("utf-8") + `\n\n[... truncated, ${buf.length} bytes total]`;
    }
    return buf.toString("utf-8");
  } catch {
    return undefined;
  }
}
