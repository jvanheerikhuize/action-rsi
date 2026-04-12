/**
 * A-SDLC spec file generator.
 *
 * Converts normalized Finding objects into A-SDLC YAML spec files for
 * `specs/features/FEAT-NNNN-*.yaml`. The format is hand-written YAML
 * (not a library) because the output is small and fixed-shape — adding
 * a YAML dep would dwarf this file's size.
 */

import type { Finding } from "../types.js";

export interface SpecFile {
  filename: string;
  content: string;
}

export interface SpecOptions {
  startId: number;
  auditDate: string;
  author?: string;
}

/**
 * Convert a list of findings into A-SDLC spec files.
 * Each finding becomes one FEAT-NNNN spec.
 */
export function findingsToSpecs(findings: Finding[], opts: SpecOptions): SpecFile[] {
  const specs: SpecFile[] = [];
  let id = opts.startId;

  for (const f of findings) {
    const featId = `FEAT-${String(id).padStart(4, "0")}`;
    const slug = slugify(f.title).slice(0, 50);
    const filename = `${featId}-${slug}.yaml`;
    specs.push({ filename, content: renderSpec(featId, f, opts) });
    id++;
  }

  return specs;
}

function renderSpec(featId: string, f: Finding, opts: SpecOptions): string {
  const author = opts.author ?? "RSI Audit Agent";
  const priority = f.severity === "high" ? "high" : f.severity === "medium" ? "medium" : "low";
  const tags = ["rsi-audit", f.dimension, f.category].filter(Boolean);
  const refs = (f.references ?? []).map((r) => `      - ${yamlStr(r.title)}: ${yamlStr(r.url)}`).join("\n");

  return `metadata:
  id: ${featId}
  title: ${yamlStr(f.title)}
  version: 1.0.0
  status: draft
  priority: ${priority}
  author: ${yamlStr(author)}
  created_at: "${opts.auditDate}"
  updated_at: "${opts.auditDate}"
  tags:
${tags.map((t) => `    - ${t}`).join("\n")}
description:
  summary: ${yamlStr(`Automated audit finding: ${f.title}`)}
  problem_statement: ${yamlBlock(f.description)}
  proposed_solution: ${yamlBlock(f.recommendation)}
  out_of_scope:
    - Changes unrelated to the identified findings
  dependencies: []
technical_requirements:
  constraints: []
  security: []
acceptance_criteria:
  - id: AC-001
    given: ${yamlStr(f.file ? `The file ${f.file} exists in the repository` : "The repository is in its current state")}
    when: The changes from this spec are applied
    then: ${yamlStr(f.recommendation)}
technical_notes: ${yamlStr(f.file ? `Files affected: ${f.file}${f.line ? ` (around line ${f.line})` : ""}` : "See description for affected areas")}
${refs ? `references:\n${refs}\n` : ""}testing_requirements:
  unit_tests: true
  integration_tests: false
  e2e_tests: false
  performance_tests: false
  test_scenarios:
    - Verify the fix addresses the identified issue
rollout:
  rollout_strategy: manual
  rollback_plan: Revert the changes introduced by this spec via git revert.
`;
}

// ── YAML escaping ──────────────────────────────────────────────────────

function yamlStr(value: string): string {
  const v = value.replace(/\r?\n/g, " ").trim();
  // Use single quotes, escaping embedded single quotes as ''
  return `'${v.replace(/'/g, "''")}'`;
}

function yamlBlock(value: string): string {
  // Multi-line block scalar preserving content; fall back to flow string if short.
  const trimmed = value.trim();
  if (trimmed.length < 200 && !trimmed.includes("\n")) return yamlStr(trimmed);
  const indented = trimmed.split("\n").map((l) => `    ${l}`).join("\n");
  return `|\n${indented}`;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
