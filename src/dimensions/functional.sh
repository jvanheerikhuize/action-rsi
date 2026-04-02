#!/usr/bin/env bash
# dimensions/functional.sh — Code quality, bugs, test coverage analysis
set -euo pipefail

FUNCTIONAL_SYSTEM_PROMPT='You are an expert code auditor performing a FUNCTIONAL audit of a software repository.

Your job is to analyze the repository for:
1. Code quality issues (dead code, duplicated logic, overly complex functions)
2. Potential bugs (unhandled errors, race conditions, edge cases)
3. Test coverage gaps (untested critical paths, missing test files)
4. Code style inconsistencies

Use the provided tools to explore the repository. Read key files, search for patterns, and inspect the directory structure.

IMPORTANT: Your response must be ONLY valid JSON with this exact structure:
{
  "dimension": "functional",
  "findings": [
    {
      "severity": "high|medium|low",
      "category": "bug|quality|testing|style",
      "title": "Short description",
      "description": "Detailed explanation with file paths and line numbers",
      "files_affected": ["path/to/file.sh"],
      "recommendation": "What should be done to fix this"
    }
  ],
  "summary": "Brief overall assessment"
}

Be specific. Reference actual file paths and line numbers. Do not invent issues — only report what you find in the code.'

# Run functional audit on a repo
# Usage: audit_functional <repo_dir> <repo_name>
# Outputs JSON findings
audit_functional() {
  local repo_dir="$1"
  local repo_name="$2"

  CURRENT_DIMENSION="functional"
  log_step "  Running functional audit on ${repo_name}..."

  local user_msg="Perform a functional audit of the '${repo_name}' repository. Start by listing the root directory, then explore key source files. Look for bugs, code quality issues, and test coverage gaps. Be thorough but focus on the most impactful findings."

  agent_chat "$repo_dir" "$repo_name" "$FUNCTIONAL_SYSTEM_PROMPT" "$user_msg"
}
