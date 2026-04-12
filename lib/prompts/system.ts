/**
 * System prompt builder.
 *
 * Composes dimension-specific prompts with the base preamble and output format.
 * The system prompt is designed to be identical across repos in a run so that
 * provider-level prompt caching applies.
 */

import type { DimensionPass } from "../types.js";
import { DIMENSION_PROMPTS } from "./dimensions.js";

const PREAMBLE = `You are an expert code auditor performing a focused review of a software repository. You are part of the RSI (Recursive Self-Improvement) audit system — an automated pipeline that periodically reviews codebases and generates actionable improvement specs.

## Input Context

You have been provided with:

1. **Persistent context** — A maintained summary of the repository's architecture, tech stack, conventions, dependency graph, and known concerns (from .agents/CONTEXT.md). This is your baseline understanding of the repo.
2. **Delta** — Changes since the last audit: new commits, modified files, new static analysis findings, and any drift between the persistent context and current code.
3. **File contents** — Source files relevant to this audit pass, selected based on the dimension being analyzed.
4. **Static analysis results** — Pre-computed findings from automated tools (ShellCheck, gitleaks, trivy, ruff, eslint, etc.). These are already captured — DO NOT duplicate them.
5. **Web research** — Pre-fetched search results about best practices, security, and alternatives relevant to this repo.

## Important

- DO NOT duplicate static analysis findings. They are already captured separately. Focus on issues those tools CANNOT detect.
- Every finding must be specific and actionable — include file paths and line numbers where relevant.
- Quality over quantity: 3-8 strong findings are better than 15 vague ones.
- Group related issues into a single finding rather than listing each occurrence.`;

const OUTPUT_FORMAT = `## Output Format

Your response must be ONLY valid JSON (no markdown fences, no explanation text before or after):

{
  "findings": [
    {
      "dimension": "functional|non_functional|documentation|feature_ideas|web_insights",
      "severity": "high|medium|low",
      "category": "bug|quality|security|performance|maintainability|documentation|feature|trend|technique",
      "title": "Short description (under 80 chars)",
      "description": "Detailed explanation with file paths and line numbers. Be specific about what is wrong and why it matters.",
      "files_affected": ["path/to/file.sh"],
      "recommendation": "Concrete action to take. Include code patterns or approaches where helpful.",
      "references": [{"url": "https://...", "title": "Source"}]
    }
  ],
  "context_updates": {
    "new_concerns": ["description of new concern discovered"],
    "resolved_concerns": ["description of concern that appears resolved"],
    "architecture_changes": ["description of architectural change detected"]
  },
  "summary": "2-3 sentence overview of findings and repo health"
}`;

/**
 * Build a system prompt for a specific dimension pass.
 */
export function buildSystemPrompt(pass: DimensionPass): string {
  const dimension = DIMENSION_PROMPTS[pass];
  return [PREAMBLE, dimension.instructions, OUTPUT_FORMAT].join("\n\n");
}

/**
 * Build the user message from a context bundle.
 * This is dimension-agnostic — the context-build action selects
 * dimension-relevant files before this point.
 */
export function buildUserMessage(opts: {
  repoName: string;
  persistentContext?: string;
  delta?: string;
  fileStructure: string;
  keyFiles: Array<{ path: string; content: string }>;
  staticSummary: string;
  webResearch?: string;
  changeHistory?: string;
}): string {
  const sections: string[] = [];

  sections.push(`# Audit: ${opts.repoName}\n`);

  if (opts.persistentContext) {
    sections.push(`## Repository Context (from .agents/CONTEXT.md)\n${opts.persistentContext}\n`);
  }

  if (opts.delta) {
    sections.push(`## Changes Since Last Audit\n${opts.delta}\n`);
  }

  sections.push(`## File Structure\n\`\`\`\n${opts.fileStructure}\n\`\`\`\n`);

  if (opts.keyFiles.length > 0) {
    const filesSections = opts.keyFiles
      .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
      .join("\n\n");
    sections.push(`## Source Files\n${filesSections}\n`);
  }

  sections.push(`## Static Analysis Results\n${opts.staticSummary}\n`);

  if (opts.changeHistory) {
    sections.push(`## Change History\n${opts.changeHistory}\n`);
  }

  if (opts.webResearch) {
    sections.push(`## Web Research\n${opts.webResearch}\n`);
  }

  sections.push(
    "Produce your findings as JSON. Focus on issues that static analysis CANNOT catch. " +
    "If the repository has a persistent context (.agents/CONTEXT.md), include context_updates " +
    "for any architectural changes, new concerns, or resolved concerns you detect."
  );

  return sections.join("\n");
}
