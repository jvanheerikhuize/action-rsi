#!/usr/bin/env bash
# llm_analyzer.sh — Layer 3: Single-shot LLM analysis (no tool-use loop)
# One API call per repo with prompt caching. Optional batch mode.
set -euo pipefail

CLAUDE_API="https://api.anthropic.com/v1/messages"
CLAUDE_VERSION="2023-06-01"

# System prompt — cached across all repos via prompt caching
LLM_SYSTEM_PROMPT='You are an expert code auditor performing a comprehensive review of a software repository. You have been given:

1. A file structure overview
2. Key source files (the most important files in the repo)
3. Static analysis results (from ShellCheck, security scanners, vulnerability scanners)
4. Web research results about relevant best practices
5. Change history since last audit

Your job is to synthesize all this information into actionable improvement findings. Focus on:
- **Functional**: Bugs, logic errors, test gaps, code quality issues
- **Non-functional**: Security vulnerabilities, performance, maintainability
- **Documentation**: Missing or outdated docs, README gaps
- **Feature ideas**: 1-2 high-value improvements based on web research
- **Web insights**: Relevant industry trends, new tools, best practices

IMPORTANT RULES:
- DO NOT duplicate static analysis findings — they are already captured. Instead, add context or identify deeper issues the static tools missed.
- Focus on cross-file concerns, architectural issues, and business logic — things static analysis cannot catch.
- Every finding must be specific and actionable (include file paths and line numbers where relevant).
- Quality over quantity: 3-8 strong findings are better than 15 vague ones.

Your response must be ONLY valid JSON (no markdown fences, no explanation) with this structure:
{
  "findings": [
    {
      "dimension": "functional|non_functional|documentation|feature_ideas|web_insights",
      "severity": "high|medium|low",
      "category": "bug|quality|security|performance|maintainability|documentation|feature|trend|technique",
      "title": "Short description",
      "description": "Detailed explanation with file paths and line numbers",
      "files_affected": ["path/to/file.sh"],
      "recommendation": "What to do and why",
      "references": [{"url": "https://...", "title": "Source"}]
    }
  ],
  "summary": "2-3 sentence overview of the repo health and key takeaways"
}'

# ── Single-shot analysis ─────────────────────────────────────────────
# Usage: llm_analyze <repo_name> <context_bundle_json>
# Outputs findings JSON to stdout
llm_analyze() {
  local repo_name="$1"
  local context_bundle="$2"

  repo_line "${SYM_SEARCH} ${BOLD}LLM Analysis${NC} ${DIM}(single-shot)${NC}"

  # Build user message from context bundle
  local user_message
  user_message="$(echo "$context_bundle" | jq -r '
    "Audit the repository: \(.repo)\n\n" +
    "## Repository Summary\n" +
    (.repo_summary | tostring) + "\n\n" +
    "## File Structure\n```\n" + .file_structure + "\n```\n\n" +
    "## Key Source Files\n" +
    ([.key_files[] | "### " + .path + "\n```\n" + .content + "\n```\n"] | join("\n")) + "\n\n" +
    "## Static Analysis Results\n" +
    "Total findings: \(.static_analysis.total)\n" +
    "By severity: \(.static_analysis.by_severity | tostring)\n" +
    "By source: \(.static_analysis.by_source | tostring)\n\n" +
    "Top findings:\n" +
    ([.static_analysis.top_findings[] |
      "- [\(.severity)] \(.source)/\(.code): \(.title) (\(.file):\(.line))"] | join("\n")) + "\n\n" +
    "## Change History\n" + .change_history + "\n\n" +
    (if (.web_research | length) > 0 then
      "## Web Research Results\n" +
      ([.web_research[] |
        "Query: \(.query)\n" +
        ([.results[]? | "- [\(.title)](\(.url))"] | join("\n"))
      ] | join("\n\n")) + "\n\n"
    else "" end) +
    "Produce your findings as JSON. Focus on issues that static analysis CANNOT catch (cross-file logic, architecture, business logic, missing tests, documentation gaps). Do not repeat static analysis findings."
  ')"

  # Build request with prompt caching
  local request_file
  request_file="$(mktemp /tmp/rsi-llm-request.XXXXXX)"

  jq -nc \
    --arg model "$MODEL" \
    --arg system "$LLM_SYSTEM_PROMPT" \
    --arg user "$user_message" \
    '{
      model: $model,
      max_tokens: 4096,
      system: [
        {
          type: "text",
          text: $system,
          cache_control: { type: "ephemeral" }
        }
      ],
      messages: [
        { role: "user", content: $user }
      ]
    }' > "$request_file"

  # API call with retry
  local response="" http_code="000"
  local response_file
  response_file="$(mktemp /tmp/rsi-llm-response.XXXXXX)"

  local attempt=0 delay=10
  while [[ $attempt -lt 5 ]]; do
    attempt=$((attempt + 1))

    http_code="$(curl -s -w '%{http_code}' -o "$response_file" \
      -H "Content-Type: application/json" \
      -H "x-api-key: ${ANTHROPIC_API_KEY}" \
      -H "anthropic-version: ${CLAUDE_VERSION}" \
      -H "anthropic-beta: prompt-caching-2024-07-31" \
      -d "@${request_file}" \
      "$CLAUDE_API")" || http_code="000"

    response="$(cat "$response_file")"

    if [[ "$http_code" == "200" ]]; then break; fi

    if [[ "$http_code" == "429" || "$http_code" == "529" ]]; then
      log_warn "Rate limited (HTTP ${http_code}), waiting ${delay}s before retry ${attempt}/5..."
      sleep "$delay"
      delay=$((delay * 2))
      continue
    fi

    break
  done

  rm -f "$request_file" "$response_file"

  if [[ "$http_code" != "200" ]]; then
    local err_msg
    err_msg="$(echo "$response" | jq -r '.error.message // .error // "unknown error"' 2>/dev/null || echo "$response")"
    log_error "Claude API returned HTTP ${http_code} for ${repo_name}: ${err_msg}"
    echo '{"findings":[],"summary":"API call failed"}'
    return 1
  fi

  # Track cost
  local input_tokens output_tokens cache_read cache_creation
  input_tokens="$(echo "$response" | jq -r '.usage.input_tokens // 0')"
  output_tokens="$(echo "$response" | jq -r '.usage.output_tokens // 0')"
  cache_read="$(echo "$response" | jq -r '.usage.cache_read_input_tokens // 0')"
  cache_creation="$(echo "$response" | jq -r '.usage.cache_creation_input_tokens // 0')"

  cost_record "$repo_name" "$input_tokens" "$output_tokens"
  research_log_agent_call "$repo_name" "llm_v2" "$input_tokens" "$output_tokens"

  # Log cache stats
  if [[ "$cache_read" -gt 0 ]]; then
    tool_line "cache hit: ${cache_read} tokens cached"
  fi
  if [[ "$cache_creation" -gt 0 ]]; then
    tool_line "cache write: ${cache_creation} tokens"
  fi

  # Extract and clean response
  local text_response
  text_response="$(echo "$response" | jq -r '.content[] | select(.type == "text") | .text' | strip_code_fences)"

  # Validate JSON
  if echo "$text_response" | jq '.findings' > /dev/null 2>&1; then
    local finding_count
    finding_count="$(echo "$text_response" | jq '.findings | length')"
    repo_line "  ${SYM_CHECK} ${GREEN}${finding_count} findings${NC} ${DIM}(1 API call, ${input_tokens} in / ${output_tokens} out)${NC}"
    echo "$text_response"
  else
    repo_line "  ${SYM_WARN} ${YELLOW}Failed to parse LLM response${NC}"
    log_warn "Raw LLM output (first 200 chars): $(echo "$text_response" | head -c 200)"
    echo '{"findings":[],"summary":"Failed to parse LLM response"}'
  fi
}
