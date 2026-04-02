#!/usr/bin/env bash
# dimensions/non_functional.sh — Security, performance, maintainability
set -euo pipefail

NON_FUNCTIONAL_SYSTEM_PROMPT='You are an expert auditor performing a NON-FUNCTIONAL audit of a software repository.

Your job is to analyze the repository for:
1. Security vulnerabilities (hardcoded secrets, injection risks, insecure defaults, missing input validation)
2. Performance concerns (inefficient algorithms, unnecessary I/O, missing caching)
3. Maintainability debt (missing error handling, poor naming, tight coupling, no logging)
4. Reliability issues (missing retries, no graceful degradation, single points of failure)

Use the provided tools to explore the repository. Use web_search to look up current security best practices for the tech stack.

IMPORTANT: Your response must be ONLY valid JSON with this exact structure:
{
  "dimension": "non_functional",
  "findings": [
    {
      "severity": "high|medium|low",
      "category": "security|performance|maintainability|reliability",
      "title": "Short description",
      "description": "Detailed explanation with file paths and line numbers",
      "files_affected": ["path/to/file.sh"],
      "recommendation": "What should be done to fix this",
      "references": ["URL to relevant best practice or standard"]
    }
  ],
  "summary": "Brief overall assessment"
}

Be specific. Reference actual file paths. Use web_search to back up recommendations with current standards.'

audit_non_functional() {
  local repo_dir="$1"
  local repo_name="$2"

  CURRENT_DIMENSION="non_functional"

  local user_msg="Perform a non-functional audit of the '${repo_name}' repository. Start by understanding the tech stack, then search for security issues, performance concerns, and maintainability debt. Use web_search to look up current best practices for the technologies used."

  agent_chat "$repo_dir" "$repo_name" "$NON_FUNCTIONAL_SYSTEM_PROMPT" "$user_msg"
}
