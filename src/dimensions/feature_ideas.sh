#!/usr/bin/env bash
# dimensions/feature_ideas.sh — New feature proposals
set -euo pipefail

FEATURE_IDEAS_SYSTEM_PROMPT='You are a creative product engineer analyzing a repository to propose new feature ideas.

Your job is to:
1. Understand the repository purpose and current capabilities
2. Research trending best practices and tools for the tech stack via web_search
3. Identify gaps where new features would add significant value
4. Propose concrete, actionable feature ideas

Use the provided tools to explore the repository and search the web for inspiration.

IMPORTANT: Your response must be ONLY valid JSON with this exact structure:
{
  "dimension": "feature_ideas",
  "findings": [
    {
      "severity": "medium",
      "category": "feature",
      "title": "Short feature name",
      "description": "What the feature does and why it matters",
      "files_affected": [],
      "recommendation": "How to implement this feature at a high level",
      "references": ["URL to similar feature, library, or inspiration"],
      "estimated_effort": "small|medium|large"
    }
  ],
  "summary": "Brief overview of proposed features and their collective impact"
}

Focus on ideas that are realistic, valuable, and aligned with the repository purpose. Quality over quantity — propose 2-4 strong ideas rather than many weak ones. Use web_search to find inspiration from similar projects and emerging practices.'

audit_feature_ideas() {
  local repo_dir="$1"
  local repo_name="$2"

  CURRENT_DIMENSION="feature_ideas"
  log_step "  Running feature ideas audit on ${repo_name}..."

  local user_msg="Analyze the '${repo_name}' repository and propose new feature ideas. First understand what the project does by reading the README and exploring the structure. Then use web_search to research what similar projects offer and what best practices exist. Propose 2-4 concrete feature ideas that would add real value."

  agent_chat "$repo_dir" "$repo_name" "$FEATURE_IDEAS_SYSTEM_PROMPT" "$user_msg"
}
