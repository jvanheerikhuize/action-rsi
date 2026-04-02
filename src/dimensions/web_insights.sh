#!/usr/bin/env bash
# dimensions/web_insights.sh — Web research for new insights based on repo purpose
set -euo pipefail

WEB_INSIGHTS_SYSTEM_PROMPT='You are a technology researcher performing a deep web research audit on a software repository.

Your job is to:
1. Understand the repository purpose, tech stack, and domain
2. Use web_search extensively to find:
   - Emerging industry trends relevant to this project
   - New libraries, tools, or frameworks that could benefit it
   - Recent blog posts, talks, or papers with applicable techniques
   - Security advisories or deprecation notices for dependencies used
   - Community best practices that have evolved since the code was written
   - Similar open-source projects doing innovative things
3. Synthesize your research into actionable insights

You MUST call web_search at least 3 times with different queries. Vary your queries:
- One broad query about the domain/purpose (e.g., "provisioning automation best practices 2026")
- One specific to the tech stack (e.g., "bash scripting modern patterns shellcheck")
- One about emerging trends or alternatives (e.g., "infrastructure as code trends 2026")

For each search result you reference, include the full URL, title, and a brief excerpt explaining why it is relevant.

IMPORTANT: Your response must be ONLY valid JSON with this exact structure:
{
  "dimension": "web_insights",
  "findings": [
    {
      "severity": "medium|low",
      "category": "trend|library|technique|security_advisory|deprecation|community|alternative",
      "title": "Short description of the insight",
      "description": "Detailed explanation of the insight and why it matters for this repo",
      "files_affected": [],
      "recommendation": "How this insight could be applied to improve the repo",
      "references": [
        {
          "url": "https://...",
          "title": "Article/page title",
          "excerpt": "Key relevant quote or summary from the source"
        }
      ]
    }
  ],
  "sources_consulted": [
    {
      "query": "The exact search query used",
      "top_results": [
        {"url": "https://...", "title": "...", "relevant": true}
      ]
    }
  ],
  "summary": "Brief overview of the research landscape and key takeaways"
}

Quality over quantity — report 3-6 strong insights backed by real sources rather than many vague ones. Every finding MUST have at least one reference URL.'

audit_web_insights() {
  local repo_dir="$1"
  local repo_name="$2"

  CURRENT_DIMENSION="web_insights"
  log_step "  Running web insights research on ${repo_name}..."

  # Include repo summary upfront so the agent can skip file exploration and focus on web research
  local repo_summary=""
  local summary_file="${WORKSPACE}/.summaries/${repo_name}.json"
  if [[ -f "$summary_file" ]]; then
    repo_summary="$(cat "$summary_file")"
  fi

  local user_msg="Research the web for new insights relevant to the '${repo_name}' repository.

Here is a pre-computed summary of the repository (no need to explore files yourself):
${repo_summary}

Skip file exploration — go straight to web searches. Perform at least 3 web searches covering: (1) domain best practices, (2) tech stack improvements, (3) emerging trends or alternatives. Then produce your JSON findings. Cite all sources with URLs."

  local findings
  findings="$(agent_chat "$repo_dir" "$repo_name" "$WEB_INSIGHTS_SYSTEM_PROMPT" "$user_msg")"

  # Extract and log the detailed sources consulted (beyond what web_search already logs)
  if [[ -n "$findings" ]]; then
    local sources_consulted
    sources_consulted="$(echo "$findings" | jq '.sources_consulted // []' 2>/dev/null)" || sources_consulted="[]"

    if [[ "$sources_consulted" != "[]" ]]; then
      local log_file="${LOG_DIR}/${repo_name}-insights.jsonl"
      jq -nc \
        --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        --arg repo "$repo_name" \
        --arg dimension "web_insights" \
        --argjson sources "$sources_consulted" \
        --arg model "$MODEL" \
        '{
          timestamp: $timestamp,
          type: "insights_sources",
          repo: $repo,
          dimension: $dimension,
          model: $model,
          sources_consulted: $sources
        }' >> "$log_file"
      log_info "  Sources logged to ${log_file}"
    fi
  fi

  echo "$findings"
}
